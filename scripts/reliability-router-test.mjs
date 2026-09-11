// Assistant reliability — provider routing and bounded self-recovery.
//
// Every function here is pure, so every clock in this file is a literal. No
// Date.now(), no timers, no network.

import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseProvider,
  USER_NOTICES,
  RECOVERY_POLICY,
  shouldAttemptRecovery,
  describeForOperator,
} from "../ops/reliability/router.mjs";

const ALL = { primary: true, secondary: true, kb: true };
const NOW = 1_000_000;

/* ── constants ─────────────────────────────────────────────────────────── */

test("the customer copy and the recovery policy are frozen", () => {
  assert.ok(Object.isFrozen(USER_NOTICES), "customer copy must not be mutable at runtime");
  assert.ok(Object.isFrozen(RECOVERY_POLICY), "the recovery budget must not be mutable at runtime");
  assert.equal(RECOVERY_POLICY.baseBackoffMs, 30000, "base backoff");
  assert.equal(RECOVERY_POLICY.maxBackoffMs, 900000, "backoff ceiling");
  assert.equal(RECOVERY_POLICY.maxRecoveryAttempts, 6, "the recovery budget");
});

/* ── routing ───────────────────────────────────────────────────────────── */

test("a working assistant stays on the primary", () => {
  for (const state of ["HEALTHY", "DEGRADED", "RECOVERING", "UNKNOWN"]) {
    const r = chooseProvider({ state, providers: ALL });
    assert.equal(r.target, "primary", `${state} must stay on primary`);
    assert.equal(r.degraded, false, `${state} is not a degraded route`);
    assert.equal(r.userNotice, null, `${state} must not apologise to a customer for nothing`);
  }
});

test("DEGRADED STAYS ON PRIMARY ON PURPOSE", () => {
  const r = chooseProvider({ state: "DEGRADED", providers: ALL });
  assert.equal(
    r.target,
    "primary",
    "a slow assistant that answers beats moving every request onto a provider billed per call",
  );
});

test("UNKNOWN STAYS ON PRIMARY ON PURPOSE", () => {
  const r = chooseProvider({ state: "UNKNOWN", providers: ALL });
  assert.equal(
    r.target,
    "primary",
    "refusing to serve because a probe has not run yet would turn a monitoring gap into a self-inflicted outage",
  );
});

test("a failed assistant routes to the paid fallback", () => {
  for (const state of ["FAILOVER_ACTIVE", "OFFLINE"]) {
    const r = chooseProvider({ state, providers: ALL });
    assert.equal(r.target, "secondary", `${state} must fail over`);
    assert.equal(r.degraded, true, `${state} is a degraded route`);
    assert.equal(r.userNotice, USER_NOTICES.ON_SECONDARY, `${state} must tell the customer`);
  }
});

test("with no secondary configured, a failed assistant falls to the knowledge base", () => {
  for (const state of ["FAILOVER_ACTIVE", "OFFLINE"]) {
    const r = chooseProvider({ state, providers: { primary: true, secondary: false, kb: true } });
    assert.equal(r.target, "kb", `${state} must still answer something grounded`);
    assert.equal(r.userNotice, USER_NOTICES.ON_KB, `${state} must say general knowledge is gone`);
  }
});

test("an unconfigured primary is a degraded route even when the state is HEALTHY", () => {
  const r = chooseProvider({ state: "HEALTHY", providers: { primary: false, secondary: true, kb: true } });
  assert.equal(r.target, "secondary", "with no primary there is nothing to be healthy about");
  assert.equal(r.degraded, true, "not being on primary IS degraded, whatever the probe says");
  assert.equal(
    r.userNotice,
    USER_NOTICES.ON_SECONDARY,
    "the customer is on the backup and answers may be slower, so they are told",
  );
});

test("the ladder falls all the way to the knowledge base", () => {
  assert.equal(
    chooseProvider({ state: "HEALTHY", providers: { primary: false, secondary: false, kb: true } }).target,
    "kb",
    "with only a KB configured, use it",
  );
  assert.equal(
    chooseProvider({ state: "HEALTHY", providers: { primary: false, secondary: false, kb: false } }).target,
    "kb",
    "answering something grounded beats answering nothing",
  );
});

test("A GARBAGE INPUT NEVER THROWS — this runs in a request path", () => {
  for (const input of [undefined, null, {}, { state: "BANANA" }, { providers: null }]) {
    const r = chooseProvider(input);
    assert.ok(r && typeof r.target === "string", `${JSON.stringify(input)} must still yield a route`);
    assert.ok(["primary", "secondary", "kb"].includes(r.target), "the route must be a real target");
  }
  assert.equal(
    chooseProvider({ state: "BANANA", providers: ALL }).target,
    "primary",
    "an unrecognised state behaves as UNKNOWN rather than taking the assistant down",
  );
});

/* ── the customer copy constraint ──────────────────────────────────────── */

test("NO USER NOTICE MAY LEAK AN INTERNAL DETAIL", () => {
  const forbidden = [
    "vllm", "openrouter", "openai", "gpt", "claude", "api", "503", "500",
    "error", "failover", "offline", "degraded", "null", "undefined", "http",
    "token", "key", "localhost", ".com", "env",
  ];
  for (const [name, notice] of Object.entries(USER_NOTICES)) {
    const lower = notice.toLowerCase();
    assert.ok(notice.length >= 20, `${name} is too short to actually explain anything`);
    assert.ok(!notice.includes("!"), `${name} must not shout at someone whose service is broken`);
    for (const word of forbidden) {
      assert.ok(
        !lower.includes(word),
        `${name} contains "${word}" — a customer must never read a vendor, a host, a status code or an internal state name`,
      );
    }
  }
});

test("NO AD-HOC CUSTOMER COPY may be minted by any route", () => {
  const states = ["HEALTHY", "DEGRADED", "RECOVERING", "UNKNOWN", "FAILOVER_ACTIVE", "OFFLINE", "BANANA"];
  const configs = [
    ALL,
    { primary: true, secondary: false, kb: true },
    { primary: false, secondary: true, kb: true },
    { primary: false, secondary: false, kb: true },
    { primary: false, secondary: false, kb: false },
  ];
  for (const state of states) {
    for (const providers of configs) {
      const { userNotice } = chooseProvider({ state, providers });
      if (userNotice === null) continue;
      assert.ok(
        userNotice === USER_NOTICES.ON_SECONDARY || userNotice === USER_NOTICES.ON_KB,
        `${state} with ${JSON.stringify(providers)} invented its own customer copy, which no test reviews`,
      );
    }
  }
});

/* ── bounded self-recovery ─────────────────────────────────────────────── */

test("there is nothing to recover from when nothing is broken", () => {
  for (const state of ["HEALTHY", "RECOVERING", "DEGRADED", "UNKNOWN"]) {
    const r = shouldAttemptRecovery({ state, recoveryAttempts: 0, lastFailureAt: 0 }, RECOVERY_POLICY, NOW);
    assert.equal(r.attempt, false, `${state} needs no recovery attempt`);
    assert.equal(r.nextEligibleAtMs, null, `${state} has no next attempt to schedule`);
  }
});

test("a garbage tracker never throws", () => {
  for (const tracker of [null, undefined, "string", 123, []]) {
    const r = shouldAttemptRecovery(tracker, RECOVERY_POLICY, NOW);
    assert.equal(r.attempt, false, `${JSON.stringify(tracker)} must not trigger a recovery attempt`);
    assert.ok(typeof r.reason === "string", "it must still explain itself");
  }
});

test("RECOVERY IS BOUNDED — a spent budget stops trying and asks for a human", () => {
  const r = shouldAttemptRecovery(
    { state: "OFFLINE", recoveryAttempts: 6, lastFailureAt: 0 },
    RECOVERY_POLICY,
    NOW,
  );
  assert.equal(r.attempt, false, "the budget is spent");
  assert.equal(r.nextEligibleAtMs, null, "there is no next attempt to wait for");
  assert.ok(
    r.reason.toLowerCase().includes("human"),
    "retrying a dead provider forever burns money on the paid fallback and hides the fault behind a self-healing illusion that never heals",
  );
});

test("a first failure is eligible immediately", () => {
  const r = shouldAttemptRecovery(
    { state: "OFFLINE", recoveryAttempts: 0, lastFailureAt: null },
    RECOVERY_POLICY,
    NOW,
  );
  assert.equal(r.attempt, true, "with no recorded failure there is nothing to back off from");
});

test("backoff is exponential from the last failure", () => {
  const at = (recoveryAttempts, nowMs) =>
    shouldAttemptRecovery({ state: "OFFLINE", recoveryAttempts, lastFailureAt: 1000 }, RECOVERY_POLICY, nowMs);

  assert.equal(at(0, NOW).nextEligibleAtMs, 31000, "attempt 0 waits 30s");
  assert.equal(at(0, 30999).attempt, false, "one millisecond early is still early");
  assert.equal(at(0, 31000).attempt, true, "the boundary itself is eligible");
  assert.equal(at(3, NOW).nextEligibleAtMs, 241000, "attempt 3 waits 30s * 8");
});

test("BACKOFF IS CAPPED so a long outage still gets retried", () => {
  const r = shouldAttemptRecovery(
    { state: "OFFLINE", recoveryAttempts: 5, lastFailureAt: 1000 },
    RECOVERY_POLICY,
    NOW,
  );
  assert.equal(
    r.nextEligibleAtMs,
    901000,
    "30s * 32 is 960s, capped to the 900s ceiling — uncapped doubling would push the next attempt out by hours",
  );
});

test("A MALFORMED ATTEMPT COUNT MUST NOT PRODUCE NaN", () => {
  for (const recoveryAttempts of [undefined, NaN, "3", null, {}]) {
    const r = shouldAttemptRecovery(
      { state: "OFFLINE", recoveryAttempts, lastFailureAt: 1000 },
      RECOVERY_POLICY,
      NOW,
    );
    assert.ok(
      Number.isFinite(r.nextEligibleAtMs),
      `recoveryAttempts ${String(recoveryAttempts)} produced a non-finite time; NaN makes every comparison false and silently disables recovery forever`,
    );
    assert.equal(r.nextEligibleAtMs, 31000, "a malformed count means none so far, not an infinite wait");
  }
});

test("a custom policy is honoured", () => {
  const r = shouldAttemptRecovery(
    { state: "OFFLINE", recoveryAttempts: 1, lastFailureAt: 0 },
    { ...RECOVERY_POLICY, maxRecoveryAttempts: 1 },
    NOW,
  );
  assert.equal(r.attempt, false, "a tighter budget must actually bind");
});

/* ── operator line ─────────────────────────────────────────────────────── */

test("the operator line names what an operator needs", () => {
  const line = describeForOperator(
    { target: "secondary", reason: "primary is OFFLINE", degraded: true, userNotice: USER_NOTICES.ON_SECONDARY },
    { state: "OFFLINE", recoveryAttempts: 2, lastFailureAt: 1000, incidentId: "inc_42" },
  );
  assert.ok(line.includes("route=secondary"), "an operator needs the route");
  assert.ok(line.includes("state=OFFLINE"), "an operator needs the state");
  assert.ok(line.includes("incident=inc_42"), "an operator needs the incident to correlate against");
  assert.ok(!line.includes("\n"), "a log line that wraps breaks every grep that reads it");
});

test("the operator line survives a null tracker", () => {
  const line = describeForOperator({ target: "primary", reason: "ok", degraded: false }, null);
  assert.ok(line.includes("primary"), "it must still name the target");
  assert.ok(!line.includes("\n"), "still one line");
});
