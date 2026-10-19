import { convexAuthNextjsMiddleware } from "@convex-dev/auth/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { classifyHost, routeForHost } from "@/lib/hosts";

// Next.js 16 renamed middleware.ts to proxy.ts. Convex Auth's helper returns a
// plain middleware function, which has the same (request, event) signature.
const convexAuth = convexAuthNextjsMiddleware();

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const host = request.headers.get("host") ?? "";
  let kind = classifyHost(host);
  // Unknown hosts are treated as main in development only.
  if (kind === "unknown" && process.env.NODE_ENV === "development") {
    kind = "main";
  }

  // Host routing runs first so the usercontent host never touches auth
  // cookies or the /api/auth proxy.
  const route = routeForHost(kind, request.nextUrl.pathname);
  if (route.action === "rewrite") {
    const url = request.nextUrl.clone();
    url.pathname = route.to;
    return NextResponse.rewrite(url);
  }
  if (route.action === "notFound") {
    const res = new NextResponse("Not found", { status: 404 });
    return kind === "main" ? denyFraming(res) : res;
  }
  const res = (await convexAuth(request, event)) ?? NextResponse.next();
  return denyFraming(res);
}

/**
 * Main-host pages hold the visitor's login and the trusted controls, so no
 * other page (artist code included, which may embed any frame) may frame them.
 */
function denyFraming(res: Response): Response {
  const set = (r: Response) => {
    r.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
    r.headers.set("X-Frame-Options", "DENY");
    return r;
  };
  try {
    return set(res);
  } catch {
    // Responses proxied from fetch can have immutable headers.
    return set(new Response(res.body, res));
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
