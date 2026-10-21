import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { isBlockedEitherWay, profileForUser, requireProfile } from "./lib/access";
import { rateLimiter } from "./lib/limits";
import { clearPick, profileSongFor, setPick } from "./lib/profileSongs";

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
    await setPick(ctx, me, song.track);
    return null;
  },
});

/** Removes the caller's profile song. Shares pick's limit of 20 an hour. */
export const clear = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const me = await requireProfile(ctx);
    const { ok } = await rateLimiter.limit(ctx, "songPick", { key: me._id });
    if (!ok) throw new ConvexError("Slow down");
    await clearPick(ctx, me);
    return null;
  },
});

/**
 * The caller's profile song for Edit Profile: title and artist, or null when
 * signed out, there is no pick, or the song isn't available right now.
 */
export const mine = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({ title: v.string(), artist: v.object({ username: v.string(), displayName: v.string() }) }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const me = await profileForUser(ctx, userId);
    if (me === null) return null;
    const song = await profileSongFor(ctx, me);
    if (song === null) return null;
    return {
      title: song.track.title,
      artist: { username: song.artist.username, displayName: song.artist.displayName },
    };
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
 * How many other members picked one of the caller's songs, from songPicks by
 * artist: at most 1001 rows, so a result over 1000 means "1000+". Self-picks and
 * picks of deleted tracks don't count (one small get per distinct track). Banned
 * pickers do count: excluding them would need a get of each picker's whole
 * profile doc, up to 1001 of them. 0 for fans, signed-out callers and artists
 * with sharing off.
 */
export const usageCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return 0;
    const me = await profileForUser(ctx, userId);
    if (me === null || me.kind !== "artist" || me.shareSongs === false) return 0;
    const rows = await ctx.db
      .query("songPicks")
      .withIndex("by_artist", (q) => q.eq("artistId", me._id))
      .take(SONG_USAGE_CAP);
    const live = new Map<Id<"tracks">, boolean>();
    let total = 0;
    for (const row of rows) {
      if (row.pickerId === me._id) continue;
      if (!live.has(row.trackId)) live.set(row.trackId, (await ctx.db.get(row.trackId)) !== null);
      if (live.get(row.trackId)) total++;
    }
    return total;
  },
});
