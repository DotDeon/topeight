import { ConvexHttpClient } from "convex/browser";
import type { NextRequest } from "next/server";
import { api } from "@/convex/_generated/api";
import { classifyHost } from "@/lib/hosts";
import { buildUsercontentCsp } from "@/lib/profile/csp";
import { renderProfileDocument } from "@/lib/profile/render";
import { validateUsername } from "@/lib/validation";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

/** Sent on every response from this route, including 404 and 503. */
function baseHeaders(csp: string): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "Content-Security-Policy": csp,
  };
}

function plain(status: number, body: string, csp: string): Response {
  return new Response(body, {
    status,
    headers: { ...baseHeaders(csp), "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * The rendered profile document, served only on the usercontent host (proxy.ts
 * rewrites `/<username>` there to this route and 404s `/usercontent/*` on the
 * main host; the host check here backs that up). No X-Frame-Options: the
 * main origin frames this page, and CSP frame-ancestors limits who may.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/usercontent/[username]">) {
  const mainOrigin = requireEnv("NEXT_PUBLIC_MAIN_ORIGIN");
  const usercontentOrigin = requireEnv("NEXT_PUBLIC_USERCONTENT_ORIGIN");
  // sandbox: opened directly in a tab, the document still runs in an opaque
  // origin, so artist JS never gets the real usercontent origin's cookies or storage.
  const csp = `${buildUsercontentCsp(usercontentOrigin)}; frame-ancestors ${mainOrigin}; sandbox allow-scripts allow-popups`;

  if (classifyHost(request.headers.get("host") ?? "") !== "usercontent") {
    return plain(404, "Not found", csp);
  }

  const { username } = await ctx.params;
  const checked = validateUsername(username);
  if (!checked.ok || checked.username !== username) return plain(404, "Not found", csp);

  let profile;
  try {
    const client = new ConvexHttpClient(requireEnv("NEXT_PUBLIC_CONVEX_URL"));
    profile = await client.query(api.profiles.getPublicProfile, { username });
  } catch (e) {
    console.error("usercontent: getPublicProfile failed", e);
    return plain(503, "Profile temporarily unavailable", csp);
  }
  if (profile === null || "unavailable" in profile) return plain(404, "Not found", csp);

  return new Response(renderProfileDocument(profile, { mainOrigin }), {
    status: 200,
    headers: { ...baseHeaders(csp), "Content-Type": "text/html; charset=utf-8" },
  });
}
