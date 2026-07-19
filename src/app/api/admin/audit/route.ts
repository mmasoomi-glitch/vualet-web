import { NextResponse } from "next/server";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-guard";
import { getAuditLog, verifyAuditChain } from "@/lib/admin-audit";

/**
 * Read the append-only admin audit trail + its tamper-evidence status
 * (backend-generalised §8). Permission: audit.read (owner/security/auditor).
 * Read-only — there is no route anywhere that edits or deletes audit rows.
 */
export async function GET(req: Request) {
  try {
    await requireAdmin("audit.read");
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 200, 1), 1000);
    const [rows, chain] = await Promise.all([getAuditLog(limit), verifyAuditChain()]);
    return NextResponse.json({ chain, rows });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
