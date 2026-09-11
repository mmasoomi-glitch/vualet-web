import { NextResponse } from "next/server";
import { reliabilityIdle } from "@/lib/reliability-runtime";

/**
 * The customer-facing half of the reliability work: is the assistant degraded
 * right now, and what should the visitor be told.
 *
 * THIS ENDPOINT IS PUBLIC AND UNAUTHENTICATED, so it returns exactly two
 * fields and nothing else. It must never grow to include a state name, a
 * provider, an error string, a tracker or a latency — all of which are one
 * property access away and every one of which would be an information leak.
 * The operator view lives behind health.read at /api/ops/assistant/status.
 *
 * `notice` is always either null or one of the frozen USER_NOTICES strings,
 * which are tested against a forbidden-substring list.
 *
 * It uses the IDLE runtime: a visitor hitting the site must not be what starts
 * the monitoring subsystem.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { route } = reliabilityIdle().status();
    return NextResponse.json({
      degraded: route.degraded === true,
      notice: route.userNotice ?? null,
    });
  } catch {
    // If the reliability subsystem itself is broken, say nothing rather than
    // scaring a visitor about an assistant that is probably working fine.
    return NextResponse.json({ degraded: false, notice: null });
  }
}
