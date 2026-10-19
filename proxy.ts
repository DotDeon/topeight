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
    return new NextResponse("Not found", { status: 404 });
  }
  return convexAuth(request, event);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
