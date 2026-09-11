// Route: src/app/api/promo/validate/route.ts
//
// What this file pins down is the ORDERING of three gates: the paid-plan check
// runs before the feature flag, and the feature flag runs before the payments
// check. A refactor that reorders them would change what a customer is told
// without changing any single message, so order is asserted explicitly.

import test from "node:test";
import assert from "node:assert/strict";
import { loadRoute, jsonRequest, readJson, resetNet, env } from "./route-harness/index.mjs";

const { POST } = await loadRoute("src/app/api/promo/validate/route.ts", { fresh: true });

const PLAN_ERR = "Pick a paid plan first.";
const DISABLED = "Discount codes are temporarily unavailable. Contact us and we'll apply it manually.";

test.beforeEach(() => {
  resetNet();
});

test("malformed JSON returns 400 Invalid request", async () => {
  const req = new Request("https://mira.vualet.com/api/promo/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{ broken",
  });
  const res = await POST(req);
  const { body } = await readJson(res);
  assert.strictEqual(res.status, 400);
  assert.strictEqual(body.valid, false);
  assert.strictEqual(body.reason, "Invalid request.");
});

test("a missing plan returns 400 Pick a paid plan first", async () => {
  const res = await POST(jsonRequest({ code: "SAVE10" }));
  const { body } = await readJson(res);
  assert.strictEqual(res.status, 400);
  assert.strictEqual(body.valid, false);
  assert.strictEqual(body.reason, PLAN_ERR);
});

test("the free plan is not a paid plan and returns 400", async () => {
  const res = await POST(jsonRequest({ code: "SAVE10", plan: "free" }));
  const { body } = await readJson(res);
  assert.strictEqual(res.status, 400, "free is deliberately not promotable");
  assert.strictEqual(body.reason, PLAN_ERR);
});

test("an unknown plan returns 400", async () => {
  const res = await POST(jsonRequest({ code: "SAVE10", plan: "enterprise" }));
  const { body } = await readJson(res);
  assert.strictEqual(res.status, 400);
  assert.strictEqual(body.reason, PLAN_ERR);
});

test("ORDERING: a bad plan beats the disabled flag", async () => {
  env({ PROMO_CODES_ENABLED: "0" });
  const res = await POST(jsonRequest({ code: "X", plan: "free" }));
  const { body } = await readJson(res);
  assert.strictEqual(res.status, 400, "the plan check runs before the feature flag");
  assert.strictEqual(body.reason, PLAN_ERR, "must be the plan error, not the disabled message");
});

test("disabled promo codes return the manual-contact message at 200", async () => {
  env({ PROMO_CODES_ENABLED: "0" });
  const res = await POST(jsonRequest({ code: "SAVE10", plan: "companion" }));
  const { body } = await readJson(res);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.valid, false);
  assert.strictEqual(body.reason, DISABLED);
});

test("PROMO_CODES_ENABLED must be exactly the string 1", async () => {
  for (const v of ["true", "yes", "", "0"]) {
    env({ PROMO_CODES_ENABLED: v });
    const res = await POST(jsonRequest({ code: "SAVE10", plan: "companion" }));
    const { body } = await readJson(res);
    assert.strictEqual(
      body.reason,
      DISABLED,
      `PROMO_CODES_ENABLED="${v}" is truthy-looking but must NOT enable the feature`,
    );
  }
});

test("all three paid plans are accepted past the plan gate", async () => {
  for (const plan of ["companion", "assistant", "studio"]) {
    env({ PROMO_CODES_ENABLED: "0" });
    const res = await POST(jsonRequest({ code: "SAVE10", plan }));
    const { body } = await readJson(res);
    assert.notStrictEqual(body.reason, PLAN_ERR, `${plan} must pass the paid-plan gate`);
  }
});
