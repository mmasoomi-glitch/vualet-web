import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/connect-token";
import { ADMIN_COOKIE, ADMIN_SESSION_TTL_MS, adminConfigured, mintAdminSession } from "@/lib/admin-session";

// POST { password } → verifies against ADMIN_PASSWORD and sets the signed
// httpOnly session cookie middleware checks on every /admin request.
// DELETE → sign out (clears the cookie).

// Dependency-free brute-force protection: an in-memory per-IP attempt counter.
// After MAX_ATTEMPTS failed logins inside the window, the IP is locked out for
// LOCKOUT_MS and receives 429. A successful login clears the IP's record.
// (Best-effort: resets on redeploy and is per-instance — a hard rate limit
// belongs at the edge/proxy, this is defence-in-depth.)
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60_000; // count failures over 15 minutes
const LOCKOUT_MS = 15 * 60_000; // lock the IP for 15 minutes once tripped

type Attempt = { count: number; first: number; lockedUntil: number };
const attempts = new Map<string, Attempt>();

function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

function checkLocked(ip: string, now: number): number {
  const a = attempts.get(ip);
  if (a && a.lockedUntil > now) return Math.ceil((a.lockedUntil - now) / 1000);
  return 0;
}

function registerFailure(ip: string, now: number): void {
  let a = attempts.get(ip);
  if (!a || now - a.first > WINDOW_MS) {
    a = { count: 0, first: now, lockedUntil: 0 };
  }
  a.count += 1;
  if (a.count >= MAX_ATTEMPTS) a.lockedUntil = now + LOCKOUT_MS;
  attempts.set(ip, a);
  // Opportunistic cleanup so the map can't grow unbounded.
  if (attempts.size > 5000) {
    for (const [k, v] of attempts) {
      if (v.lockedUntil <= now && now - v.first > WINDOW_MS) attempts.delete(k);
    }
  }
}

export async function POST(req: Request) {
  if (!adminConfigured()) {
    return NextResponse.json(
      { error: "not_configured", message: "Set ADMIN_PASSWORD and ADMIN_SESSION_SECRET to enable the admin panel." },
      { status: 503 },
    );
  }

  const ip = clientIp(req);
  const now = Date.now();
  const cooldown = checkLocked(ip, now);
  if (cooldown > 0) {
    return NextResponse.json(
      { error: "too_many_attempts", message: `Too many failed attempts. Try again in ${cooldown}s.` },
      { status: 429, headers: { "Retry-After": String(cooldown) } },
    );
  }

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (!body.password || !safeEqual(body.password, process.env.ADMIN_PASSWORD!)) {
    registerFailure(ip, now);
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Success → clear this IP's failure record.
  attempts.delete(ip);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, mintAdminSession(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_SESSION_TTL_MS / 1000,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
