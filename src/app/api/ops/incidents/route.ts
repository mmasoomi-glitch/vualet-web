import { NextResponse } from "next/server";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-guard";
import { reliabilityIdle } from "@/lib/reliability-runtime";

/**
 * The incident history: when it broke, how long it was down, and whether it is
 * still down. This is the endpoint that answers the question nobody could
 * answer after the four-day outage.
 *
 * Permission: health.read.
 *
 * Uses the IDLE runtime: reading history must not be the thing that starts
 * monitoring, or an operator opening the log during an incident would silently
 * change the system they are investigating.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireAdmin("health.read");
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 500);
    const wantEvents = url.searchParams.get("events") === "1";

    const runtime = reliabilityIdle();
    const [incidents, events] = await Promise.all([
      runtime.incidents(limit),
      wantEvents ? runtime.events(limit) : Promise.resolve([]),
    ]);

    return NextResponse.json({ limit, incidents, events });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
