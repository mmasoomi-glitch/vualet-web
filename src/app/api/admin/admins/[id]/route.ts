import { NextResponse } from "next/server";
import { requireAdmin, adminErrorResponse, audit } from "@/lib/admin-guard";
import { getAdmin, listAdmins, removeAdmin, toPublic, updateAdmin } from "@/lib/admin-accounts";
import { isAdminRole, type AdminRole } from "@/lib/admin-roles";
import type { AdminStatus as AcctStatus } from "@/lib/admin-accounts";
import { listSessions, revokeSession } from "@/lib/admin-session";

/**
 * Manage a single admin (backend-generalised §7): assign role(s)/scope/expiry,
 * suspend/reactivate (PATCH), or remove entirely (DELETE). Both are owner-only
 * and reauth-gated. Guardrails: cannot remove/suspend yourself, cannot remove
 * the last remaining owner (never lock the platform out of admin management).
 */

async function activeOwnerCount(): Promise<number> {
  return (await listAdmins()).filter((a) => a.status === "active" && a.roles.includes("owner" as AdminRole)).length;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAdmin("admin.role.assign");
    const { id } = await params;
    const target = await getAdmin(id);
    if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });

    let body: { roles?: string[]; scope?: string | null; expiresAt?: number | null; status?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }

    const patch: { roles?: AdminRole[]; scope?: string; expiresAt?: number; status?: AcctStatus } = {};
    if (body.roles) {
      const roles = body.roles.filter(isAdminRole) as AdminRole[];
      if (roles.length === 0) return NextResponse.json({ error: "no_roles" }, { status: 400 });
      // Don't strip the last owner's owner role.
      if (target.roles.includes("owner") && !roles.includes("owner") && (await activeOwnerCount()) <= 1) {
        return NextResponse.json({ error: "last_owner", message: "Cannot demote the only owner." }, { status: 409 });
      }
      patch.roles = roles;
    }
    if (body.scope !== undefined) patch.scope = body.scope ?? undefined;
    if (body.expiresAt !== undefined) patch.expiresAt = body.expiresAt ?? undefined;
    if (body.status && (["active", "suspended"] as AcctStatus[]).includes(body.status as AcctStatus)) {
      if (id === ctx.admin.id && body.status === "suspended") {
        return NextResponse.json({ error: "self_suspend", message: "You cannot suspend yourself." }, { status: 409 });
      }
      if (body.status === "suspended" && target.roles.includes("owner") && (await activeOwnerCount()) <= 1) {
        return NextResponse.json({ error: "last_owner", message: "Cannot suspend the only owner." }, { status: 409 });
      }
      patch.status = body.status as AcctStatus;
    }

    const prev = toPublic(target);
    const updated = await updateAdmin(id, patch);
    if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });

    // Suspension takes effect instantly — kill their live sessions too.
    if (patch.status === "suspended") {
      for (const s of await listSessions(id)) await revokeSession(s.sid);
    }

    await audit(ctx, "admin.update", { target: id, prevState: prev, newState: toPublic(updated) });
    return NextResponse.json({ ok: true, account: toPublic(updated) });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAdmin("admin.remove");
    const { id } = await params;
    const target = await getAdmin(id);
    if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (id === ctx.admin.id) {
      return NextResponse.json({ error: "self_remove", message: "You cannot remove yourself." }, { status: 409 });
    }
    if (target.roles.includes("owner") && (await activeOwnerCount()) <= 1) {
      return NextResponse.json({ error: "last_owner", message: "Cannot remove the only owner." }, { status: 409 });
    }

    // Revoke live sessions first, then remove the account (instant revocation §7).
    for (const s of await listSessions(id)) await revokeSession(s.sid);
    await removeAdmin(id);

    await audit(ctx, "admin.remove", { target: id, prevState: toPublic(target) });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
