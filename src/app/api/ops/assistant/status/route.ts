import { NextResponse } from "next/server";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-guard";
import { reliability } from "@/lib/reliability-runtime";
import { shouldAttemptRecovery, describeForOperator } from "../../../../../../ops/reliability/router.mjs";

/**
 * The assistant in full operator detail: its tracker, the provider it is
 * currently routed to, whether a recovery attempt is due, and the one-line
 * summary meant for a log or a dashboard.
 *
 * Permission: health.read.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin("health.read");
    const runtime = reliability();
    const status = runtime.status();
    const tracker = status.services.assistant ?? null;
    const nowMs = Date.now();

    return NextResponse.json({
      atMs: status.atMs,
      state: tracker ? tracker.state : "UNKNOWN",
      tracker,
      providers: runtime.providers,
      route: status.route,
      recovery: shouldAttemptRecovery(tracker, undefined, nowMs),
      summary: describeForOperator(status.route, tracker),
      alerts: runtime.recentAlerts(10),
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
