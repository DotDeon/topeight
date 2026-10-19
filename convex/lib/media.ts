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
