/**
 * Frame passes let the usercontent route render a private profile. The frame's
 * domain can't see who is signed in, so the main site asks framePass.issue for a
 * pass after the server confirms the viewer may see the full page, and puts it
 * in the frame address. A pass is tied to one profile, not to a viewer, and lasts
 * 2 hours.
 *
 * Format: `<expiresAtMs>.<base64url HMAC-SHA256(secret, profileId + "." + expiresAtMs)>`.
 * The secret is FRAME_PASS_SECRET on the Convex deployment and never leaves it.
 * Pure Web Crypto, no Convex imports, so tests can call it directly.
 */

export const FRAME_PASS_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * The shape of a pass. 43 characters is 32 bytes of HMAC-SHA256 in unpadded
 * base64url. lib/hosts.ts uses it to decide which `pass` values reach the route.
 */
export const FRAME_PASS_FORMAT = /^([1-9][0-9]{0,15})\.([A-Za-z0-9_-]{43})$/;
const TOKEN = FRAME_PASS_FORMAT;

/** The deployment's FRAME_PASS_SECRET, or null when unset or blank. */
export function framePassSecret(): string | null {
  const secret = process.env.FRAME_PASS_SECRET ?? "";
  return secret === "" ? null : secret;
}

function base64url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function mac(profileId: string, expiresAt: number, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return base64url(await crypto.subtle.sign("HMAC", key, enc.encode(`${profileId}.${expiresAt}`)));
}

/** Equal-length strings compared without an early exit. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Signs a pass for `profileId` that expires at `expiresAt` (ms). Throws on a blank secret. */
export async function signFramePass(profileId: string, expiresAt: number, secret: string): Promise<string> {
  if (secret === "") throw new Error("FRAME_PASS_SECRET is not set");
  return `${expiresAt}.${await mac(profileId, expiresAt, secret)}`;
}

/**
 * True when `token` is a well-formed pass for `profileId`, signed with `secret`,
 * not expired at `now`, and expiring no later than a pass issued at `now` would.
 * False for anything else, including a missing secret.
 */
export async function verifyFramePass(
  token: string | null | undefined,
  profileId: string,
  now: number,
  secret: string | null | undefined,
): Promise<boolean> {
  if (!secret || typeof token !== "string") return false;
  const match = TOKEN.exec(token);
  if (match === null) return false;
  const expiresAt = Number(match[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + FRAME_PASS_TTL_MS) return false;
  return constantTimeEqual(match[2], await mac(profileId, expiresAt, secret));
}
