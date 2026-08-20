import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { PENDING_COOKIE, verifyPending } from "@/lib/admin-session";
import { getAdmin } from "@/lib/admin-accounts";
import { generateTotpSecret, otpauthURL } from "@/lib/admin-totp";
import { kvSet } from "@/lib/store";
import { encryptSecret } from "@/lib/admin-crypto";

/**
 * MFA enrolment (backend-generalised §5): requires the short PENDING cookie from
 * a successful password step, and only for an admin who has not yet enrolled.
 * We generate a fresh TOTP seed, stash it ENCRYPTED server-side (kv, 10m TTL)
 * pending confirmation, and return the otpauth URI + secret so the client can
 * render a QR / offer manual entry. The seed becomes permanent only after the
 * admin proves possession via /api/admin/mfa/verify.
 */

const pendingSeedKey = (aid: string) => `mira:admin:mfa:pending:${aid}`;

export async function POST() {
  const c = await cookies();
  const pending = verifyPending(c.get(PENDING_COOKIE)?.value);
  if (!pending) return NextResponse.json({ error: "no_pending_session" }, { status: 401 });

  const admin = await getAdmin(pending.aid);
  if (!admin) return NextResponse.json({ error: "unknown_admin" }, { status: 401 });
  if (admin.mfaEnrolled) return NextResponse.json({ error: "already_enrolled" }, { status: 409 });

  const secret = generateTotpSecret();
  await kvSet(pendingSeedKey(admin.id), encryptSecret(secret), 10 * 60);

  return NextResponse.json({
    secret, // shown once for manual entry; never persisted in plaintext
    otpauth: otpauthURL(secret, admin.email),
    email: admin.email,
  });
}
