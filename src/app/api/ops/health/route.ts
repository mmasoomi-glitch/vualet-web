import { NextResponse } from "next/server";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-guard";
import { reliability, alertTransportReady } from "@/lib/reliability-runtime";
import { channelReadiness } from "@/lib/channel-readiness";

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
      // Reported here because this endpoint is where an operator looks first.
      // Automatic reconnection is built and inert until the engine calls in,
      // and that failure is silent — everything answers, nothing happens.
      channelRecovery: await channelReadiness(Date.now()),
      // Where alerts actually go. An operator must be able to see that the
      // answer is "nowhere" — a monitor whose alarms reach no one is the
      // failure this subsystem exists to remove, wearing a working dashboard.
      alerting: {
        transportReady: alertTransportReady(),
        destinationConfigured: (process.env.MIRA_ALERT_EMAIL || "").trim().length > 0,
        ...runtime.notifications(),
      },
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
