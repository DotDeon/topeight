import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";

/**
 * fetchQuery options that carry the signed-in viewer's login, so server pages
 * get what this viewer may see (a friend sees a private profile in full).
 * Signed out, the token is undefined and the call is anonymous.
 */
export async function viewerAuth(): Promise<{ token?: string }> {
  const token = await convexAuthNextjsToken();
  return token ? { token } : {};
}
