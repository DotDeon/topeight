import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * A member's profile song, if it is available: the track exists, its artist's
 * profile exists and isn't banned, and the artist hasn't turned sharing off.
 * Every read of a profile song goes through here (getPublicProfile, playback
 * signing and its refresh, and pick), so they all agree.
 *
 * Picks are never cleared when a track is deleted, an artist is banned or
 * sharing goes off. They read as unavailable instead, so unbanning or turning
 * sharing back on brings them back. A re-uploaded track gets a new id, so a
 * deleted pick never points at someone else's song.
 */
export async function profileSongFor(
  ctx: Pick<QueryCtx, "db">,
  profile: Pick<Doc<"profiles">, "profileSong">,
): Promise<{ track: Doc<"tracks">; artist: Doc<"profiles"> } | null> {
  if (profile.profileSong === undefined) return null;
  const track = await ctx.db.get(profile.profileSong);
  if (track === null) return null;
  const artist = await ctx.db.get(track.profileId);
  if (artist === null || artist.banned || artist.shareSongs === false) return null;
  return { track, artist };
}

/** Sets a member's profile song and upserts their songPicks row. */
export async function setPick(
  ctx: Pick<MutationCtx, "db">,
  pickerId: Id<"profiles">,
  track: Pick<Doc<"tracks">, "_id" | "profileId">,
): Promise<void> {
  await ctx.db.patch(pickerId, { profileSong: track._id });
  const row = await pickRow(ctx, pickerId);
  const fields = { pickerId, artistId: track.profileId, trackId: track._id };
  if (row === null) await ctx.db.insert("songPicks", fields);
  else if (row.trackId !== track._id || row.artistId !== track.profileId) await ctx.db.patch(row._id, fields);
}

/** Clears a member's profile song and deletes their songPicks row. */
export async function clearPick(ctx: Pick<MutationCtx, "db">, picker: Doc<"profiles">): Promise<void> {
  if (picker.profileSong !== undefined) await ctx.db.patch(picker._id, { profileSong: undefined });
  const row = await pickRow(ctx, picker._id);
  if (row !== null) await ctx.db.delete(row._id);
}

async function pickRow(ctx: Pick<QueryCtx, "db">, pickerId: Id<"profiles">) {
  return await ctx.db
    .query("songPicks")
    .withIndex("by_picker", (q) => q.eq("pickerId", pickerId))
    .first();
}
