import { ConvexHttpClient } from "convex/browser";
import type { NextRequest } from "next/server";
import { api } from "@/convex/_generated/api";
import { classifyHost } from "@/lib/hosts";
import { currentMinute } from "@/lib/minute";
import { buildUsercontentCsp } from "@/lib/profile/csp";
import { renderProfileDocument } from "@/lib/profile/render";
import { validateUsername } from "@/lib/validation";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

/** Frame passes are about 60 characters. */
const MAX_PASS_LENGTH = 200;

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
 *
 * Track URLs are signed here at render time (media.playbackUrls, 15 minutes).
 * `?format=tracks` returns just those URLs as JSON, with the same 404 rules, for
 * the player to refresh them from its opaque-origin frame.
 *
 * Private profiles render, and answer `?format=tracks`, only with `?pass=`, a
 * valid frame pass for that profile (convex/lib/framePass.ts). Without one they
 * 404: the restricted card is the main site's job, never the frame's. Public
 * profiles ignore the pass.
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

  const params = new URL(request.url).searchParams;
  const tracksOnly = params.get("format") === "tracks";
  // The parent sets own=1 when the visitor is on their own page. It only hides links.
  const hidePick = params.get("own") === "1";
  // Passes are short; anything longer is junk and isn't sent on.
  const rawPass = params.get("pass");
  const pass = rawPass && rawPass.length <= MAX_PASS_LENGTH ? rawPass : undefined;
  let profile;
  let signed: Array<{ id: string; url: string; profileSong?: true }> | null;
  try {
    const client = new ConvexHttpClient(requireEnv("NEXT_PUBLIC_CONVEX_URL"));
    // The current minute, so a cached profile can't keep a stale Online Now!.
    const asOf = currentMinute();
    // The tracks refresh only needs existence, ban and private status, so it skips the full profile.
    [profile, signed] = await Promise.all([
      tracksOnly
        ? client.query(api.profiles.profileHeader, { username })
        : client.query(api.profiles.getPublicProfile, { username, asOf }),
      client.action(api.media.playbackUrls, { username, ...(pass ? { pass } : {}) }).catch((e: unknown) => {
        console.error("usercontent: playbackUrls failed", e);
        return null;
      }),
    ]);
    // This client is signed out, so a private profile always comes back restricted.
    // Only a valid pass gets past that.
    if (profile !== null && "restricted" in profile && profile.restricted) {
      if (!pass) return plain(404, "Not found", csp);
      if (tracksOnly) {
        if (!(await client.action(api.framePass.verify, { username, pass }))) return plain(404, "Not found", csp);
        profile = { ...profile, restricted: false };
      } else {
        profile = await client.action(api.profiles.getPublicProfileWithPass, { username, pass, asOf });
      }
    }
  } catch (e) {
    console.error("usercontent: profile lookup failed", e);
    return plain(503, "Profile temporarily unavailable", csp);
  }
  if (
    profile === null ||
    ("banned" in profile && profile.banned) ||
    "unavailable" in profile ||
    ("restricted" in profile && profile.restricted)
  ) {
    return plain(404, "Not found", csp);
  }

  if (tracksOnly) {
    if (signed === null) return plain(503, "Tracks temporarily unavailable", csp);
    const tracks = signed.map(({ id, url, profileSong }) => ({ id, url, ...(profileSong ? { profileSong } : {}) }));
    return new Response(JSON.stringify({ tracks }), {
      status: 200,
      headers: {
        ...baseHeaders(csp),
        "Content-Type": "application/json; charset=utf-8",
        // The player runs in a sandboxed, opaque-origin frame. No credentials are sent.
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Without signed URLs the page still renders, just without a player.
  const urls = new Map((signed ?? []).filter((t) => !t.profileSong).map((t) => [t.id, t.url]));
  const signedSong = signed?.find((t) => t.profileSong);
  if (!("tracks" in profile)) return plain(404, "Not found", csp);
  const tracks = profile.tracks.map((t) => ({ ...t, url: urls.get(t.id) ?? null }));
  // The profile song's URL comes only from the flagged entry, and only when it signs the same track.
  const song = profile.profileSong;
  const profileSong = song && { ...song, url: signedSong?.id === song.id ? signedSong.url : null };
  return new Response(renderProfileDocument({ ...profile, tracks, profileSong }, { mainOrigin, usercontentOrigin, hidePick }), {
    status: 200,
    headers: { ...baseHeaders(csp), "Content-Type": "text/html; charset=utf-8" },
  });
}
