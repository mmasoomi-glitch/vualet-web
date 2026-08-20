import { NextResponse } from "next/server";
import { headers } from "next/headers";
import {
  adminConfigured,
  ADMIN_COOKIE,
  verifyAdminSession,
  mintPending,
  setPendingCookie,
  clearAdminCookies,
  revokeSession,
} from "@/lib/admin-session";
import { cookies } from "next/headers";
import {
  ensureOwnerBootstrap,
  getAdminByEmail,
  isUsable,
  verifyAdminPassword,
} from "@/lib/admin-accounts";
import { appendAudit } from "@/lib/admin-audit";
import { randomId } from "@/lib/admin-crypto";

/**
 * STEP 1 of admin login (backend-generalised §5/§15): per-admin email+password.
 * On success we do NOT mint a full session — we mint a short PENDING cookie and
 * require MFA (step 2 = /api/admin/mfa/verify) or MFA enrolment first. Every
 * login attempt is rate-limited per IP and audited.
 *
 * DELETE = sign out: revoke the server session record and clear cookies.
 */

// Dependency-free per-IP brute-force protection (defence in depth; a hard limit
// belongs at the edge). After MAX_ATTEMPTS failures in WINDOW_MS, lock LOCKOUT_MS.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60_000;
const LOCKOUT_MS = 15 * 60_000;
type Attempt = { count: number; first: number; lockedUntil: number };
const attempts = new Map<string, Attempt>();

async function clientIp(): Promise<string> {
  const h = await headers();
  const cf = h.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return h.get("x-real-ip") || "unknown";
}

function checkLocked(ip: string, now: number): number {
  const a = attempts.get(ip);
  if (a && a.lockedUntil > now) return Math.ceil((a.lockedUntil - now) / 1000);
  return 0;
}
function registerFailure(ip: string, now: number): void {
  let a = attempts.get(ip);
  if (!a || now - a.first > WINDOW_MS) a = { count: 0, first: now, lockedUntil: 0 };
  a.count += 1;
  if (a.count >= MAX_ATTEMPTS) a.lockedUntil = now + LOCKOUT_MS;
  attempts.set(ip, a);
  if (attempts.size > 5000) {
    for (const [k, v] of attempts) if (v.lockedUntil <= now && now - v.first > WINDOW_MS) attempts.delete(k);
  }
}

export async function POST(req: Request) {
  if (!adminConfigured()) {
    return NextResponse.json(
      { error: "not_configured", message: "Set ADMIN_SESSION_SECRET to enable the admin panel." },
      { status: 503 },
    );
  }
  await ensureOwnerBootstrap();

  const ip = await clientIp();
  const now = Date.now();
  const cooldown = checkLocked(ip, now);
  if (cooldown > 0) {
    return NextResponse.json(
      { error: "too_many_attempts", message: `Too many failed attempts. Try again in ${cooldown}s.` },
      { status: 429, headers: { "Retry-After": String(cooldown) } },
    );
  }

  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  if (!email || !password) {
    return NextResponse.json({ error: "missing_credentials" }, { status: 400 });
  }

  const admin = await getAdminByEmail(email);
  // Constant-ish work + generic error: never reveal whether the email exists.
  const ok = admin != null && isUsable(admin) && verifyAdminPassword(admin, password);
  if (!ok || !admin) {
    registerFailure(ip, now);
    await appendAudit({
      adminId: admin?.id ?? "unknown",
      role: admin?.roles.join(",") ?? "-",
      action: "login.password.fail",
      requestId: randomId("req", 8),
      result: "denied",
      ip,
    });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  attempts.delete(ip);

  // Password OK → require MFA. Enrol first if this admin has no TOTP seed yet.
  const purpose = admin.mfaEnrolled ? "mfa" : "enroll";
  await setPendingCookie(mintPending(admin.id, purpose));
  await appendAudit({
    adminId: admin.id,
    role: admin.roles.join(","),
    action: "login.password.ok",
    requestId: randomId("req", 8),
    result: "success",
    newState: { next: purpose },
    ip,
  });
  return NextResponse.json({ ok: true, next: purpose });
}

export async function DELETE() {
  const c = await cookies();
  const session = verifyAdminSession(c.get(ADMIN_COOKIE)?.value);
  if (session) {
    await revokeSession(session.sid);
    await appendAudit({
      adminId: session.aid,
      role: session.roles.join(","),
      action: "logout",
      target: session.sid,
      requestId: randomId("req", 8),
      result: "success",
    });
  }
  await clearAdminCookies();
  return NextResponse.json({ ok: true });
}
