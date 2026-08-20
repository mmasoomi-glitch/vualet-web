import { NextResponse } from "next/server";
import { requireAdmin, adminErrorResponse, audit } from "@/lib/admin-guard";
import { listSessions, revokeSession, getSessionRecord } from "@/lib/admin-session";
import { can } from "@/lib/admin-roles";

/**
 * Active session management (backend-generalised §5/§7).
 *   GET  → list active sessions. Own by default; ?aid=<id> for another admin
 *          requires sessions.read.any.
 *   DELETE {sid} → revoke a session. Own sessions freely; another admin's
 *          session requires sessions.revoke.any (reauth-gated). Instant.
 */

export async function GET(req: Request) {
  try {
    const ctx = await requireAdmin();
    const url = new URL(req.url);
    const aid = url.searchParams.get("aid") || ctx.admin.id;
    if (aid !== ctx.admin.id && !can(ctx.admin.roles, "sessions.read.any")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const sessions = (await listSessions(aid)).map((s) => ({
      sid: s.sid,
      current: s.sid === ctx.sid,
      createdAt: s.createdAt,
      lastSeen: s.lastSeen,
      ip: s.ip,
      ua: s.ua,
    }));
    return NextResponse.json({ sessions });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function DELETE(req: Request) {
  try {
    let body: { sid?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    const sid = (body.sid || "").trim();
    if (!sid) return NextResponse.json({ error: "missing_sid" }, { status: 400 });

    const record = await getSessionRecord(sid);
    // First resolve the caller with base auth to learn ownership.
    const self = await requireAdmin();
    const isOwn = record?.aid === self.admin.id;

    // Revoking someone else's session is a dangerous, reauth-gated action.
    const ctx = isOwn ? self : await requireAdmin("sessions.revoke.any");

    if (!record) return NextResponse.json({ error: "not_found" }, { status: 404 });
    await revokeSession(sid);
    await audit(ctx, isOwn ? "session.revoke.self" : "session.revoke.other", {
      target: sid,
      newState: { aid: record.aid },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
