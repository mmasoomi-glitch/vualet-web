// Tests for src/app/api/auth/verify/route.ts — the magic-link verifier.
//
// This route ONLY ever redirects; it never returns JSON, so nothing here calls
// readJson. No valid token can be minted in this environment, so every request
// must land on the expired login. The property under test is that nothing
// without a valid token reaches the account page.

import test from "node:test";
import assert from "node:assert/strict";
import { loadRoute, resetNet } from "./route-harness/index.mjs";

const { GET } = await loadRoute("src/app/api/auth/verify/route.ts", { fresh: true });

const BASE = "https://mira.vualet.com/api/auth/verify";

function expiredChecks(res, label) {
  assert.strictEqual(res.status, 303, `status for ${label}`);
  const loc = res.headers.get("location");
  assert.ok(loc && loc.includes("/mira/login"), `${label}: location must contain /mira/login`);
  assert.ok(loc && loc.includes("e=expired"), `${label}: location must contain e=expired`);
  assert.ok(loc && !loc.includes("/mira/account"), `${label}: must NOT reach the account page`);
}

test.beforeEach(() => {
  resetNet();
});

test("a missing token redirects to the expired login", async () => {
  expiredChecks(await GET(new Request(BASE)), "missing token");
});

test("an empty token redirects to the expired login", async () => {
  expiredChecks(await GET(new Request(BASE + "?token=")), "empty token");
});

test("a garbage token redirects to the expired login", async () => {
  for (const val of ["abc", "../../etc/passwd", "null", "undefined", "0", "a".repeat(500)]) {
    const res = await GET(new Request(BASE + "?token=" + encodeURIComponent(val)));
    expiredChecks(res, `token "${val.slice(0, 24)}"`);
  }
});

test("a token that looks like a JWT is still rejected", async () => {
  const fakeJwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhQGIuY29tIn0.notarealsignature";
  const res = await GET(new Request(BASE + "?token=" + encodeURIComponent(fakeJwt)));
  // Merely looking like a token must not grant a session.
  expiredChecks(res, "JWT-shaped token");
});

test("SECURITY: no unverified request ever reaches the account page", async () => {
  const allTokens = [
    undefined, "", "abc", "../../etc/passwd", "null", "undefined", "0",
    "a".repeat(500),
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhQGIuY29tIn0.notarealsignature",
    "random-garbage-12345", "null%00",
  ];
  for (const val of allTokens) {
    const url = val === undefined ? BASE : BASE + "?token=" + encodeURIComponent(val);
    const res = await GET(new Request(url));
    const loc = res.headers.get("location");
    assert.ok(
      loc && !loc.includes("/mira/account"),
      `a redirect to the account page would mean a session was created without a valid token (token: ${String(val).slice(0, 24)})`,
    );
    assert.ok(loc && loc.includes("e=expired"), `location must contain e=expired (token: ${String(val).slice(0, 24)})`);
  }
});

test("the redirect is 303, not 302", async () => {
  const res = await GET(new Request(BASE));
  assert.strictEqual(res.status, 303, "303 forces the follow-up request to be a GET");
});
