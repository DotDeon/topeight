/**
 * Content security policy for profile documents on the usercontent origin.
 * Task 7 sends this as a response header. The string is fixed by the global
 * constraints; only connect-src varies, and it is pinned to the usercontent
 * origin itself so artist code cannot send data elsewhere.
 */
export function buildUsercontentCsp(usercontentOrigin: string): string {
  return [
    "default-src 'none'",
    "script-src * 'unsafe-inline' 'unsafe-eval'",
    "style-src * 'unsafe-inline'",
    "img-src * data: blob:",
    "media-src * data: blob:",
    "frame-src *",
    "font-src * data:",
    `connect-src ${usercontentOrigin}`,
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}
