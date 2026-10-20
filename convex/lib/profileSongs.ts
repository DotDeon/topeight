import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

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
