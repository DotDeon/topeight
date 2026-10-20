/** Returns the URL if it is a valid http(s) URL, otherwise null. */
export function supportUrl(raw?: string): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
