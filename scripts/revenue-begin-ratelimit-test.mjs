/**
 * /api/begin — per-IP rate-limit tests against the REAL route handler.
 *
 * /api/begin provisions a tenant record + Telegram deep-link with no payment,
 * so an unbounded endpoint is an open faucet. The branch adds an in-memory
 * sliding-window limiter of 5 per IP per hour. These tests drive the real
 * handler and assert both halves of the claim: that the 6th call is refused,
 * and that the limiter is genuinely PER-IP rather than a global counter.
 *
 * Each test loads the route with { fresh: true } so the module-level counter
 * map starts empty — otherwise tests would leak into each other.
 *
 * Run: npm run test:begin-limit
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadRoute, jsonRequest, readJson, env, netCalls, resetNet } from "./route-harness/index.mjs";

const LIMIT = 5;

beforeEach(() => {
  env();
  resetNet();
});

/** A fresh route module, so the in-memory limiter starts empty. */
const freshRoute = () => loadRoute("src/app/api/begin/route.ts", { fresh: true });

const callFrom = (POST, ip, body = { plan: "trial" }) =>
  POST(jsonRequest(body, { headers: { "x-forwarded-for": ip } })).then(readJson);

test("d: 5 calls from one IP succeed and the 6th is 429 rate_limited", async () => {
  const { POST } = await freshRoute();
  const ip = "203.0.113.10";

  for (let i = 1; i <= LIMIT; i++) {
    const { status, body } = await callFrom(POST, ip);
    assert.equal(status, 200, `call ${i}/${LIMIT} must succeed, got ${status}`);
    assert.ok(body.token, `call ${i} must mint a connect token`);
    assert.match(body.botUrl, /^https:\/\/t\.me\//, `call ${i} must return a Telegram deep-link`);
  }

  const sixth = await callFrom(POST, ip);
  assert.equal(sixth.status, 429, "the 6th call must be refused");
  assert.equal(sixth.body.error, "rate_limited");
  assert.equal(sixth.body.token, undefined, "a refused call must not provision anything");
});

test("d: once limited, the IP STAYS limited (7th, 8th, 9th also 429)", async () => {
  const { POST } = await freshRoute();
  const ip = "203.0.113.11";
  for (let i = 0; i < LIMIT; i++) await callFrom(POST, ip);

  for (let i = 6; i <= 9; i++) {
    const { status, body } = await callFrom(POST, ip);
    assert.equal(status, 429, `call ${i} must stay refused`);
    assert.equal(body.error, "rate_limited");
  }
});

test("d: PER-IP not global — a DIFFERENT IP is completely unaffected by an exhausted one", async () => {
  const { POST } = await freshRoute();
  const noisy = "198.51.100.1";
  const innocent = "198.51.100.2";

  // Burn the noisy neighbour all the way past the limit.
  for (let i = 0; i < LIMIT; i++) {
    assert.equal((await callFrom(POST, noisy)).status, 200);
  }
  assert.equal((await callFrom(POST, noisy)).status, 429, "noisy IP must now be limited");

  // The innocent IP must still get its OWN full allowance.
  for (let i = 1; i <= LIMIT; i++) {
    const { status } = await callFrom(POST, innocent);
    assert.equal(status, 200, `innocent IP call ${i} must succeed — the limiter is per-IP`);
  }
  assert.equal(
    (await callFrom(POST, innocent)).status,
    429,
    "the innocent IP has its own independent budget, which also ends at 5",
  );

  // And the noisy one is still limited — the buckets never merged.
  assert.equal((await callFrom(POST, noisy)).status, 429);
});

test("d: interleaved IPs keep separate counters (a global counter would fail this)", async () => {
  const { POST } = await freshRoute();
  const a = "192.0.2.1";
  const b = "192.0.2.2";

  // 5 each, alternating. A single global counter would have tripped at call 6.
  for (let i = 0; i < LIMIT; i++) {
    assert.equal((await callFrom(POST, a)).status, 200, `A call ${i + 1}`);
    assert.equal((await callFrom(POST, b)).status, 200, `B call ${i + 1}`);
  }
  // 10 successful calls have happened; both are now individually exhausted.
  assert.equal((await callFrom(POST, a)).status, 429);
  assert.equal((await callFrom(POST, b)).status, 429);
});

test("d: many distinct IPs each get a full allowance", async () => {
  const { POST } = await freshRoute();
  for (let n = 0; n < 20; n++) {
    const ip = `10.0.0.${n}`;
    for (let i = 0; i < LIMIT; i++) {
      assert.equal((await callFrom(POST, ip)).status, 200, `${ip} call ${i + 1}`);
    }
    assert.equal((await callFrom(POST, ip)).status, 429, `${ip} must trip at ${LIMIT + 1}`);
  }
});

test("d: x-forwarded-for chains use the FIRST (client) hop as the bucket key", async () => {
  const { POST } = await freshRoute();
  const client = "203.0.113.50";

  // Same client, different proxy hops appended — must be ONE bucket.
  const chains = [
    `${client}`,
    `${client}, 10.1.1.1`,
    `${client}, 10.2.2.2, 10.3.3.3`,
    `  ${client}  , 10.4.4.4`,
  ];
  for (let i = 0; i < chains.length; i++) {
    const res = await POST(jsonRequest({ plan: "trial" }, { headers: { "x-forwarded-for": chains[i] } })).then(readJson);
    assert.equal(res.status, 200, `chain ${i + 1} must count toward the same allowance`);
  }
  // 4 used; the 5th succeeds and the 6th must be refused.
  assert.equal((await callFrom(POST, `${client}, 10.9.9.9`)).status, 200);
  assert.equal((await callFrom(POST, client)).status, 429, "all chain forms share one bucket");
});

test("d: requests with NO x-forwarded-for fall into a single shared 'unknown' bucket", async () => {
  // Documents real behaviour: without the header, clientIp() returns "unknown",
  // so all such callers share one allowance. Behind a proxy that always sets
  // XFF this is unreachable; direct-to-origin traffic would collide.
  const { POST } = await freshRoute();
  for (let i = 1; i <= LIMIT; i++) {
    assert.equal((await POST(jsonRequest({ plan: "trial" })).then(readJson)).status, 200, `call ${i}`);
  }
  const over = await POST(jsonRequest({ plan: "trial" })).then(readJson);
  assert.equal(over.status, 429);
});

test("d: the limiter runs BEFORE body parsing — a limited IP is refused even with a bad body", async () => {
  const { POST } = await freshRoute();
  const ip = "203.0.113.99";
  for (let i = 0; i < LIMIT; i++) await callFrom(POST, ip);

  const res = await POST(jsonRequest("{not json", { headers: { "x-forwarded-for": ip } })).then(readJson);
  assert.equal(res.status, 429, "rate limiting must not depend on a parseable body");
  assert.equal(res.body.error, "rate_limited");
});

test("d: field-length caps still apply within the allowance (limiter did not replace validation)", async () => {
  const { POST } = await freshRoute();
  const ip = "203.0.113.77";
  const res = await callFrom(POST, ip, { plan: "trial", setup: { role: "x".repeat(201) } });
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /too long/);
});

test("d: no outbound network call is made by /api/begin at all", async () => {
  const { POST } = await freshRoute();
  await callFrom(POST, "203.0.113.200");
  assert.equal(netCalls.length, 0, "the mock onboarding path must not touch any payment provider");
});
