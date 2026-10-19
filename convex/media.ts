import type { R2Callbacks } from "@convex-dev/r2";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { requireProfile } from "./lib/access";
import { rateLimiter } from "./lib/limits";
import {
  MAX_TRACKS,
  PHOTO_MAX_BYTES,
  PHOTO_TYPES,
  TRACK_MAX_BYTES,
  TRACK_TITLE_MAX,
  TRACK_TYPES,
  UPLOAD_TTL_MS,
} from "./lib/media";
import { r2, storage, UPLOAD_URL_TTL_S } from "./lib/r2";

/*
 * Upload flow:
 * 1. beginUpload({ purpose, title?, size, contentType }) checks who may upload and
 *    the declared size and type, then records a pending row in `uploads` with a
 *    server-chosen key and schedules expireUpload. Returns { uploadId }.
 * 2. generateUploadUrl({ uploadId }) signs a 5 minute PUT URL for that row's key,
 *    locked to the declared size and type and to a key that does not exist yet,
 *    only for the row's owner. The component's own generateUploadUrl takes no key
 *    and signs neither, so it is not exported.
 * 3. The client PUTs the file to R2.
 * 4. syncMetadata({ key }) (from the component) runs onUpload, which checks the
 *    caller owns the pending row, then schedules the component's metadata sync.
 * 5. After R2 metadata is synced, the component calls onSyncMetadata, which reads
 *    size and type, which must equal the declared ones, and records the track or
 *    photo, or deletes the object.
 */

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
    await ctx.scheduler.runAfter(UPLOAD_TTL_MS, internal.media.expireUpload, { uploadId });
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
    if (row.createdAt < Date.now() - UPLOAD_TTL_MS) throw new ConvexError("Upload expired");
    return await storage.uploadUrl({ key: row.key, size: row.size, contentType: row.contentType });
  },
});

/** Scheduled by beginUpload: an upload that never landed loses its row and any object. */
export const expireUpload = internalMutation({
  args: { uploadId: v.id("uploads") },
  returns: v.null(),
  handler: async (ctx, { uploadId }) => {
    const row = await ctx.db.get(uploadId);
    if (row === null) return null;
    await storage.remove(ctx, row.key);
    await ctx.db.delete(row._id);
    return null;
  },
});

/** Scheduled by reject: removes anything PUT to the key again before its URL expired. */
export const removeObject = internalMutation({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, { key }) => {
    await storage.remove(ctx, key);
    return null;
  },
});

/** Delete the object and the pending row, and log why. Nothing is recorded. */
async function reject(ctx: MutationCtx, row: Doc<"uploads">, reason: string) {
  console.warn(`Upload rejected: ${reason} (${row.key})`);
  await storage.remove(ctx, row.key);
  await ctx.db.delete(row._id);
  // The object is gone, so If-None-Match no longer blocks a second PUT on the same
  // URL. Sweep the key again once that URL has expired.
  await ctx.scheduler.runAfter((UPLOAD_URL_TTL_S + 60) * 1000, internal.media.removeObject, {
    key: row.key,
  });
}

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
  await ctx.db.delete(row._id);
}

async function acceptPhoto(ctx: MutationCtx, row: Doc<"uploads">, size: number, contentType: string) {
  if (size > PHOTO_MAX_BYTES) return await reject(ctx, row, "photo over 2 MB");
  if (!PHOTO_TYPES.includes(contentType)) return await reject(ctx, row, `photo type ${contentType}`);
  const profile = await ctx.db.get(row.profileId);
  if (profile === null) return await reject(ctx, row, "profile gone");
  const old = profile.photoKey;
  await ctx.db.patch(profile._id, { photoKey: row.key });
  if (old !== undefined && old !== row.key) await storage.remove(ctx, old);
  await ctx.db.delete(row._id);
}

const callbacks: R2Callbacks = internal.media;

export const { syncMetadata, onSyncMetadata } = r2.clientApi<DataModel>({
  callbacks,
  checkUpload: async (ctx) => {
    await requireProfile(ctx);
  },
  // Runs inside syncMetadata, before R2 metadata is fetched: only the owner of a
  // pending upload may sync its key.
  onUpload: async (ctx, _bucket, key) => {
    const profile = await requireProfile(ctx);
    const row = await pendingByKey(ctx, key);
    if (row === null || row.profileId !== profile._id) throw new ConvexError("Not allowed");
  },
  // Runs after the component has stored the object's size and type.
  onSyncMetadata: async (ctx, { key }) => {
    const row = await pendingByKey(ctx, key);
    if (row === null) return;
    const meta = await storage.metadata(ctx, key);
    const size = meta?.size;
    const contentType = meta?.contentType ?? "";
    if (meta === null || size === undefined) return await reject(ctx, row, "no metadata");
    if (size !== row.size || contentType !== row.contentType) {
      return await reject(ctx, row, `got ${size} bytes of ${contentType}, declared ${row.size} of ${row.contentType}`);
    }
    if (row.purpose === "track") await acceptTrack(ctx, row, size, contentType);
    else await acceptPhoto(ctx, row, size, contentType);
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
    const { profile, track } = await ownTrack(ctx, trackId);
    await storage.remove(ctx, track.key);
    await ctx.db.delete(trackId);
    if (track.autoplay) {
      const rest = await tracksFor(ctx, profile._id);
      const next = rest.find((t) => t.order > track.order) ?? rest[0];
      if (next !== undefined) await ctx.db.patch(next._id, { autoplay: true });
    }
    return null;
  },
});
