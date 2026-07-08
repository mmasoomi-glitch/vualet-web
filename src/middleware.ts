import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ADMIN_COOKIE = "mira_admin";

// Edge-runtime twin of src/lib/admin-session.ts verifyAdminSession (Node
// crypto isn't available here, so Web Crypto).
async function verifyAdminCookie(value: string | undefined): Promise<boolean> {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!value || !secret) return false;
  const dot = value.indexOf(".");
  if (dot <= 0) return false;
  const exp = value.slice(0, dot);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(exp)));
    let b64 = "";
    for (const byte of mac) b64 += String.fromCharCode(byte);
    const expect = btoa(b64).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return expect === value.slice(dot + 1);
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Server-side admin gate: unauthenticated /admin requests never render the
  // dashboard — they land on the sign-in page instead.
  if (pathname.startsWith("/admin")) {
    const authed = await verifyAdminCookie(req.cookies.get(ADMIN_COOKIE)?.value);
    if (!authed) {
      const url = new URL("/admin-login", req.url);
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // mira.vualet.com → serve the Mira page at the subdomain root.
  const host = (req.headers.get("host") || "").toLowerCase();
  if (host.startsWith("mira.") && pathname === "/") {
    return NextResponse.rewrite(new URL("/mira", req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/", "/admin/:path*"] };
