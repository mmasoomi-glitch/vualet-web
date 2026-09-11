// Assistant reliability — the polling worker.
//
// NO REAL TIMERS AND NO REAL CLOCK. Time is a variable the test advances by
// hand, so a 45-second poll interval is asserted in microseconds and nothing
// here is flaky.

import test from "node:test";
import assert from "node:assert/strict";
import { createPoller } from "../ops/reliability/poller.mjs";

function makeHarness() {
  let now = 0;
  let nextId = 1;
  const scheduled = new Map();
  return {
    clock: () => now,
    setTimer: (fn, delay) => {
      const id = nextId++;
      scheduled.set(id, { at: now + delay, fn });
      return id;
    },
    clearTimer: (id) => {
      scheduled.delete(id);
    },
    pending: () => [...scheduled.values()],
    /** Advance time, running every timer that comes due in time order. */
    async advance(ms) {
      const target = now + ms;
      let guard = 0;
      for (;;) {
        if (guard++ > 1000) throw new Error("timer loop did not settle");
        let soonestId = null;
        let soonest = Infinity;
        for (const [id, t] of scheduled) {
          if (t.at <= target && t.at < soonest) {
            soonest = t.at;
            soonestId = id;
          }
        }
        if (soonestId === null) break;
        const t = scheduled.get(soonestId);
        scheduled.delete(soonestId);
        now = t.at;
        t.fn();
        await new Promise((r) => setImmediate(r));
      }
      now = target;
    },
  };
}

function probeFor(harness, okRef) {
  return async () => ({
    ok: okRef.ok,
    atMs: harness.clock(),
    latencyMs: 10,
    error: okRef.ok ? null : "down",
    // The state machine refuses to declare FAILOVER_ACTIVE without somewhere to
    // fail over to, so a probe that wants to exercise failover must say so.
    fallbackAvailable: okRef.fallback === true,
    detail: {},
  });
}

/** Build a poller on a fresh harness, overriding only what a test cares about. */
function setup(over = {}) {
  const harness = makeHarness();
  const okRef = { ok: over.ok === undefined ? true : over.ok, fallback: over.fallback === true };
  const events = [];
  const alerts = [];
  const poller = createPoller({
    services: over.services || [{ name: "svc1", probe: over.probe || probeFor(harness, okRef) }],
    clock: harness.clock,
    setTimer: harness.setTimer,
    clearTimer: harness.clearTimer,
    onEvent: over.onEvent || ((e) => events.push(e)),
    onAlert: over.onAlert || ((a) => alerts.push(a)),
    ...(over.random ? { random: over.random } : {}),
    ...(over.maxJitterMs ? { maxJitterMs: over.maxJitterMs } : {}),
  });
  return { harness, okRef, events, alerts, poller };
}

/* ── construction ──────────────────────────────────────────────────────── */

test("createPoller refuses a configuration that would watch nothing", () => {
  assert.throws(() => createPoller(), /config object/, "no config at all");
  assert.throws(() => createPoller({}), /non-empty services array/, "no services key");
  assert.throws(() => createPoller({ services: [] }), /non-empty services array/, "an empty list");
  assert.throws(() => createPoller({ services: "x" }), /non-empty services array/, "a non-array");
  assert.throws(
    () => createPoller({ services: [{ probe: async () => {} }] }),
    /non-empty name/,
    "a service with no name",
  );
  assert.throws(
    () => createPoller({ services: [{ name: "svc1", probe: "no" }] }),
    /callable probe/,
    "a service whose probe is not callable",
  );
});

test("createPoller refuses DUPLICATE service names", () => {
  assert.throws(
    () =>
      createPoller({
        services: [
          { name: "svc1", probe: async () => {} },
          { name: "svc1", probe: async () => {} },
        ],
      }),
    /Duplicate service name "svc1"/,
    "two services sharing a name would share one tracker, leaving one silently unmonitored",
  );
});

test("a fresh poller knows nothing and is not running", () => {
  const { poller } = setup();
  assert.equal(poller.snapshot().svc1.state, "UNKNOWN", "nothing is assumed healthy before a probe");
  assert.equal(poller.isRunning(), false, "constructing must not start polling");
});

/* ── pollOnce ──────────────────────────────────────────────────────────── */

test("pollOnce WORKS ON A STOPPED POLLER", async () => {
  const { poller } = setup({ ok: false });
  const tracker = await poller.pollOnce("svc1");
  assert.equal(
    tracker.state,
    "DEGRADED",
    "an earlier version gated this on the running flag, so forcing a check silently did nothing",
  );
});

test("pollOnce plants no timer and does not start the poller", async () => {
  const { poller, harness } = setup({ ok: false });
  await poller.pollOnce("svc1");
  assert.equal(harness.pending().length, 0, "a forced check must not schedule a follow-up");
  assert.equal(poller.isRunning(), false, "a forced check must not resurrect a stopped poller");
});

test("pollOnce drives the full failure ladder", async () => {
  const { poller } = setup({ ok: false, fallback: true });
  assert.equal((await poller.pollOnce("svc1")).state, "DEGRADED", "1 failure degrades");
  assert.equal((await poller.pollOnce("svc1")).state, "DEGRADED", "2 failures hold");
  assert.equal((await poller.pollOnce("svc1")).state, "FAILOVER_ACTIVE", "3 failures fail over");
  assert.equal((await poller.pollOnce("svc1")).state, "FAILOVER_ACTIVE", "4 failures hold");
  assert.equal((await poller.pollOnce("svc1")).state, "OFFLINE", "5 failures is offline");
});

test("WITH NO FALLBACK, the third failure goes straight to OFFLINE", async () => {
  const { poller } = setup({ ok: false, fallback: false });
  await poller.pollOnce("svc1");
  await poller.pollOnce("svc1");
  assert.equal(
    (await poller.pollOnce("svc1")).state,
    "OFFLINE",
    "reporting FAILOVER_ACTIVE with nowhere to fail over to would tell an operator the assistant is still answering when it is not",
  );
});

test("pollOnce rejects an unknown service", async () => {
  const { poller } = setup();
  await assert.rejects(
    () => poller.pollOnce("nope"),
    /Unknown service "nope"/,
    "a typo in the ops API must be an error, not a silent no-op",
  );
});

/* ── start / stop ──────────────────────────────────────────────────────── */

test("start is idempotent — one timer per service, not two", async () => {
  const harness = makeHarness();
  const okRef = { ok: true };
  const poller = createPoller({
    services: [
      { name: "svc1", probe: probeFor(harness, okRef) },
      { name: "svc2", probe: probeFor(harness, okRef) },
    ],
    clock: harness.clock,
    setTimer: harness.setTimer,
    clearTimer: harness.clearTimer,
  });
  poller.start();
  poller.start();
  assert.equal(harness.pending().length, 2, "a double start must not double the polling rate");
  poller.stop();
});

test("start probes every service immediately", async () => {
  const { poller, harness } = setup({ ok: false });
  poller.start();
  await harness.advance(1);
  assert.equal(
    poller.snapshot().svc1.state,
    "DEGRADED",
    "the first poll must not wait a full interval — an outage at boot would go unseen",
  );
  poller.stop();
});

test("THE NEXT INTERVAL COMES FROM THE NEW STATE", async () => {
  const { poller, harness } = setup({ ok: false, random: () => 0 });
  poller.start();
  // The first timer fires at t=0, so the reschedule is computed at t=0 and the
  // absolute due time IS the interval. Comparing against the clock afterwards
  // would measure the harness's own advance, not the poller's decision.
  await harness.advance(1);
  assert.equal(
    harness.pending()[0].at,
    12000,
    "after degrading it must re-check at the DEGRADED cadence (12s), not the UNKNOWN one (15s) it was scheduled under",
  );
  poller.stop();
});

test("jitter is ADDED, never subtracted", async () => {
  const { poller, harness } = setup({ ok: false, random: () => 0.5, maxJitterMs: 2000 });
  poller.start();
  await harness.advance(1);
  assert.equal(
    harness.pending()[0].at,
    13000,
    "12000 + floor(0.5 * 2000); subtracting jitter would poll faster than the policy allows",
  );
  poller.stop();
});

test("stop clears every pending timer", async () => {
  const { poller, harness } = setup();
  poller.start();
  poller.stop();
  assert.equal(harness.pending().length, 0, "no timer may survive stop");
  assert.equal(poller.isRunning(), false, "isRunning must report stopped");
});

test("STOPPING IS FINAL — no probe runs afterwards", async () => {
  const { poller, harness } = setup({ ok: false });
  poller.start();
  poller.stop();
  await harness.advance(100000);
  assert.equal(
    poller.snapshot().svc1.state,
    "UNKNOWN",
    "advancing time past many intervals after stop must produce no probes at all",
  );
});

/* ── robustness: a monitor that dies is worse than no monitor ──────────── */

test("a probe that REJECTS is contained and recorded", async () => {
  const events = [];
  const { poller } = setup({
    probe: async () => {
      throw new Error("boom");
    },
    onEvent: (e) => events.push(e),
  });
  const tracker = await poller.pollOnce("svc1");
  assert.equal(tracker.state, "DEGRADED", "a thrown probe is a failed probe, not a crash");
  assert.equal(tracker.lastError, "boom", "the thrown message is kept on the tracker");
  const probeEvent = events.find((e) => e.type === "probe");
  assert.equal(probeEvent.error, "boom", "the emitted event carries the real cause");
});

test("an onEvent listener that THROWS does not break the cycle", async () => {
  let calls = 0;
  const { poller } = setup({
    ok: false,
    onEvent: () => {
      calls++;
      throw new Error("event boom");
    },
  });
  const tracker = await poller.pollOnce("svc1");
  assert.ok(calls > 0, "the listener really was invoked, so the test is not vacuous");
  assert.equal(tracker.state, "DEGRADED", "a bad listener must not stop the state machine");
});

test("an onAlert listener that THROWS does not break the cycle", async () => {
  let calls = 0;
  const { poller } = setup({
    ok: false,
    fallback: true,
    onAlert: () => {
      calls++;
      throw new Error("alert boom");
    },
  });
  await poller.pollOnce("svc1");
  await poller.pollOnce("svc1");
  const tracker = await poller.pollOnce("svc1");
  assert.ok(calls > 0, "the alert listener really was invoked");
  assert.equal(tracker.state, "FAILOVER_ACTIVE", "a bad alert sink must not stop monitoring");
});

test("NO OVERLAPPING PROBES for one service", async () => {
  const harness = makeHarness();
  let invocations = 0;
  let release;
  const poller = createPoller({
    services: [
      {
        name: "svc1",
        probe: async () => {
          invocations++;
          await new Promise((r) => {
            release = r;
          });
          return { ok: true, atMs: harness.clock(), latencyMs: 10, error: null, detail: {} };
        },
      },
    ],
    clock: harness.clock,
    setTimer: harness.setTimer,
    clearTimer: harness.clearTimer,
  });

  const first = poller.pollOnce("svc1");
  assert.equal(invocations, 1, "the first probe started");
  // The second call finds the service in flight and returns the current tracker
  // rather than issuing a concurrent probe.
  await poller.pollOnce("svc1");
  assert.equal(
    invocations,
    1,
    "a probe slower than its interval must not stack a second concurrent request",
  );
  release();
  await first;
});

/* ── events and alerts ─────────────────────────────────────────────────── */

test("every completed poll emits a probe event", async () => {
  const { poller, events } = setup({ ok: true });
  await poller.pollOnce("svc1");
  assert.equal(events.length, 2, "one success from UNKNOWN both probes and transitions");
  const e = events[0];
  assert.equal(e.type, "probe", "the probe event comes first");
  assert.equal(e.service, "svc1", "the event names the service");
  assert.equal(e.ok, true, "the event carries the outcome");
  assert.equal(
    e.state,
    "RECOVERING",
    "hysteresis: one success does not declare HEALTHY, it needs 3",
  );
  assert.equal(e.latencyMs, 10, "the event carries the latency");
  assert.equal(e.error, null, "a success carries no error");
});

test("a transition event is emitted ONLY when the state changes", async () => {
  const { poller, events } = setup({ ok: false });
  await poller.pollOnce("svc1");
  assert.equal(events.length, 2, "first failure: a probe event and a transition event");
  assert.equal(events[1].type, "transition", "the transition follows the probe");
  assert.equal(events[1].to, "DEGRADED", "it names the new state");

  await poller.pollOnce("svc1");
  assert.equal(events.length, 3, "a second failure adds only a probe event");
  assert.equal(
    events[2].type,
    "probe",
    "DEGRADED -> DEGRADED is not a transition; emitting one would spam the incident log",
  );
});

test("the transition is timestamped at the PROBE, not a later clock read", async () => {
  const { poller, events } = setup({ ok: false });
  await poller.pollOnce("svc1");
  const transition = events.find((e) => e.type === "transition");
  const probe = events.find((e) => e.type === "probe");
  assert.equal(
    transition.atMs,
    probe.atMs,
    "the state machine treats probe.atMs as now, so a second clock read would date the incident later than its cause",
  );
});

test("THE EVENT THAT CLOSES AN INCIDENT STILL CARRIES ITS ID", async () => {
  const { poller, okRef, events, harness } = setup({ ok: false, fallback: true });
  for (let i = 0; i < 3; i++) await poller.pollOnce("svc1");
  const opened = events.find((e) => e.type === "transition" && e.to === "FAILOVER_ACTIVE");
  assert.ok(opened.incidentId, "failing over opens an incident with an id");

  // Past the anti-oscillation cooldown, or the service is held in
  // FAILOVER_ACTIVE no matter how many successes arrive.
  await harness.advance(61000);
  okRef.ok = true;
  for (let i = 0; i < 4; i++) await poller.pollOnce("svc1");
  const closed = events.find((e) => e.type === "transition" && e.to === "HEALTHY");
  assert.ok(closed, "the service recovered");
  assert.equal(
    closed.incidentId,
    opened.incidentId,
    "recovering clears the tracker's incident id, so without carrying the previous one the closing event would be unattributable and the incident would read as open forever",
  );
});

test("reaching FAILOVER_ACTIVE alerts a developer", async () => {
  const { poller, alerts } = setup({ ok: false, fallback: true });
  await poller.pollOnce("svc1");
  await poller.pollOnce("svc1");
  await poller.pollOnce("svc1");
  assert.equal(alerts.length, 2, "DEGRADED alerts once, then FAILOVER_ACTIVE alerts again");
  assert.equal(alerts[0].severity, "warning", "the first degrade is a warning");
  assert.equal(alerts[1].severity, "high", "failover is high, reserving critical for OFFLINE");
  assert.ok(alerts[1].title.length > 0, "an alert without a title is useless at 3am");
});

/* ── snapshot ──────────────────────────────────────────────────────────── */

test("snapshot is a DEEP copy", async () => {
  const { poller } = setup({ ok: false });
  // Probe first, so the tracker actually carries a nested transition to copy.
  await poller.pollOnce("svc1");

  const snap = poller.snapshot();
  snap.svc1.state = "HACKED";
  snap.svc1.transition.reason = "HACKED";

  const fresh = poller.snapshot();
  assert.equal(fresh.svc1.state, "DEGRADED", "mutating a snapshot must not corrupt poller state");
  assert.notEqual(
    fresh.svc1.transition.reason,
    "HACKED",
    "the NESTED transition must be copied too, or a caller can rewrite incident history",
  );
});
