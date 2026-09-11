import { NextResponse } from "next/server";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-guard";
import { reliability } from "@/lib/reliability-runtime";

/**
 * Per-service detail: what is monitored, what each one's tracker says, and
 * how often it is currently being polled.
 *
 * Permission: health.read.
 *
 * The service list deliberately reports the URL being probed. An operator
 * chasing a false alarm needs to see that the probe is pointed at the wrong
 * host, which is invisible if you only report the verdict.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await requireAdmin("health.read");
    const runtime = reliability();
    const body = await req.json().catch(() => ({}));
    const name = typeof body?.service === "string" ? body.service : "";
    if (!name) {
      return NextResponse.json({ error: "service is required" }, { status: 400 });
    }
    // A forced check, for when an operator has just fixed something and does
    // not want to wait out the poll interval.
    const tracker = await runtime.pollOnce(name);
    return NextResponse.json({ service: name, tracker });
  } catch (err) {
    if (err instanceof Error && /Unknown service/.test(err.message)) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return adminErrorResponse(err);
  }
}

export async function GET() {
  try {
    await requireAdmin("health.read");
    const runtime = reliability();
    const snapshot = runtime.snapshot();
    return NextResponse.json({
      polling: runtime.isRunning(),
      providers: runtime.providers,
      services: runtime.services.map((s: { name: string; kind: string; url: string; model: string | null }) => ({
        ...s,
        tracker: snapshot[s.name] ?? null,
      })),
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
