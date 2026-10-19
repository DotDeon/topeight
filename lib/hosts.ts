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

export function routeForHost(kind: HostKind, pathname: string): HostRoute {
  if (kind === "usercontent") {
    // Only single-segment profile paths are served on the usercontent host.
    if (/^\/[^/]+$/.test(pathname)) {
      return { action: "rewrite", to: `/usercontent${pathname}` };
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
