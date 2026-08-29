import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ADMIN_COOKIE = "mira_admin";

/**
 * Apply Strict-Transport-Security unless the request is for mira.vualet.com.
 * MEASURED 2026-08-29: Cloudflare fronts all three hosts but injects HSTS on
 * mira.vualet.com ONLY - the apex and www carried none at all. Setting it
 * unconditionally in next.config.ts would double the header on the sub-brand,
 * which is exactly why next.config.ts leaves it out. So it is added here, and
 * only where Cloudflare does not already supply it.
 * No `preload`: that is a one-way commitment requiring a separate submission.
 */
function withHsts(res: NextResponse, host: string): NextResponse {
  if (host.startsWith("mira.")) return res;
  res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return res;
}

/**
 * Edge-runtime COARSE gate for /admin (defense in depth). It verifies the
 * signed admin session cookie's HMAC + expiry + MFA flag using Web Crypto — the
 * twin of src/lib/admin-session.ts. It does NOT (and cannot from the edge) check
 * the server session record, account status, or role: that authoritative check
 * happens in every route via requireAdmin(). This gate only stops unauthenticated
 * HTML from ever rendering. The obscure URL is never the security.
 */

function devFallbackSecret(): string | null {
  return process.env.NODE_ENV === "production" ? null : "mira-dev-admin-secret-not-for-production";
}

// Derived signing key = SHA256(`${secret}::sign:session`) — mirrors admin-crypto.derivedKey.
async function signingKey(secret: string): Promise<CryptoKey> {
  const keyBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${secret}::sign:session`));
  return crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

function decodeB64UrlJson(b64: string): { exp?: number; mfa?: boolean; sid?: string; aid?: string } | null {
  try {
    const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
    const std = b64.replace(/-/g, "+").replace(/_/g, "/") + pad;
    const json = atob(std);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function verifyAdminCookie(value: string | undefined): Promise<boolean> {
  const secret = process.env.ADMIN_SESSION_SECRET || devFallbackSecret();
  if (!value || !secret) return false;
  const dot = value.indexOf(".");
  if (dot <= 0) return false;
  const b64 = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  try {
    const key = await signingKey(secret);
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(b64)));
    if (!timingSafeEqual(b64url(mac), sig)) return false;
    const data = decodeB64UrlJson(b64);
    if (!data || typeof data.exp !== "number" || data.exp < Date.now()) return false;
    return data.mfa === true && Boolean(data.sid) && Boolean(data.aid);
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const host = (req.headers.get("host") || "").toLowerCase();

  // Canonical host. www and the apex were both serving byte-identical 200s with
  // no redirect and no rel=canonical anywhere, so a crawler saw two complete
  // copies of the site and had to guess. 301, not the 307 default, because this
  // is a permanent decision search engines should cache. Cloning nextUrl keeps
  // the path and query; the protocol is forced to https because behind the
  // reverse proxy nextUrl carries the INTERNAL http scheme, and redirecting to
  // http would downgrade the visitor and cost a second hop.
  if (host.startsWith("www.")) {
    const url = req.nextUrl.clone();
    url.protocol = "https:";
    url.port = "";
    url.host = host.slice(4);
    return withHsts(NextResponse.redirect(url, 301), host);
  }

  const { pathname } = req.nextUrl;

  // Server-side admin gate: unauthenticated /admin requests never render the
  // dashboard — they land on the sign-in page instead.
  if (pathname.startsWith("/admin")) {
    const authed = await verifyAdminCookie(req.cookies.get(ADMIN_COOKIE)?.value);
    if (!authed) {
      const url = new URL("/admin-login", req.url);
      url.searchParams.set("next", pathname);
      return withHsts(NextResponse.redirect(url), host);
    }
    return withHsts(NextResponse.next(), host);
  }

  // mira.vualet.com → serve the Mira page at the subdomain root.
  // Use nextUrl.clone() (same-origin) rather than new URL("/mira", req.url):
  // behind a reverse proxy, req.url carries the internal host/proto, so building
  // an absolute URL turns this into a cross-origin rewrite that Next tries to
  // PROXY (https → the internal http port) and 500s. Cloning keeps it internal.
  if (host.startsWith("mira.") && pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/mira";
    return withHsts(NextResponse.rewrite(url), host);
  }
  return withHsts(NextResponse.next(), host);
}

export const config = {
  // Widened from ["/", "/admin/:path*"]: a host-level redirect cannot live on a
  // two-path matcher, it has to see every request. The exclusions keep middleware
  // off Next's static assets and off the text/XML routes that must be served
  // byte-exact by their own handlers.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|llms.txt|brand/).*)"],
};
