/**
 * Parent (main origin) half of the profile bridge. Messages arrive from
 * untrusted artist code in the sandboxed iframe, so every field is checked
 * and only a freshly built, known-good message is returned.
 */
import {
  BRIDGE_ACTIONS,
  BRIDGE_PAGES,
  type BridgeMessage,
} from "@/lib/bridge-protocol";
import { validateUsername } from "@/lib/validation";

export type { BridgeAction, BridgeMessage, BridgePage } from "@/lib/bridge-protocol";

/** Largest height the parser accepts. ProfileFrame clamps further. */
export const MAX_REPORTED_HEIGHT = 50_000;
export const MIN_FRAME_HEIGHT = 150;
export const MAX_FRAME_HEIGHT = 20_000;

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

/**
 * Returns the message only if it came from `frame` (the profile iframe's
 * contentWindow) with the opaque origin a sandbox without allow-same-origin
 * gets, and its payload is valid. Anything else returns null.
 */
export function parseBridgeMessage(
  ev: { origin: string; data: unknown; source: unknown },
  frame: unknown,
): BridgeMessage | null {
  if (ev.origin !== "null") return null;
  if (frame === null || frame === undefined || ev.source !== frame) return null;
  const data = ev.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const msg = data as Record<string, unknown>;

  switch (msg.type) {
    case "openspace:action":
      return isOneOf(BRIDGE_ACTIONS, msg.action) ? { type: "openspace:action", action: msg.action } : null;

    case "openspace:resize": {
      const h = msg.height;
      if (typeof h !== "number" || !Number.isFinite(h) || h < 0 || h > MAX_REPORTED_HEIGHT) return null;
      return { type: "openspace:resize", height: h };
    }

    case "openspace:navigate": {
      if (typeof msg.username !== "string") return null;
      const checked = validateUsername(msg.username);
      if (!checked.ok) return null;
      if (msg.page === undefined) return { type: "openspace:navigate", username: checked.username };
      if (!isOneOf(BRIDGE_PAGES, msg.page)) return null;
      return { type: "openspace:navigate", username: checked.username, page: msg.page };
    }

    default:
      return null;
  }
}

/** Frame height in CSS pixels, kept between 150 and 20000. */
export function clampFrameHeight(height: number): number {
  return Math.min(MAX_FRAME_HEIGHT, Math.max(MIN_FRAME_HEIGHT, Math.ceil(height)));
}

/** Main-origin path for a navigate message: `/<username>` or `/<username>/<page>`. */
export function navigatePath(msg: Extract<BridgeMessage, { type: "openspace:navigate" }>): string {
  return msg.page ? `/${msg.username}/${msg.page}` : `/${msg.username}`;
}
