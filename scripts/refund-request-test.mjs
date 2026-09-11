// Tests for src/app/api/subscription/refund-request/route.ts
//
// This route records a refund REQUEST for human review. It never moves money —
// the actual refund path stays behind human approval because it moves money out.
// These tests prove the unauthenticated boundary: no session means 401, and an
// unauthenticated caller never receives anything resembling a refund
// confirmation.

import test from "node:test";
import assert from "node:assert/strict";
import { loadRoute, jsonRequest, readJson, resetNet } from "./route-harness/index.mjs";

const { POST } = await loadRoute("src/app/api/subscription/refund-request/route.ts", { fresh: true });

const URL_ = "https://mira.vualet.com/api/subscription/refund-request";
const MSG = "Sign in to request a refund.";

function assertRejected(res, body, label) {
  assert.strictEqual(res.status, 401, `${label}: must be 401`);
  assert.strictEqual(body.error, "not_signed_in", `${label}: error must be not_signed_in`);
  assert.strictEqual(body.message, MSG, `${label}: message must be byte-exact`);
}

test.beforeEach(() => {
  resetNet();
});

test("an unauthenticated refund request is rejected with 401", async () => {
  const res = await POST(jsonRequest({ reason: "changed my mind" }));
  const { body } = await readJson(res);
  assertRejected(res, body, "plain request");
});

test("an empty body is rejected with 401", async () => {
  const res = await POST(jsonRequest({}));
  const { body } = await readJson(res);
  assertRejected(res, body, "empty body");
});

test("malformed JSON is still rejected with 401", async () => {
  // The session check runs before the body is parsed, so a malformed body must
  // not produce a 400 here.
  const req = new Request(URL_, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{ broken",
  });
  const res = await POST(req);
  const { body } = await readJson(res);
  assertRejected(res, body, "malformed JSON");
});

test("ANTI-IDOR: a body naming another customer cannot authenticate the caller", async () => {
  // Identity comes only from the verified session, never from the request body.
  const res = await POST(
    jsonRequest({
      email: "victim@example.com",
      customerId: "cus_victim",
      subscriptionId: "sub_victim",
      paymentId: "pay_victim",
      reason: "x",
    }),
  );
  const { body } = await readJson(res);
  assertRejected(res, body, "body naming a victim");
});

test("ANTI-IDOR: spoofed identity headers do not authenticate the caller", async () => {
  const req = new Request(URL_, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-email": "victim@example.com",
      "x-admin": "true",
      authorization: "Bearer forged",
    },
    body: JSON.stringify({ email: "victim@example.com", customerId: "cus_victim", reason: "x" }),
  });
  const res = await POST(req);
  const { body } = await readJson(res);
  assertRejected(res, body, "spoofed headers");
});

test("no refund is ever acknowledged to an unauthenticated caller", async () => {
  const bodies = [
    { reason: "changed my mind" },
    {},
    { email: "victim@example.com", customerId: "cus_victim" },
  ];
  for (const b of bodies) {
    const res = await POST(jsonRequest(b));
    const { body: responseBody } = await readJson(res);
    for (const key of ["refundId", "refunded", "amount", "ok"]) {
      assert.ok(
        !(key in responseBody),
        `an unauthenticated caller must never receive "${key}" — that reads as a refund confirmation`,
      );
    }
  }
});
