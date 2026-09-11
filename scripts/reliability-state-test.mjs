// Assistant reliability — state machine tests.
//
// The machine is pure: the caller supplies every timestamp, so every transition
// below is deterministic. These tests pin down the two properties that actually
// prevent a repeat of the four-day silent outage: hysteresis (one probe must
// not decide anything) and transition-only alerting.

import test from "node:test";
import assert from "node:assert/strict";
import {
  STATES,
  DEFAULT_POLICY,
  initialState,
  onProbe,
  pollIntervalMs,
  shouldAlert,
} from "../ops/reliability/state-machine.mjs";

function ok(atMs, extra) {
  return { ok: true, atMs, ...extra };
}

function fail(atMs, extra) {
  return { ok: false, atMs, error: "boom", ...extra };
}

/** Drive a fresh tracker to HEALTHY: three fast successes. */
function healthy() {
  let t = initialState(0);
  t = onProbe(t, ok(10, { latencyMs: 100 }));
  t = onProbe(t, ok(20, { latencyMs: 100 }));
  t = onProbe(t, ok(30, { latencyMs: 100 }));
  return t;
}

test("a fresh tracker starts UNKNOWN", () => {
  const t = initialState(1000);
  assert.strictEqual(t.state, STATES.UNKNOWN, "state should be UNKNOWN");
  assert.strictEqual(t.consecutiveFailures, 0, "consecutiveFailures should be 0");
  assert.strictEqual(t.consecutiveSuccesses, 0, "consecutiveSuccesses should be 0");
  assert.strictEqual(t.incidentId, null, "incidentId should be null");
});

test("onProbe never mutates its input", () => {
  const t0 = initialState(0);
  onProbe(t0, fail(100));
  assert.strictEqual(t0.consecutiveFailures, 0, "input tracker must not be mutated");
  assert.strictEqual(t0.state, STATES.UNKNOWN, "input state must not be mutated");
});

test("one failure degrades", () => {
  const t1 = onProbe(initialState(0), fail(100));
  assert.strictEqual(t1.state, STATES.DEGRADED, "a single failure means suspect/degraded");
  assert.strictEqual(t1.transition.changed, true, "transition should report a change");
});

test("three failures with a fallback available activates failover", () => {
  let t = initialState(0);
  t = onProbe(t, fail(100, { fallbackAvailable: true }));
  t = onProbe(t, fail(200, { fallbackAvailable: true }));
  t = onProbe(t, fail(300, { fallbackAvailable: true }));
  assert.strictEqual(t.state, STATES.FAILOVER_ACTIVE, "state should be FAILOVER_ACTIVE");
  assert.strictEqual(t.failoverEnteredAt, 300, "failoverEnteredAt should be the third probe's atMs");
  assert.strictEqual(t.recoveryAttempts, 1, "recoveryAttempts should be 1");
});

test("three failures WITHOUT a fallback goes OFFLINE, not FAILOVER", () => {
  let t = initialState(0);
  t = onProbe(t, fail(100));
  t = onProbe(t, fail(200));
  t = onProbe(t, fail(300));
  assert.strictEqual(t.state, STATES.OFFLINE, "declaring failover with no fallback would be a lie");
});

test("five failures goes OFFLINE even with a fallback", () => {
  let t = initialState(0);
  for (const at of [100, 200, 300, 400, 500]) t = onProbe(t, fail(at, { fallbackAvailable: true }));
  assert.strictEqual(t.state, STATES.OFFLINE, "the offline threshold outranks the failover threshold");
});

test("an incident id is assigned on entering OFFLINE and is deterministic", () => {
  let t = initialState(0);
  for (const at of [100, 200, 300]) t = onProbe(t, fail(at));
  assert.strictEqual(t.incidentId, "inc_300", "incidentId must be derived from the caller's clock");
});

test("recovery requires three successes — one success only reaches RECOVERING", () => {
  let t = initialState(0);
  for (const at of [100, 200, 300, 400, 500]) t = onProbe(t, fail(at));
  t = onProbe(t, ok(600));
  assert.strictEqual(t.state, STATES.RECOVERING, "one lucky probe must not declare recovery");
  assert.notStrictEqual(t.state, STATES.HEALTHY, "must not be HEALTHY after a single success");
});

test("three successes return to HEALTHY and clear the incident", () => {
  let t = initialState(0);
  for (const at of [100, 200, 300, 400, 500]) t = onProbe(t, fail(at));
  for (const at of [600, 700, 800]) t = onProbe(t, ok(at));
  assert.strictEqual(t.state, STATES.HEALTHY, "sustained successes should restore HEALTHY");
  assert.strictEqual(t.incidentId, null, "incidentId should clear on recovery");
  assert.strictEqual(t.recoveryAttempts, 0, "recoveryAttempts should reset");
  assert.strictEqual(t.failoverEnteredAt, null, "failoverEnteredAt should reset");
});

test("FAILOVER_ACTIVE will not leave during the cooldown", () => {
  let t = initialState(0);
  for (const at of [100, 200, 300]) t = onProbe(t, fail(at, { fallbackAvailable: true }));
  for (const at of [400, 500, 600]) t = onProbe(t, ok(at));
  assert.strictEqual(t.state, STATES.FAILOVER_ACTIVE, "must not flap back inside the cooldown window");
  assert.ok(t.transition.reason.includes("cooldown"), "the reason should name the cooldown");
});

test("FAILOVER_ACTIVE leaves once the cooldown has elapsed", () => {
  let t = initialState(0);
  for (const at of [100, 200, 300]) t = onProbe(t, fail(at, { fallbackAvailable: true }));
  for (const at of [60401, 60501, 60601]) t = onProbe(t, ok(at));
  assert.strictEqual(t.state, STATES.HEALTHY, "switch-back is allowed once the cooldown has passed");
});

test("a slow but successful probe degrades", () => {
  const t = onProbe(healthy(), ok(100000, { latencyMs: 9000 }));
  assert.strictEqual(t.state, STATES.DEGRADED, "a slow assistant is not a healthy one");
  assert.ok(t.transition.reason.includes("latency"), "the reason should name the latency");
});

test("a fast successful probe stays HEALTHY", () => {
  const t = onProbe(healthy(), ok(100000, { latencyMs: 200 }));
  assert.strictEqual(t.state, STATES.HEALTHY, "a fast probe keeps the assistant healthy");
  assert.strictEqual(t.transition.changed, false, "staying healthy is not a transition");
});

test("pollIntervalMs adapts", () => {
  assert.strictEqual(pollIntervalMs(STATES.HEALTHY), 45000, "HEALTHY -> 45000");
  assert.strictEqual(pollIntervalMs(STATES.DEGRADED), 12000, "DEGRADED -> 12000");
  assert.strictEqual(pollIntervalMs(STATES.FAILOVER_ACTIVE), 10000, "FAILOVER_ACTIVE -> 10000");
  assert.strictEqual(pollIntervalMs(STATES.RECOVERING), 7000, "RECOVERING -> 7000");
  assert.strictEqual(pollIntervalMs(STATES.OFFLINE), 7000, "OFFLINE -> 7000");
  assert.strictEqual(pollIntervalMs(STATES.UNKNOWN), 15000, "UNKNOWN -> 15000");
  assert.strictEqual(pollIntervalMs("INVALID"), 15000, "an unrecognised state must still be safe");
});

test("shouldAlert returns null when nothing changed", () => {
  const transition = { from: STATES.HEALTHY, to: STATES.HEALTHY, changed: false, reason: "no change" };
  assert.strictEqual(
    shouldAlert(transition, initialState(0), 1000),
    null,
    "an alert that fires on every probe is one nobody reads",
  );
});

test("shouldAlert severities", () => {
  const t = initialState(0);
  const mk = (from, to) => ({ from, to, changed: true, reason: "x" });
  assert.strictEqual(shouldAlert(mk(STATES.HEALTHY, STATES.OFFLINE), t, 1).severity, "critical", "OFFLINE is critical");
  assert.strictEqual(shouldAlert(mk(STATES.HEALTHY, STATES.FAILOVER_ACTIVE), t, 1).severity, "high", "failover is high");
  assert.strictEqual(shouldAlert(mk(STATES.HEALTHY, STATES.DEGRADED), t, 1).severity, "warning", "degraded is warning");
  assert.strictEqual(shouldAlert(mk(STATES.OFFLINE, STATES.HEALTHY), t, 1).severity, "info", "restoration is info");
});

test("a malformed tracker does not throw", () => {
  assert.ok(typeof onProbe(null, fail(500)).state === "string", "a null tracker must not crash the monitor");
  assert.ok(typeof onProbe(undefined, ok(600)).state === "string", "an undefined tracker must not crash the monitor");
});

test("a missing probe is treated as a failure and does not throw", () => {
  const t = onProbe(initialState(0), null);
  assert.ok(
    typeof t.lastError === "string" && t.lastError.length > 0,
    "a missing probe result must be recorded as a failure, not ignored",
  );
});
