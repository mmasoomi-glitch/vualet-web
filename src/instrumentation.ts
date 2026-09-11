/**
 * Next runs this once when the server process starts.
 *
 * The reliability poller is started here rather than on the first ops request,
 * because a monitor nobody has visited is not monitoring. The whole point of
 * this subsystem is that the next outage is noticed by us and not by a
 * customer, and that only holds if it comes up with the site.
 *
 * It is deliberately quiet and deliberately unable to break a boot: the whole
 * thing is wrapped, and a failure to start monitoring must never be the reason
 * the site does not start.
 */
export async function register() {
  // Only the Node server runtime has timers and a filesystem; the edge runtime
  // would evaluate this too and has neither.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // A build must never open sockets or write an incident log. It does not
  // reach here today, but a build that starts probing the outside world would
  // fail on any machine where the services are not reachable, so the guard is
  // cheap insurance against a future Next changing when this is called.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  // An explicit off switch, for a build machine or a one-off container where
  // probing the outside world is wrong.
  if (process.env.MIRA_RELIABILITY_DISABLED === "1") return;

  try {
    const { reliability } = await import("@/lib/reliability-runtime");
    const runtime = reliability();
    console.log(
      `[reliability] monitoring ${runtime.services.map((s: { name: string }) => s.name).join(", ")}`,
    );
  } catch (err) {
    console.error("[reliability] failed to start monitoring:", err);
  }
}
