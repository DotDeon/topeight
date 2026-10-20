import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { isBlockedEitherWay, profileForUser, requireProfile } from "./lib/access";
import { rateLimiter } from "./lib/limits";
import { MAX_TRACKS } from "./lib/media";
import { profileSongFor } from "./lib/profileSongs";

/** Picks are counted up to this many. The UI shows more than 1000 as "1000+". */
export const SONG_USAGE_CAP = 1001;

/**
 * Makes a track the caller's profile song. Any member may pick, including an
 * artist picking their own song. "Song not available" when the track is gone,
 * its artist is banned or has sharing off, or either side has blocked the other.
 */
export const pick = mutation({
  args: { trackId: v.id("tracks") },
  returns: v.null(),
  handler: async (ctx, { trackId }) => {
    const me = await requireProfile(ctx);
    const song = await profileSongFor(ctx, { profileSong: trackId });
    if (song === null) throw new ConvexError("Song not available");
    if (song.artist._id !== me._id && (await isBlockedEitherWay(ctx, me._id, song.artist._id))) {
      throw new ConvexError("Song not available");
    }
    const { ok } = await rateLimiter.limit(ctx, "songPick", { key: me._id });
    if (!ok) throw new ConvexError("Slow down");
    await ctx.db.patch(me._id, { profileSong: trackId });
    return null;
  },
});

/** Removes the caller's profile song. */
export const clear = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const me = await requireProfile(ctx);
    if (me.profileSong !== undefined) await ctx.db.patch(me._id, { profileSong: undefined });
    return null;
  },
});

/**
 * Artists only: whether other members may use their songs. Off hides their
 * songs on every profile that picked them, at read time; picks are kept, so
 * turning it back on restores them.
 */
export const setShareSongs = mutation({
  args: { value: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { value }) => {
    const me = await requireProfile(ctx);
    if (me.kind !== "artist") throw new ConvexError("Only artists can share songs");
    const { ok } = await rateLimiter.limit(ctx, "shareSongs", { key: me._id });
    if (!ok) throw new ConvexError("Slow down");
    await ctx.db.patch(me._id, { shareSongs: value });
    return null;
  },
});

/**
 * How many profiles picked one of the caller's songs. Reads at most 10 tracks
 * and at most 1001 picks in all (each read is a whole profile doc, so the cap is
 * shared across tracks rather than 1001 each). A result over 1000 means "1000+".
 * 0 for fans and signed-out callers.
 */
export const usageCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return 0;
    const me = await profileForUser(ctx, userId);
    if (me === null || me.kind !== "artist") return 0;
    const tracks = await ctx.db
      .query("tracks")
      .withIndex("by_profile_order", (q) => q.eq("profileId", me._id))
      .take(MAX_TRACKS);
    let total = 0;
    for (const t of tracks) {
      if (total >= SONG_USAGE_CAP) break;
      const picks = await ctx.db
        .query("profiles")
        .withIndex("by_profile_song", (q) => q.eq("profileSong", t._id))
        .take(SONG_USAGE_CAP - total);
      total += picks.length;
    }
    return total;
  },
});
