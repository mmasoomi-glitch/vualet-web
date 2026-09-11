// The auth request route is deliberately enumeration-safe.
// Every path — malformed input, invalid emails, rate-limited requests — returns
// the exact same 200 OK payload, so an attacker cannot learn which addresses
// have accounts. These tests pin that property down.

import test from "node:test";
import assert from "node:assert/strict";
import { loadRoute, jsonRequest, readJson, resetNet } from "./route-harness/index.mjs";

const { POST } = await loadRoute("src/app/api/auth/request/route.ts", { fresh: true });

const MSG = "If that email is valid, a sign-in link is on its way.";

function ipReq(obj, ip) {
  return jsonRequest(obj, { headers: { "cf-connecting-ip": ip } });
}

test.beforeEach(() => {
  resetNet();
});

test("a valid email returns the enumeration-safe payload", async () => {
  const res = await POST(ipReq({ email: "user@example.com" }, "203.0.113.1"));
  const { body } = await readJson(res);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.message, MSG);
});

test("malformed JSON still returns 200 ok, never 400", async () => {
  const req = new Request("https://mira.vualet.com/api/auth/request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{ broken",
  });
  const res = await POST(req);
  const { body } = await readJson(res);
  assert.strictEqual(res.status, 200, "malformed JSON must not be distinguishable");
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.message, MSG);
});

test("a missing email key returns 200 ok", async () => {
  const res = await POST(ipReq({ foo: "bar" }, "203.0.113.2"));
  const { body } = await readJson(res);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.message, MSG);
});

test("an invalid email shape returns 200 ok", async () => {
  const invalid = ["notanemail", "a@b", "@example.com", "a b@example.com"];
  let i = 0;
  for (const email of invalid) {
    const res = await POST(ipReq({ email }, `203.0.113.1${i++}`));
    const { body } = await readJson(res);
    assert.strictEqual(res.status, 200, `${email} must return 200`);
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.message, MSG);
  }
});

test("an email over 254 characters returns 200 ok", async () => {
  const longEmail = "a".repeat(250) + "@example.com";
  const res = await POST(ipReq({ email: longEmail }, "203.0.113.3"));
  const { body } = await readJson(res);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.message, MSG);
});

test("ENUMERATION SAFETY: two different addresses give byte-identical replies", async () => {
  const res1 = await POST(ipReq({ email: "user@example.com" }, "203.0.113.4"));
  const { body: body1 } = await readJson(res1);

  const res2 = await POST(ipReq({ email: "nobody-here-at-all@example.com" }, "203.0.113.5"));
  const { body: body2 } = await readJson(res2);

  assert.strictEqual(res1.status, res2.status, "status must not differ between addresses");
  assert.deepStrictEqual(
    body1,
    body2,
    "Any difference here would let an attacker enumerate registered accounts.",
  );
});

test("the rate limit is silent", async () => {
  // MAX_PER_WINDOW is 4 and limited() pushes before comparing, so the 6th
  // request from this IP is limited — and must still be indistinguishable.
  const ip = "203.0.113.99";
  for (let i = 0; i < 8; i++) {
    const res = await POST(ipReq({ email: `user${i}@example.com` }, ip));
    const { body } = await readJson(res);
    assert.strictEqual(res.status, 200, `request ${i + 1}: limiter must never show in the status`);
    assert.strictEqual(body.ok, true, `request ${i + 1}: limiter must never show in the body`);
    assert.strictEqual(body.message, MSG, `request ${i + 1}: message must be unchanged`);
  }
});
