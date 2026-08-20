import { NextResponse } from "next/server";
import { requireAdmin, adminErrorResponse, audit } from "@/lib/admin-guard";
import { mintReauth, setReauthCookie } from "@/lib/admin-session";
import { verifyTotp } from "@/lib/admin-totp";
import { decryptSecret } from "@/lib/admin-crypto";

/**
 * Step-up re-authentication (backend-generalised §5): dangerous actions require
 * a fresh MFA confirmation. The admin re-enters a TOTP code; on success we set a
 * short-lived REAUTH cookie that requireAdmin() checks for reauth-gated
 * permissions (see admin-roles.REAUTH_REQUIRED).
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireAdmin(); // any authenticated admin may reauth
    let body: { token?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    const secret = decryptSecret(ctx.admin.mfaSecretEnc);
    if (!secret || !verifyTotp(secret, (body.token || "").trim())) {
      await audit(ctx, "reauth.fail", { result: "denied" });
      return NextResponse.json({ error: "invalid_code" }, { status: 401 });
    }
    await setReauthCookie(mintReauth(ctx.admin.id));
    await audit(ctx, "reauth.ok");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
