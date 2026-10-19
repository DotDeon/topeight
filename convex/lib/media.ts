/** Public R2 URL for an object key, or null when there is no key or no base URL. */
function publicUrl(key?: string): string | null {
  const base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  if (!key || !base) return null;
  return `${base.replace(/\/+$/, "")}/${key}`;
}

/** Public URL for an uploaded photo. */
export function photoUrl(key?: string): string | null {
  return publicUrl(key);
}

/** Public URL for an uploaded track. */
export function trackUrl(key?: string): string | null {
  return publicUrl(key);
}

const MB = 1024 * 1024;

/** Upload limits shared by the server checks and the client hook. */
export const MAX_TRACKS = 10;
export const TRACK_MAX_BYTES = 5 * MB;
export const TRACK_TYPES: readonly string[] = ["audio/mpeg"];
export const PHOTO_MAX_BYTES = 2 * MB;
export const PHOTO_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/gif", "image/webp"];
/** Pending uploads older than this are ignored and cannot get an upload URL. */
export const UPLOAD_TTL_MS = 60 * 60 * 1000;
export const TRACK_TITLE_MAX = 80;
