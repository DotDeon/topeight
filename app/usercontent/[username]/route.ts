import { ConvexHttpClient } from "convex/browser";
import type { NextRequest } from "next/server";
import { api } from "@/convex/_generated/api";
import { classifyHost } from "@/lib/hosts";
import { buildUsercontentCsp } from "@/lib/profile/csp";
import { renderProfileDocument } from "@/lib/profile/render";
import { validateUsername } from "@/lib/validation";

// Sent on every response from this route, including 404s.
const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
  });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

/**
 * The rendered profile document, served only on the usercontent host (proxy.ts
 * rewrites `/<username>` there to this route and 404s `/usercontent/*` on the
 * main host; the host check here backs that up). No X-Frame-Options: the
 * main origin frames this page, and CSP frame-ancestors limits who may.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/usercontent/[username]">) {
  if (classifyHost(request.headers.get("host") ?? "") !== "usercontent") return notFound();

  const { username } = await ctx.params;
  const checked = validateUsername(username);
  if (!checked.ok || checked.username !== username) return notFound();

  const client = new ConvexHttpClient(requireEnv("NEXT_PUBLIC_CONVEX_URL"));
  const profile = await client.query(api.profiles.getPublicProfile, { username });
  if (profile === null || "unavailable" in profile) return notFound();

  const mainOrigin = requireEnv("NEXT_PUBLIC_MAIN_ORIGIN");
  const usercontentOrigin = requireEnv("NEXT_PUBLIC_USERCONTENT_ORIGIN");
  const csp = `${buildUsercontentCsp(usercontentOrigin)}; frame-ancestors ${mainOrigin}`;

  return new Response(renderProfileDocument(profile, { mainOrigin }), {
    status: 200,
    headers: {
      ...BASE_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": csp,
    },
  });
}
