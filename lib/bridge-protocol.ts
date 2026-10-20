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
  "message",
] as const;

export type BridgeAction = (typeof BRIDGE_ACTIONS)[number];

/** Sub-pages of a profile that a navigate message may ask for. */
export const BRIDGE_PAGES = ["friends", "comments"] as const;

export type BridgePage = (typeof BRIDGE_PAGES)[number];

/** Longest track id a reportTrack message may carry. Convex ids are shorter. */
export const MAX_TRACK_ID_LENGTH = 64;

export type BridgeMessage =
  | { type: "openspace:action"; action: BridgeAction }
  | { type: "openspace:navigate"; username: string; page?: BridgePage }
  | { type: "openspace:resize"; height: number }
  /**
   * Report one song in the player. The parent only acts on ids in its own
   * server-loaded track list for this profile, and shows that list's title.
   */
  | { type: "openspace:reportTrack"; trackId: string };
