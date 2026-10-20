export type HostKind = "main" | "usercontent" | "unknown";

export type HostRoute =
  | { action: "next" }
  | { action: "rewrite"; to: string }
  | { action: "notFound" };

function hostOf(origin: string | undefined): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

export function classifyHost(host: string): HostKind {
  const h = host.toLowerCase();
  if (h === hostOf(process.env.NEXT_PUBLIC_MAIN_ORIGIN)) return "main";
  if (h === hostOf(process.env.NEXT_PUBLIC_USERCONTENT_ORIGIN)) return "usercontent";
  return "unknown";
}

/**
 * Where a request goes. `to` may carry a query string. On the usercontent host
 * the only query kept is `?format=tracks` (the player's playback URL refresh)
 * and `?own=1` (the parent hides the pick links on the visitor's own page).
 * Only those exact values are forwarded, and they are forwarded explicitly:
 * the route does not rely on the original request's query surviving a rewrite.
 */
export function routeForHost(kind: HostKind, pathname: string, search = ""): HostRoute {
  if (kind === "usercontent") {
    // Only single-segment profile paths are served on the usercontent host.
    if (/^\/[^/]+$/.test(pathname)) {
      const q = new URLSearchParams(search);
      const kept = new URLSearchParams();
      if (q.get("format") === "tracks") kept.set("format", "tracks");
      if (q.get("own") === "1") kept.set("own", "1");
      const qs = kept.toString();
      return { action: "rewrite", to: `/usercontent${pathname}${qs ? `?${qs}` : ""}` };
    }
    return { action: "notFound" };
  }
  if (kind === "main") {
    if (pathname === "/usercontent" || pathname.startsWith("/usercontent/")) {
      return { action: "notFound" };
    }
    return { action: "next" };
  }
  return { action: "notFound" };
}
