/**
 * Messages a profile document (sandboxed iframe on the usercontent origin)
 * posts to its parent page on the main origin. The in-iframe sender lives in
 * lib/profile/render.ts; the parent receiver is lib/bridge.ts (Task 7).
 *
 * Everything here arrives from untrusted artist code, so the parent must
 * check event.origin is "null" (opaque sandbox origin), event.source is the
 * profile iframe, and validate every field before acting.
 */
export const BRIDGE_ACTIONS = [
  "addFriend",
  "addComment",
  "report",
  "block",
  "forward",
  "favorite",
  "message",
] as const;

export type BridgeAction = (typeof BRIDGE_ACTIONS)[number];

/** Sub-pages of a profile that a navigate message may ask for. */
export const BRIDGE_PAGES = ["friends", "comments", "blog"] as const;

export type BridgePage = (typeof BRIDGE_PAGES)[number];

/** Longest track id a reportTrack message may carry. Convex ids are shorter. */
export const MAX_TRACK_ID_LENGTH = 64;

/** A YouTube video id: exactly 11 characters from YouTube's URL-safe alphabet. */
export const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export type BridgeMessage =
  | { type: "topeight:action"; action: BridgeAction }
  | { type: "topeight:navigate"; username: string; page?: BridgePage }
  | { type: "topeight:resize"; height: number }
  /**
   * Report one song in the player. The parent only acts on ids in its own
   * server-loaded track list for this profile, and shows that list's title.
   */
  | { type: "topeight:reportTrack"; trackId: string }
  /**
   * Ask to make one of this profile's songs the visitor's own profile song.
   * The parent only acts on ids in its own server-loaded track list for this
   * profile, asks the visitor to confirm, and takes the title from that list.
   */
  | { type: "topeight:pickSong"; trackId: string }
  /**
   * Play a YouTube video. Embeds can't play inside the frame: its opaque origin
   * sends no referrer and YouTube refuses with error 153. So the parent plays it
   * in its own dialog, and only straight after a click.
   */
  | { type: "topeight:playVideo"; videoId: string };
