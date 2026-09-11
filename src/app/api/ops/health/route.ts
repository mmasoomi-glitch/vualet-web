import { NextResponse } from "next/server";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-guard";
import { reliability } from "@/lib/reliability-runtime";

/**
 * The one-line answer to "is the assistant working right now".
 *
 * Permission: health.read (owner/security/ops/auditor). This exposes internal
 * state names, provider routing and error strings, which is exactly what an
 * operator needs and exactly what a customer must never see — hence the guard.
 *
 * Reading this endpoint also starts the poller, so the monitor comes up with
 * the site rather than waiting for someone to remember to start it.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin("health.read");
    const runtime = reliability();
    return NextResponse.json({
      ...runtime.status(),
      polling: runtime.isRunning(),
      alerts: runtime.recentAlerts(5),
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
