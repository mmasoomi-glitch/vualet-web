import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { requireAdmin, adminErrorResponse, audit } from "@/lib/admin-guard";
import { createInvite, listAdmins, toPublic } from "@/lib/admin-accounts";
import { isAdminRole, type AdminRole } from "@/lib/admin-roles";
import { emailConfigured, sendMail } from "@/lib/email";

/**
 * Admin delegation directory (backend-generalised §7).
 *   GET  → list admins (metadata only) — permission admin.read
 *   POST → invite a new admin with role(s)/scope/expiry — permission admin.invite
 *          (owner; reauth-gated). Emails an invite link when SMTP is configured
 *          and also returns the link so the owner can share it directly.
 */

export async function GET() {
  try {
    await requireAdmin("admin.read");
    const admins = (await listAdmins()).map(toPublic);
    return NextResponse.json({ admins });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") || "mira.vualet.com";
  const proto = h.get("x-forwarded-proto") || (process.env.NODE_ENV === "production" ? "https" : "http");
  return `${proto}://${host}`;
}

export async function POST(req: Request) {
  try {
    const ctx = await requireAdmin("admin.invite");
    let body: { email?: string; roles?: string[]; scope?: string; expiresAt?: number };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    const email = (body.email || "").trim().toLowerCase();
    const roles = (body.roles || []).filter(isAdminRole) as AdminRole[];
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ error: "invalid_email" }, { status: 400 });
    }
    if (roles.length === 0) {
      return NextResponse.json({ error: "no_roles", message: "Assign at least one role." }, { status: 400 });
    }

    const { account, inviteToken } = await createInvite({
      email,
      roles,
      scope: body.scope?.trim() || undefined,
      expiresAt: typeof body.expiresAt === "number" ? body.expiresAt : undefined,
      createdBy: ctx.admin.id,
    });

    const inviteUrl = `${await origin()}/admin-invite?email=${encodeURIComponent(email)}&token=${encodeURIComponent(inviteToken)}`;

    let emailed = false;
    if (emailConfigured()) {
      try {
        await sendMail(
          email,
          "You've been invited to Vualet Admin",
          `<p>You've been granted admin access to Vualet (roles: ${roles.join(", ")}).</p><p><a href="${inviteUrl}">Set your password and sign in</a>. This link expires in 7 days. You'll set up an authenticator app on first sign-in.</p>`,
          `You've been granted admin access to Vualet (roles: ${roles.join(", ")}).\nSet your password: ${inviteUrl}\nThis link expires in 7 days.`,
        );
        emailed = true;
      } catch {
        emailed = false;
      }
    }

    await audit(ctx, "admin.invite", {
      target: account.id,
      newState: { email, roles, scope: account.scope, expiresAt: account.expiresAt, emailed },
    });

    return NextResponse.json({ ok: true, account: toPublic(account), inviteUrl, emailed });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
