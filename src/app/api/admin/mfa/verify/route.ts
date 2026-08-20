import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import {
  PENDING_COOKIE,
  verifyPending,
  mintAdminSession,
  setSessionCookie,
  createSessionRecord,
  clearAdminCookies,
} from "@/lib/admin-session";
import { getAdmin, setMfaSecret, updateAdmin } from "@/lib/admin-accounts";
import { verifyTotp } from "@/lib/admin-totp";
import { kvGet, kvDel } from "@/lib/store";
import { decryptSecret, randomId } from "@/lib/admin-crypto";
import { appendAudit } from "@/lib/admin-audit";

/**
 * STEP 2 of admin login (backend-generalised §5): verify the TOTP code. Handles
 * both flows off the PENDING cookie:
 *   - purpose "enroll": confirm the pending seed, persist it, and log in.
 *   - purpose "mfa":    verify against the stored (decrypted) seed and log in.
 * On success we mint the full MFA-complete session + a server session record and
 * clear the pending cookie. Failures are audited; the pending cookie remains so
 * the user can retry within its short window.
 */

const pendingSeedKey = (aid: string) => `mira:admin:mfa:pending:${aid}`;

async function clientIp(): Promise<string | undefined> {
  const h = await headers();
  return (
    h.get("cf-connecting-ip")?.trim() ||
    h.get("x-forwarded-for")?.split(",")[0].trim() ||
    h.get("x-real-ip") ||
    undefined
  );
}

export async function POST(req: Request) {
  const c = await cookies();
  const pending = verifyPending(c.get(PENDING_COOKIE)?.value);
  if (!pending) return NextResponse.json({ error: "no_pending_session" }, { status: 401 });

  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const token = (body.token || "").trim();

  const admin = await getAdmin(pending.aid);
  if (!admin) return NextResponse.json({ error: "unknown_admin" }, { status: 401 });

  const ip = await clientIp();
  const ua = (await headers()).get("user-agent") || undefined;

  // Resolve the seed for this flow.
  let secret: string | null = null;
  const enrolling = pending.purpose === "enroll";
  if (enrolling) {
    secret = decryptSecret(await kvGet<string>(pendingSeedKey(admin.id)));
  } else {
    secret = decryptSecret(admin.mfaSecretEnc);
  }
  if (!secret) return NextResponse.json({ error: "mfa_not_ready", message: "Restart sign-in." }, { status: 400 });

  if (!verifyTotp(secret, token)) {
    await appendAudit({
      adminId: admin.id,
      role: admin.roles.join(","),
      action: enrolling ? "mfa.enroll.fail" : "mfa.verify.fail",
      requestId: randomId("req", 8),
      result: "denied",
      ip,
    });
    return NextResponse.json({ error: "invalid_code" }, { status: 401 });
  }

  // Success.
  if (enrolling) {
    await setMfaSecret(admin.id, secret);
    await kvDel(pendingSeedKey(admin.id));
  }
  await updateAdmin(admin.id, { lastLoginAt: new Date().toISOString() });

  const record = await createSessionRecord(admin.id, ip, ua);
  await setSessionCookie(mintAdminSession(record.sid, admin.id, admin.roles));
  // Clear the pending cookie (leave session/reauth handled by setSessionCookie).
  c.set(PENDING_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });

  await appendAudit({
    adminId: admin.id,
    role: admin.roles.join(","),
    action: enrolling ? "mfa.enroll.ok+login" : "login.mfa.ok",
    target: record.sid,
    requestId: randomId("req", 8),
    result: "success",
    ip,
  });

  return NextResponse.json({ ok: true });
}

// Defensive: never leave a half-authenticated state addressable.
export async function DELETE() {
  await clearAdminCookies();
  return NextResponse.json({ ok: true });
}
