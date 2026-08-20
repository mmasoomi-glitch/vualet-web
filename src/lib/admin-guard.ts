import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  REAUTH_COOKIE,
  verifyAdminSession,
  verifyReauth,
  getSessionRecord,
  touchSession,
} from "@/lib/admin-session";
import { getAdmin, isUsable, type AdminAccount } from "@/lib/admin-accounts";
import { can, needsReauth, type Permission } from "@/lib/admin-roles";
import { appendAudit, type AuditResult } from "@/lib/admin-audit";
import { randomId } from "@/lib/admin-crypto";

/**
 * The single server-side authorization gate for every admin route.
 *
 * Enforces, in the SKILL §15 order:
 *   (1) authenticated admin session (signed cookie, MFA-complete)
 *   (2) live server session record (revocation kills it instantly)
 *   (3) account still usable (active + not expired)
 *   (4) role permission for the requested action
 *   (5) fresh MFA reauth for dangerous actions
 *   (6) an audit event is written for privileged actions
 *
 * The obscure URL is never the security; the middleware gate is only a coarse
 * first pass. THIS is authoritative.
 */

export type AdminContext = {
  admin: AdminAccount;
  sid: string;
  requestId: string;
  ip?: string;
};

export class AdminAuthError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function clientIpFromHeaders(): Promise<string | undefined> {
  const h = await headers();
  const cf = h.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return h.get("x-real-ip") || undefined;
}

/**
 * Resolve + authorize the current admin. Throws AdminAuthError on any failure
 * (the caller converts it to a JSON response via `adminErrorResponse`).
 */
export async function requireAdmin(permission?: Permission): Promise<AdminContext> {
  const c = await cookies();
  const requestId = randomId("req", 8);
  const ip = await clientIpFromHeaders();

  const session = verifyAdminSession(c.get(ADMIN_COOKIE)?.value);
  if (!session) throw new AdminAuthError(401, "unauthenticated", "No valid admin session.");

  const record = await getSessionRecord(session.sid);
  if (!record) throw new AdminAuthError(401, "session_revoked", "Session revoked or expired.");

  const admin = await getAdmin(session.aid);
  if (!admin) throw new AdminAuthError(401, "unknown_admin", "Admin account not found.");
  if (!isUsable(admin)) throw new AdminAuthError(403, "account_inactive", "Admin account is suspended or expired.");

  if (permission && !can(admin.roles, permission)) {
    // Log the denial (§8 — denied actions are visible to the owner).
    await appendAudit({
      adminId: admin.id,
      role: admin.roles.join(","),
      action: `denied:${permission}`,
      requestId,
      result: "denied",
      ip,
    });
    throw new AdminAuthError(403, "forbidden", "Your role does not permit this action.");
  }

  if (permission && needsReauth(permission)) {
    if (!verifyReauth(c.get(REAUTH_COOKIE)?.value, admin.id)) {
      throw new AdminAuthError(401, "reauth_required", "This action needs a fresh MFA confirmation.");
    }
  }

  await touchSession(session.sid);
  return { admin, sid: session.sid, requestId, ip };
}

export function adminErrorResponse(err: unknown): NextResponse {
  if (err instanceof AdminAuthError) {
    return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
  }
  console.error("[admin] unexpected error:", err);
  return NextResponse.json({ error: "internal_error" }, { status: 500 });
}

/** Convenience: write one audit row from an admin context. */
export async function audit(
  ctx: AdminContext,
  action: string,
  opts: { target?: string; prevState?: unknown; newState?: unknown; reason?: string; result?: AuditResult } = {},
): Promise<void> {
  await appendAudit({
    adminId: ctx.admin.id,
    role: ctx.admin.roles.join(","),
    action,
    target: opts.target,
    prevState: opts.prevState,
    newState: opts.newState,
    reason: opts.reason,
    requestId: ctx.requestId,
    result: opts.result ?? "success",
    ip: ctx.ip,
  });
}
