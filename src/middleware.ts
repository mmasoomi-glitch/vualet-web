import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// mira.vualet.com → serve the Mira page at the subdomain root.
export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") || "").toLowerCase();
  if (host.startsWith("mira.") && req.nextUrl.pathname === "/") {
    return NextResponse.rewrite(new URL("/mira", req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/"] };
