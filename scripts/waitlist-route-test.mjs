// Tests for src/app/api/waitlist/route.ts
//
// POST backs a plain HTML form, so it ALWAYS redirects (303) and never returns
// JSON. GET is an admin export, and its failure modes must never leak
// subscriber emails.
//
// Persistence may genuinely fail here (no KV configured, file path may be
// unwritable), so nothing below asserts on successful persistence or on entry
// contents — only on status codes, redirect targets and error shapes.

import test from "node:test";
import assert from "node:assert/strict";
import { loadRoute, readJson, resetNet } from "./route-harness/index.mjs";

const { POST, GET } = await loadRoute("src/app/api/waitlist/route.ts", { fresh: true });

const URL_ = "https://mira.vualet.com/api/waitlist";

function formPost(fields) {
  return new Request(URL_, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

test.beforeEach(() => {
  resetNet();
});

test("an empty email redirects with error=1", async () => {
  const res = await POST(formPost({ email: "" }));
  assert.strictEqual(res.status, 303);
  const location = res.headers.get("location");
  assert.ok(location && location.includes("error=1"), `expected error=1 in location, got: ${location}`);
});

test("a malformed email redirects with error=1", async () => {
  for (const email of ["notanemail", "a@b", "@example.com"]) {
    const res = await POST(formPost({ email }));
    assert.strictEqual(res.status, 303, `${email} should redirect`);
    const location = res.headers.get("location");
    assert.ok(location && location.includes("error=1"), `expected error=1 for ${email}, got: ${location}`);
  }
});

test("an over-length email redirects with error=1", async () => {
  const email = "a".repeat(250) + "@example.com";
  const res = await POST(formPost({ email }));
  assert.strictEqual(res.status, 303);
  const location = res.headers.get("location");
  assert.ok(location && location.includes("error=1"), `expected error=1 in location, got: ${location}`);
});

test("POST never returns JSON — it always redirects", async () => {
  const res = await POST(formPost({ email: "valid@example.com" }));
  assert.strictEqual(res.status, 303, "this route backs a plain HTML form, so it always redirects");
  assert.ok(res.headers.get("location"), "a redirect must carry a location header");
});

test("SECURITY: GET without a configured key returns 404, not an empty list", async () => {
  const res = await GET(new Request(URL_));
  const { body } = await readJson(res);
  // A 200 with an empty array here would confirm the endpoint exists and is exportable.
  assert.strictEqual(res.status, 404);
  assert.strictEqual(body.error, "not_found");
});

test("SECURITY: GET with a wrong key never returns entries", async () => {
  const res = await GET(new Request(`${URL_}?key=definitely-not-the-key`));
  const { body } = await readJson(res);
  assert.ok(
    res.status === 404 || res.status === 401,
    `an unauthorised export must be refused, got ${res.status}`,
  );
  assert.ok(
    typeof body === "object" && body !== null && !("entries" in body),
    "subscriber emails must never leak to an unauthenticated caller",
  );
});
