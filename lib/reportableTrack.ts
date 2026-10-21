/**
 * A song the parent page knows about, as the server sent it. `owner` is the
 * username of the profile the song belongs to, when that is not the profile
 * being viewed (a profile song belongs to its artist).
 */
export type ProfileTrack = { id: string; title: string; owner?: string };

/**
 * The server's own record of the track the frame asked about, or null when the
 * id is not in the list. The frame only supplies the id; the title in the
 * dialog and the owner always come from this list.
 */
export function findReportableTrack(tracks: readonly ProfileTrack[], trackId: string): ProfileTrack | null {
  const track = tracks.find((t) => t.id === trackId);
  if (!track) return null;
  return { id: track.id, title: track.title, ...(track.owner !== undefined ? { owner: track.owner } : {}) };
}
