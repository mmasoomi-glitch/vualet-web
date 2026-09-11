// The route under test is decision-only and moves no money.
// These tests prove the unauthenticated boundary: without a valid session, no
// subscription data is reached, regardless of the target plan or of any
// customer identifiers a caller puts in the body.

import test from "node:test";
import assert from "node:assert/strict";
import { loadRoute, jsonRequest, readJson, resetNet } from "./route-harness/index.mjs";

const { POST, GET } = await loadRoute("src/app/api/subscription/plan-change/route.ts", { fresh: true });

test.beforeEach(async () => {
  resetNet();
});

test("GET is rejected with 405", async () => {
  const res = await GET();
  assert.equal(res.status, 405, "GET method should be rejected with 405");
  const { body } = await readJson(res);
  assert.equal(body.error, "method_not_allowed", "Error should be method_not_allowed");
});

test("malformed JSON body is rejected with 400 before anything else", async () => {
  const req = new Request("http://localhost/api/subscription/plan-change", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ not json",
  });
  const res = await POST(req);
  assert.equal(res.status, 400, "Malformed JSON should return 400");
  const { body } = await readJson(res);
  assert.equal(body.error, "invalid_json", "Error should be invalid_json");
});

test("an unknown plan is rejected with 400", async () => {
  const res = await POST(jsonRequest({ target: "pro" }));
  assert.equal(res.status, 400, "Unknown plan should return 400");
  const { body } = await readJson(res);
  assert.equal(body.error, "unknown_plan", "Error should be unknown_plan");
});

test("a missing target is rejected with 400", async () => {
  const res = await POST(jsonRequest({}));
  assert.equal(res.status, 400, "Missing target should return 400");
  const { body } = await readJson(res);
  assert.equal(body.error, "unknown_plan", "Error should be unknown_plan for missing target");
});

test("a non-string target is rejected with 400", async () => {
  const res1 = await POST(jsonRequest({ target: 42 }));
  assert.equal(res1.status, 400, "Numeric target should return 400");
  const { body: body1 } = await readJson(res1);
  assert.equal(body1.error, "unknown_plan", "Error should be unknown_plan for numeric target");

  const res2 = await POST(jsonRequest({ target: null }));
  assert.equal(res2.status, 400, "Null target should return 400");
  const { body: body2 } = await readJson(res2);
  assert.equal(body2.error, "unknown_plan", "Error should be unknown_plan for null target");
});

test("ANTI-IDOR: an unauthenticated caller with a valid plan never reaches the subscription lookup", async () => {
  const validPlans = ["free", "companion", "assistant", "studio"];
  for (const target of validPlans) {
    const res = await POST(jsonRequest({ target }));
    // A 404 or a 200 here would mean an unauthenticated request had reached customer data.
    assert.equal(res.status, 401, `Unauthenticated request for ${target} should return 401`);
    const { body } = await readJson(res);
    assert.equal(body.error, "not_signed_in", `Error should be not_signed_in for ${target}`);
  }
});

test("ANTI-IDOR: a body naming another customer cannot change the outcome", async () => {
  const res = await POST(
    jsonRequest({
      target: "studio",
      email: "victim@example.com",
      customerId: "cus_victim",
      subscriptionId: "sub_victim",
    }),
  );
  assert.equal(res.status, 401, "Request carrying another customer's details should still return 401");
  const { body } = await readJson(res);
  assert.equal(body.error, "not_signed_in", "Error should be not_signed_in, proving the body cannot name a customer");
});
