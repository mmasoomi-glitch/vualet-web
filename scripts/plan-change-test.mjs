// The module under test is the pure decision layer for self-serve plan change.
// It moves no money and makes no network call, so every rule is testable here.
import test from "node:test";
import assert from "node:assert/strict";
import { decidePlanChange, planRank, isPlan } from "../src/lib/plan-change.ts";

function req(over) {
  return {
    current: "companion",
    target: "assistant",
    status: "active",
    cancelAtPeriodEnd: false,
    hasSubscriptionId: true,
    ...over,
  };
}

test("planRank returns correct ranks", () => {
  assert.equal(planRank("free"), 0, "free is rank 0");
  assert.equal(planRank("companion"), 1, "companion is rank 1");
  assert.equal(planRank("assistant"), 2, "assistant is rank 2");
  assert.equal(planRank("studio"), 3, "studio is rank 3");
});

test("isPlan accepts valid plans and rejects invalid ones", () => {
  assert.ok(isPlan("free"), "free is a plan");
  assert.ok(isPlan("companion"), "companion is a plan");
  assert.ok(isPlan("assistant"), "assistant is a plan");
  assert.ok(isPlan("studio"), "studio is a plan");
  assert.ok(!isPlan(""), "empty string is not a plan");
  assert.ok(!isPlan(null), "null is not a plan");
  assert.ok(!isPlan(undefined), "undefined is not a plan");
  assert.ok(!isPlan("pro"), "pro is not a plan");
  assert.ok(!isPlan(1), "number is not a plan");
  assert.ok(!isPlan({}), "object is not a plan");
});

test("same plan is a noop even when everything else is valid", () => {
  const res = decidePlanChange(req({ current: "companion", target: "companion" }));
  assert.equal(res.allowed, false, "companion -> companion should be disallowed");
  assert.equal(res.kind, "noop", "companion -> companion should be noop");
});

test("invalid status values are rejected", () => {
  const invalidStatuses = ["past_due", "paused", "cancelled", ""];
  for (const status of invalidStatuses) {
    const res = decidePlanChange(req({ status }));
    assert.equal(res.allowed, false, `status "${status}" should be rejected`);
    assert.equal(res.kind, "noop", `status "${status}" should be noop`);
  }
});

test("case-insensitive status acceptance", () => {
  assert.ok(decidePlanChange(req({ status: "ACTIVE" })).allowed, "ACTIVE should be accepted");
  assert.ok(decidePlanChange(req({ status: "Trialing" })).allowed, "Trialing should be accepted");
});

test("cancelAtPeriodEnd true blocks an otherwise-valid upgrade", () => {
  const res = decidePlanChange(req({ cancelAtPeriodEnd: true }));
  assert.equal(res.allowed, false, "cancelAtPeriodEnd true should block upgrade");
  assert.equal(res.kind, "noop", "cancelAtPeriodEnd true should be noop");
});

test("free -> companion: upgrade, requiresPayment true, requiresNewCheckout TRUE", () => {
  const res = decidePlanChange(req({ current: "free", target: "companion" }));
  assert.equal(res.allowed, true, "free -> companion should be allowed");
  assert.equal(res.kind, "upgrade", "free -> companion should be upgrade");
  assert.equal(res.requiresPayment, true, "free -> companion requires payment");
  assert.equal(res.requiresNewCheckout, true, "free -> companion requires new checkout");
});

test("free -> studio with hasSubscriptionId TRUE still requires a new checkout", () => {
  const res = decidePlanChange(req({ current: "free", target: "studio", hasSubscriptionId: true }));
  assert.equal(res.allowed, true, "free -> studio should be allowed");
  assert.equal(res.requiresNewCheckout, true, "free -> studio requires new checkout regardless of subscription ID");
});

test("companion -> free: downgrade, requiresPayment false, requiresNewCheckout false", () => {
  const res = decidePlanChange(req({ current: "companion", target: "free" }));
  assert.equal(res.allowed, true, "companion -> free should be allowed");
  assert.equal(res.kind, "downgrade", "companion -> free should be downgrade");
  assert.equal(res.requiresPayment, false, "companion -> free does not require payment");
  assert.equal(res.requiresNewCheckout, false, "companion -> free does not require new checkout");
});

test("studio -> free: downgrade", () => {
  const res = decidePlanChange(req({ current: "studio", target: "free" }));
  assert.equal(res.allowed, true, "studio -> free should be allowed");
  assert.equal(res.kind, "downgrade", "studio -> free should be downgrade");
});

test("companion -> assistant: upgrade, requiresPayment true, requiresNewCheckout false", () => {
  const res = decidePlanChange(req({ current: "companion", target: "assistant" }));
  assert.equal(res.allowed, true, "companion -> assistant should be allowed");
  assert.equal(res.kind, "upgrade", "companion -> assistant should be upgrade");
  assert.equal(res.requiresPayment, true, "companion -> assistant requires payment");
  assert.equal(res.requiresNewCheckout, false, "companion -> assistant does not require new checkout");
});

test("studio -> companion: downgrade, requiresPayment FALSE", () => {
  const res = decidePlanChange(req({ current: "studio", target: "companion" }));
  assert.equal(res.allowed, true, "studio -> companion should be allowed");
  assert.equal(res.kind, "downgrade", "studio -> companion should be downgrade");
  assert.equal(res.requiresPayment, false, "studio -> companion does not require payment");
});

test("companion -> assistant with hasSubscriptionId false: allowed false", () => {
  const res = decidePlanChange(req({ current: "companion", target: "assistant", hasSubscriptionId: false }));
  assert.equal(res.allowed, false, "companion -> assistant without subscription ID should be disallowed");
  assert.equal(res.kind, "noop", "companion -> assistant without subscription ID should be noop");
});

test("ORDERING: same-plan request with bad status is still reported as the same-plan noop", () => {
  const res = decidePlanChange(req({ current: "companion", target: "companion", status: "past_due" }));
  assert.equal(res.allowed, false, "same plan with bad status should be disallowed");
  assert.equal(res.kind, "noop", "same plan with bad status should be noop, proving rule 2 before rule 3");
});

test("ORDERING: cancelAtPeriodEnd true AND status past_due -> rejected", () => {
  const res = decidePlanChange(req({ cancelAtPeriodEnd: true, status: "past_due" }));
  assert.equal(res.allowed, false, "cancelAtPeriodEnd and bad status should be rejected");
});

test("Every decision returns a non-empty string reason", () => {
  const testCases = [
    req({ current: "free", target: "companion" }),
    req({ current: "companion", target: "free" }),
    req({ current: "companion", target: "assistant" }),
    req({ current: "companion", target: "companion" }),
    req({ current: "unknown", target: "companion" }),
    req({ status: "past_due" }),
    req({ cancelAtPeriodEnd: true }),
    req({ current: "companion", target: "assistant", hasSubscriptionId: false }),
  ];
  for (const r of testCases) {
    const res = decidePlanChange(r);
    assert.ok(typeof res.reason === "string" && res.reason.length > 0, `reason should be non-empty for ${JSON.stringify(r)}`);
  }
});
