// Tests for src/app/api/admin/login/route.ts
//
// These cover the UNAUTHENTICATED boundary — configuration gate, body
// validation and enumeration safety. They deliberately do not attempt a
// successful login: there is no seeded admin in this environment, and
// inventing credentials would produce a test that asserts nothing.

import test from "node:test";
import assert from "node:assert/strict";
import { loadRoute, jsonRequest, readJson, resetNet } from "./route-harness/index.mjs";

const { POST } = await loadRoute("src/app/api/admin/login/route.ts", { fresh: true });

const URL_ = "https://mira.vualet.com/api/admin/login";
const NOT_CONFIGURED_MSG = "Set ADMIN_SESSION_SECRET to enable the admin panel.";
const TEST_SECRET = "test-secret-for-route-tests-only";

function rawReq(body, ip) {
  return new Request(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", ...(ip ? { "cf-connecting-ip": ip } : {}) },
    body,
  });
}

test.beforeEach(() => {
  resetNet();
});

test("an unconfigured admin panel returns 503", async () => {
  delete process.env.ADMIN_SESSION_SECRET;
  const res = await POST(jsonRequest({ email: "a@b.com", password: "x" }));
  const { body } = await readJson(res);
  assert.equal(res.status, 503);
  assert.equal(body.error, "not_configured");
  assert.equal(body.message, NOT_CONFIGURED_MSG);
});

test("the 503 fires before body parsing", async () => {
  delete process.env.ADMIN_SESSION_SECRET;
  const res = await POST(rawReq("{ broken"));
  const { body } = await readJson(res);
  assert.equal(res.status, 503, "the configuration gate runs before the body is parsed");
  assert.equal(body.error, "not_configured", "must not be the 400 invalid-body error");
  assert.equal(body.message, NOT_CONFIGURED_MSG);
});

test("malformed JSON returns 400 invalid body", async () => {
  process.env.ADMIN_SESSION_SECRET = TEST_SECRET;
  const res = await POST(rawReq("{ broken", "10.0.0.1"));
  const { body } = await readJson(res);
  assert.equal(res.status, 400);
  assert.equal(body.error, "invalid body", 'the value is "invalid body" with a space, not "invalid_body"');
});

test("a missing password returns 400 missing_credentials", async () => {
  process.env.ADMIN_SESSION_SECRET = TEST_SECRET;
  const res = await POST(jsonRequest({ email: "a@b.com" }, { headers: { "cf-connecting-ip": "10.0.0.2" } }));
  const { body } = await readJson(res);
  assert.equal(res.status, 400);
  assert.equal(body.error, "missing_credentials");
});

test("a missing email returns 400 missing_credentials", async () => {
  process.env.ADMIN_SESSION_SECRET = TEST_SECRET;
  const res = await POST(jsonRequest({ password: "x" }, { headers: { "cf-connecting-ip": "10.0.0.3" } }));
  const { body } = await readJson(res);
  assert.equal(res.status, 400);
  assert.equal(body.error, "missing_credentials");
});

test("an empty body returns 400 missing_credentials", async () => {
  process.env.ADMIN_SESSION_SECRET = TEST_SECRET;
  const res = await POST(jsonRequest({}, { headers: { "cf-connecting-ip": "10.0.0.4" } }));
  const { body } = await readJson(res);
  assert.equal(res.status, 400);
  assert.equal(body.error, "missing_credentials");
});

test("ENUMERATION SAFETY: an unknown email and a plausible admin email are indistinguishable", async () => {
  process.env.ADMIN_SESSION_SECRET = TEST_SECRET;
  const headers = { "cf-connecting-ip": "10.0.0.5" };

  const res1 = await POST(jsonRequest({ email: "nobody-at-all@example.com", password: "wrong" }, { headers }));
  const { body: body1 } = await readJson(res1);

  const res2 = await POST(jsonRequest({ email: "admin@vualet.com", password: "wrong" }, { headers }));
  const { body: body2 } = await readJson(res2);

  assert.equal(res1.status, res2.status, "status must not differ — that would enumerate admin accounts");
  assert.deepStrictEqual(body1, body2, "body must not differ — that would enumerate admin accounts");
});
