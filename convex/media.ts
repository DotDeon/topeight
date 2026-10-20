import { getAuthUserId } from "@convex-dev/auth/server";
import type { R2Callbacks } from "@convex-dev/r2";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { profileForUser, requireProfile } from "./lib/access";
import { rateLimiter } from "./lib/limits";
import {
  MAX_TRACKS,
  PHOTO_MAX_BYTES,
  PHOTO_TYPES,
  TRACK_MAX_BYTES,
  TRACK_TITLE_MAX,
  TRACK_TYPES,
  syncMediaFlags,
  UPLOAD_TTL_MS,
} from "./lib/media";
import { audioBucket, audioConfigured, r2, storage, UPLOAD_URL_TTL_S } from "./lib/r2";
import { profileByUsername } from "./profiles";

/*
 * Upload flow:
 * 1. beginUpload({ purpose, title?, size, contentType }) checks who may upload and
 *    the declared size and type, then records a pending row in `uploads` with a
 *    server-chosen key and schedules expireUpload. Returns { uploadId }.
 * 2. generateUploadUrl({ uploadId }) signs a 5 minute PUT URL for that row's key,
 *    locked to the declared size and type and to a key that does not exist yet,
 *    only for the row's owner. The component's own generateUploadUrl takes no key
 *    and signs neither, so it is not exported.
 * 3. The client PUTs the file to R2. Tracks go to the private R2_AUDIO_BUCKET,
 *    photos to the public R2_BUCKET.
 * 4. Tracks: confirmTrackUpload({ uploadId }) checks the caller owns the pending
 *    row, HEADs the object in the audio bucket, and records the track only if its
 *    size and type equal the declared ones. Otherwise the object and row go.
 * 5. Photos: syncMetadata({ key }) (from the component) runs onUpload, which checks
 *    the caller owns the pending photo row, then schedules the component's metadata
 *    sync. After that the component calls onSyncMetadata, which applies the same
 *    size and type check and records the photo, or deletes the object.
 */

/** When a pending upload is swept: after the last URL it could get has expired, plus 60 s. */
export const EXPIRE_AFTER_MS = UPLOAD_TTL_MS + (UPLOAD_URL_TTL_S + 60) * 1000;

const trimTitle = (title: string) => title.trim();

function checkTitle(title: string): string {
  const t = trimTitle(title);
  if (t.length < 1 || t.length > TRACK_TITLE_MAX) {
    throw new ConvexError(`Title must be 1 to ${TRACK_TITLE_MAX} characters`);
  }
  return t;
}

async function tracksFor(ctx: MutationCtx, profileId: Id<"profiles">): Promise<Doc<"tracks">[]> {
  return await ctx.db
    .query("tracks")
    .withIndex("by_profile_order", (q) => q.eq("profileId", profileId))
    .take(MAX_TRACKS + 1);
}

async function recentTrackUploads(ctx: MutationCtx, profileId: Id<"profiles">) {
  return await ctx.db
    .query("uploads")
    .withIndex("by_profile_purpose", (q) =>
      q.eq("profileId", profileId).eq("purpose", "track").gte("createdAt", Date.now() - UPLOAD_TTL_MS),
    )
    .take(MAX_TRACKS + 1);
}

async function pendingByKey(ctx: MutationCtx, key: string) {
  return await ctx.db
    .query("uploads")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
}

/** The caller's own track, or throws "Not allowed". */
async function ownTrack(ctx: MutationCtx, trackId: Id<"tracks">) {
  const profile = await requireProfile(ctx);
  const track = await ctx.db.get(trackId);
  if (track === null || track.profileId !== profile._id) throw new ConvexError("Not allowed");
  return { profile, track };
}

export const beginUpload = mutation({
  args: {
    purpose: v.union(v.literal("photo"), v.literal("track")),
    title: v.optional(v.string()),
    size: v.number(),
    contentType: v.string(),
  },
  returns: v.object({ uploadId: v.id("uploads") }),
  handler: async (ctx, { purpose, title, size, contentType }) => {
    const profile = await requireProfile(ctx);
    const track = purpose === "track";

    let cleanTitle: string | undefined;
    if (track) {
      if (profile.kind !== "artist") throw new ConvexError("Only artists can upload tracks");
      const [tracks, pending] = await Promise.all([
        tracksFor(ctx, profile._id),
        recentTrackUploads(ctx, profile._id),
      ]);
      if (tracks.length + pending.length >= MAX_TRACKS) throw new ConvexError("Maximum 10 tracks");
      if (title !== undefined && trimTitle(title) !== "") cleanTitle = checkTitle(title);
    }
    if (!Number.isInteger(size) || size < 1) throw new ConvexError("That file is empty");
    if (size > (track ? TRACK_MAX_BYTES : PHOTO_MAX_BYTES)) throw new ConvexError("File is too large");
    if (!(track ? TRACK_TYPES : PHOTO_TYPES).includes(contentType)) {
      throw new ConvexError("That file type isn't allowed");
    }

    const { ok } = await rateLimiter.limit(ctx, "upload", { key: profile._id });
    if (!ok) throw new ConvexError("Slow down");

    const key = `${track ? "tracks" : "photos"}/${profile._id}/${crypto.randomUUID()}`;
    const uploadId = await ctx.db.insert("uploads", {
      profileId: profile._id,
      purpose,
      title: cleanTitle,
      key,
      size,
      contentType,
      createdAt: Date.now(),
    });
    // generateUploadUrl works until UPLOAD_TTL_MS, and its URL lives UPLOAD_URL_TTL_S
    // more. Expire only after the last possible URL is dead, plus a minute for a sync.
    await ctx.scheduler.runAfter(EXPIRE_AFTER_MS, internal.media.expireUpload, { uploadId });
    return { uploadId };
  },
});

/** A signed PUT URL for the caller's own pending upload, locked to its declared size and type. */
export const generateUploadUrl = mutation({
  args: { uploadId: v.id("uploads") },
  returns: v.object({ key: v.string(), url: v.string() }),
  handler: async (ctx, { uploadId }) => {
    const profile = await requireProfile(ctx);
    const row = await ctx.db.get(uploadId);
    if (row === null || row.profileId !== profile._id) throw new ConvexError("Not allowed");
    if (Date.now() - row.createdAt >= UPLOAD_TTL_MS) throw new ConvexError("Upload expired");
    return await storage.uploadUrl({
      key: row.key,
      size: row.size,
      contentType: row.contentType,
      purpose: row.purpose,
    });
  },
});

/** Scheduled by beginUpload: an upload that never landed loses its row and any object. */
export const expireUpload = internalMutation({
  args: { uploadId: v.id("uploads") },
  returns: v.null(),
  handler: async (ctx, { uploadId }) => {
    const row = await ctx.db.get(uploadId);
    if (row === null) return null;
    await storage.remove(ctx, row.key, row.purpose);
    // An upload in flight when tracks moved buckets may have landed in the public one.
    if (row.purpose === "track") await storage.removeLegacyPublic(ctx, row.key);
    await ctx.db.delete(row._id);
    return null;
  },
});

/**
 * Scheduled by reject: removes anything PUT to the key again before its URL expired.
 * `purpose` is optional only for jobs scheduled before tracks moved to the audio
 * bucket; those objects are in the photo bucket.
 */
export const removeObject = internalMutation({
  args: { key: v.string(), purpose: v.optional(v.union(v.literal("photo"), v.literal("track"))) },
  returns: v.null(),
  handler: async (ctx, { key, purpose }) => {
    await storage.remove(ctx, key, purpose ?? "photo");
    return null;
  },
});

/** Delete the object and the pending row, and log why. Nothing is recorded. */
async function reject(ctx: MutationCtx, row: Doc<"uploads">, reason: string) {
  console.warn(`Upload rejected: ${reason} (${row.key})`);
  await storage.remove(ctx, row.key, row.purpose);
  if (row.purpose === "track") await storage.removeLegacyPublic(ctx, row.key);
  await ctx.db.delete(row._id);
  // The object is gone, so If-None-Match no longer blocks a second PUT on the same
  // URL. Sweep the key again once that URL has expired.
  await ctx.scheduler.runAfter((UPLOAD_URL_TTL_S + 60) * 1000, internal.media.removeObject, {
    key: row.key,
    purpose: row.purpose,
  });
  return false;
}

/** Records the track and drops the pending row. False when it was rejected instead. */
async function acceptTrack(ctx: MutationCtx, row: Doc<"uploads">, size: number, contentType: string) {
  if (size > TRACK_MAX_BYTES) return await reject(ctx, row, "track over 5 MB");
  if (!TRACK_TYPES.includes(contentType)) return await reject(ctx, row, `track type ${contentType}`);
  const tracks = await tracksFor(ctx, row.profileId);
  if (tracks.length >= MAX_TRACKS) return await reject(ctx, row, "Maximum 10 tracks");
  const last = tracks.at(-1);
  await ctx.db.insert("tracks", {
    profileId: row.profileId,
    title: row.title ?? "Untitled",
    key: row.key,
    size,
    order: last === undefined ? 0 : last.order + 1,
    autoplay: tracks.length === 0,
  });
  await syncMediaFlags(ctx, row.profileId);
  await ctx.db.delete(row._id);
  return true;
}

async function acceptPhoto(ctx: MutationCtx, row: Doc<"uploads">, size: number, contentType: string) {
  if (size > PHOTO_MAX_BYTES) return await reject(ctx, row, "photo over 2 MB");
  if (!PHOTO_TYPES.includes(contentType)) return await reject(ctx, row, `photo type ${contentType}`);
  const profile = await ctx.db.get(row.profileId);
  if (profile === null) return await reject(ctx, row, "profile gone");
  const old = profile.photoKey;
  await ctx.db.patch(profile._id, { photoKey: row.key });
  await syncMediaFlags(ctx, profile._id);
  if (old !== undefined && old !== row.key) await storage.remove(ctx, old, "photo");
  await ctx.db.delete(row._id);
}

const callbacks: R2Callbacks = internal.media;

export const { syncMetadata, onSyncMetadata } = r2.clientApi<DataModel>({
  callbacks,
  checkUpload: async (ctx) => {
    await requireProfile(ctx);
  },
  // Runs inside syncMetadata, before R2 metadata is fetched: only the owner of a
  // pending photo upload may sync its key. Tracks use confirmTrackUpload.
  onUpload: async (ctx, _bucket, key) => {
    const profile = await requireProfile(ctx);
    const row = await pendingByKey(ctx, key);
    if (row === null || row.profileId !== profile._id || row.purpose !== "photo") {
      throw new ConvexError("Not allowed");
    }
  },
  // Runs after the component has stored the object's size and type. Photos only.
  onSyncMetadata: async (ctx, { key }) => {
    const row = await pendingByKey(ctx, key);
    if (row === null || row.purpose !== "photo") return;
    const meta = await storage.metadata(ctx, key);
    const size = meta?.size;
    const contentType = meta?.contentType ?? "";
    if (meta === null || size === undefined) {
      await reject(ctx, row, "no metadata");
    } else if (size !== row.size || contentType !== row.contentType) {
      await reject(ctx, row, `got ${size} bytes of ${contentType}, declared ${row.size} of ${row.contentType}`);
    } else {
      await acceptPhoto(ctx, row, size, contentType);
    }
  },
});

/** The caller's own pending track upload, or throws "Not allowed". */
export const pendingTrackUpload = internalQuery({
  args: { uploadId: v.id("uploads") },
  returns: v.object({ key: v.string() }),
  handler: async (ctx, { uploadId }) => {
    const profile = await requireProfile(ctx);
    const row = await ctx.db.get(uploadId);
    if (row === null || row.profileId !== profile._id || row.purpose !== "track") {
      throw new ConvexError("Not allowed");
    }
    return { key: row.key };
  },
});

/** Accepts or rejects a pending track from what a HEAD on the audio bucket returned. */
export const settleTrackUpload = internalMutation({
  args: {
    uploadId: v.id("uploads"),
    head: v.union(v.null(), v.object({ size: v.number(), contentType: v.string() })),
  },
  returns: v.boolean(),
  handler: async (ctx, { uploadId, head }) => {
    const row = await ctx.db.get(uploadId);
    // Already settled or expired between the HEAD and now.
    if (row === null || row.purpose !== "track") return false;
    if (head === null) return await reject(ctx, row, "no object");
    if (head.size !== row.size || head.contentType !== row.contentType) {
      return await reject(
        ctx,
        row,
        `got ${head.size} bytes of ${head.contentType}, declared ${row.size} of ${row.contentType}`,
      );
    }
    return await acceptTrack(ctx, row, head.size, head.contentType);
  },
});

/**
 * Step 4 for tracks. Only the owner of the pending row may confirm it. Checks the
 * object in the private audio bucket against the declared size and type.
 */
export const confirmTrackUpload = action({
  args: { uploadId: v.id("uploads") },
  returns: v.object({ accepted: v.boolean() }),
  handler: async (ctx, { uploadId }): Promise<{ accepted: boolean }> => {
    const { key } = await ctx.runQuery(internal.media.pendingTrackUpload, { uploadId });
    const head = await storage.head(key, audioBucket());
    const accepted: boolean = await ctx.runMutation(internal.media.settleTrackUpload, { uploadId, head });
    return { accepted };
  },
});

/** Keys of an unbanned profile's tracks, in play order, at most 10. */
export const playableTracks = internalQuery({
  args: { username: v.string() },
  returns: v.array(v.object({ id: v.id("tracks"), key: v.string() })),
  handler: async (ctx, { username }) => {
    const p = await profileByUsername(ctx, username);
    if (p === null || p.banned) return [];
    const rows = await ctx.db
      .query("tracks")
      .withIndex("by_profile_order", (q) => q.eq("profileId", p._id))
      .take(MAX_TRACKS);
    return rows.map((t) => ({ id: t._id, key: t.key }));
  },
});

/**
 * Short-lived playback URLs (15 minutes) for a profile's tracks. Anyone may call
 * it: the usercontent route uses it to render the player and to refresh its URLs.
 * Signs nothing for banned or missing profiles, and writes nothing.
 */
export const playbackUrls = action({
  args: { username: v.string() },
  returns: v.array(v.object({ id: v.id("tracks"), url: v.string() })),
  handler: async (ctx, { username }): Promise<Array<{ id: Id<"tracks">; url: string }>> => {
    // Without an audio bucket (local dev) there is nothing to sign.
    if (!audioConfigured()) {
      console.warn("R2 audio bucket not configured");
      return [];
    }
    const tracks: Array<{ id: Id<"tracks">; key: string }> = await ctx.runQuery(internal.media.playableTracks, {
      username,
    });
    return await Promise.all(tracks.map(async (t) => ({ id: t.id, url: await storage.playbackUrl(t.key) })));
  },
});

export const reorderTracks = mutation({
  args: { ids: v.array(v.id("tracks")) },
  returns: v.null(),
  handler: async (ctx, { ids }) => {
    const profile = await requireProfile(ctx);
    const tracks = await tracksFor(ctx, profile._id);
    const mine = new Set(tracks.map((t) => t._id));
    if (ids.some((id) => !mine.has(id))) throw new ConvexError("Not allowed");
    if (ids.length !== tracks.length || new Set(ids).size !== ids.length) {
      throw new ConvexError("List every track exactly once");
    }
    for (const [order, id] of ids.entries()) await ctx.db.patch(id, { order });
    return null;
  },
});

export const setAutoplay = mutation({
  args: { trackId: v.id("tracks") },
  returns: v.null(),
  handler: async (ctx, { trackId }) => {
    const { profile } = await ownTrack(ctx, trackId);
    for (const t of await tracksFor(ctx, profile._id)) {
      const autoplay = t._id === trackId;
      if (t.autoplay !== autoplay) await ctx.db.patch(t._id, { autoplay });
    }
    return null;
  },
});

export const renameTrack = mutation({
  args: { trackId: v.id("tracks"), title: v.string() },
  returns: v.null(),
  handler: async (ctx, { trackId, title }) => {
    await ownTrack(ctx, trackId);
    await ctx.db.patch(trackId, { title: checkTitle(title) });
    return null;
  },
});

export const deleteTrack = mutation({
  args: { trackId: v.id("tracks") },
  returns: v.null(),
  handler: async (ctx, { trackId }) => {
    const { track } = await ownTrack(ctx, trackId);
    await removeTrack(ctx, track);
    return null;
  },
});

/** Deletes a track and its R2 object, and passes autoplay on to the next track. No access check. */
export async function removeTrack(ctx: MutationCtx, track: Doc<"tracks">): Promise<void> {
  await storage.remove(ctx, track.key, "track");
  // A track from before the audio bucket may still have a public copy. Remove it too.
  await storage.removeLegacyPublic(ctx, track.key);
  await ctx.db.delete(track._id);
  if (track.autoplay) {
    const rest = await tracksFor(ctx, track.profileId);
    const next = rest.find((t) => t.order > track.order) ?? rest[0];
    if (next !== undefined) await ctx.db.patch(next._id, { autoplay: true });
  }
  await syncMediaFlags(ctx, track.profileId);
}

/** The caller's tracks in play order. Empty when signed out or without a profile. */
export const myTracks = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const profile = await profileForUser(ctx, userId);
    if (profile === null) return [];
    const rows = await ctx.db
      .query("tracks")
      .withIndex("by_profile_order", (q) => q.eq("profileId", profile._id))
      .take(MAX_TRACKS);
    return rows.map((t) => ({ id: t._id, title: t.title, autoplay: t.autoplay }));
  },
});
