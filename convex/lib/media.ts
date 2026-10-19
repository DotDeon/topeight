/** Public URL for an uploaded object key, or null when there is no key or no base URL. */
export function photoUrl(key?: string): string | null {
  const base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  if (!key || !base) return null;
  return `${base.replace(/\/+$/, "")}/${key}`;
}
