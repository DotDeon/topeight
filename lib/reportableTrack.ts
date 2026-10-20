/** A song on the profile being viewed, as the server sent it to the parent page. */
export type ProfileTrack = { id: string; title: string };

/**
 * The server's own record of the track the frame asked to report, or null
 * when the id is not one of this profile's tracks. The frame only supplies
 * the id; the title in the dialog always comes from this list.
 */
export function findReportableTrack(tracks: readonly ProfileTrack[], trackId: string): ProfileTrack | null {
  const track = tracks.find((t) => t.id === trackId);
  return track ? { id: track.id, title: track.title } : null;
}
