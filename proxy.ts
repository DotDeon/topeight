import { NextResponse, type NextRequest } from "next/server";
import { classifyHost, routeForHost } from "@/lib/hosts";

// Next.js 16 renamed middleware.ts to proxy.ts. Convex Auth is added in Task 3.
export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  let kind = classifyHost(host);
  // Unknown hosts are treated as main in development only.
  if (kind === "unknown" && process.env.NODE_ENV === "development") {
    kind = "main";
  }

  const route = routeForHost(kind, request.nextUrl.pathname);
  if (route.action === "rewrite") {
    const url = request.nextUrl.clone();
    url.pathname = route.to;
    return NextResponse.rewrite(url);
  }
  if (route.action === "notFound") {
    return new NextResponse("Not found", { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
