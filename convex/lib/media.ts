import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Public R2 URL for an uploaded photo, or null when there is no key or no base URL.
 * Tracks have no public URL: they live in the private audio bucket and play through
 * signed URLs from media.playbackUrls.
 */
export function photoUrl(key?: string): string | null {
  const base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  if (!key || !base) return null;
  return `${base.replace(/\/+$/, "")}/${key}`;
}

const MB = 1024 * 1024;

/** Upload limits shared by the server checks and the client hook. */
export const MAX_TRACKS = 10;
export const TRACK_MAX_BYTES = 5 * MB;
export const TRACK_TYPES: readonly string[] = ["audio/mpeg"];
export const PHOTO_MAX_BYTES = 2 * MB;
export const PHOTO_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/gif", "image/webp"];
/** Pending uploads older than this are ignored and cannot get an upload URL. */
export const UPLOAD_TTL_MS = 60 * 60 * 1000;
export const TRACK_TITLE_MAX = 80;

/**
 * Recomputes hasPhoto and hasTracks from the truth. Patches only when a value changes.
 * The homepage boxes read these flags through indexes.
 */
export async function syncMediaFlags(ctx: MutationCtx, profileId: Id<"profiles">): Promise<void> {
  const profile = await ctx.db.get(profileId);
  if (profile === null) return;
  const track = await ctx.db
    .query("tracks")
    .withIndex("by_profile_order", (q) => q.eq("profileId", profileId))
    .first();
  const hasPhoto = !!profile.photoKey;
  const hasTracks = track !== null;
  if (profile.hasPhoto !== hasPhoto || profile.hasTracks !== hasTracks) {
    await ctx.db.patch(profileId, { hasPhoto, hasTracks });
  }
}
