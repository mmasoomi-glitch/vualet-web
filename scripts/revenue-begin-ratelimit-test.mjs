/**
 * /api/begin — per-client rate-limit tests against the REAL route handler,
 * plus the WhatsApp-first signup contract (decisions#340, option A).
 *
 * /api/begin provisions a tenant record + pairing link with no payment, so an
 * unbounded endpoint is an open faucet. The branch adds an in-memory
 * sliding-window limiter of 5 per client per hour. These tests drive the real
 * handler and assert both halves of the claim: that the 6th call is refused,
 * and that the limiter is genuinely PER-CLIENT rather than a global counter.
 *
 * ── WHAT CHANGED HERE, AND WHY IT MATTERS MORE THAN THE FIX ───────────────
 * This file used to contain a test named
 *
 *     "x-forwarded-for chains use the FIRST (client) hop as the bucket key"
 *
 * which ASSERTED THE VULNERABILITY WAS CORRECT. nginx uses
 * `proxy_add_x_forwarded_for`, which APPENDS to whatever the caller sent, so
 * the "first hop" is a value the attacker types: the bucket key was chosen by
 * the person being limited (gotchas#247). A green suite never caught it
 * because the suite was pinning it in place. A test that locks in a
 * vulnerability is worse than no test — it converts an open faucet into a
 * documented, defended requirement.
 *
 * It has been deleted, and so has its companion
 * "requests with NO x-forwarded-for fall into a single shared 'unknown'
 * bucket", which pinned a second latent fault: `|| "unknown"` meant every
 * caller without the header shared ONE 5-per-hour allowance, i.e. a global
 * signup outage waiting for a header to go missing.
 *
 * Deleting was not enough. Both are replaced by tests that assert the SECURE
 * invariant (decisions#343) and that FAIL against the old code — see the
 * COUNTERFACTUAL section at the foot of this file, which runs them against
 * `git show HEAD:src/app/api/begin/route.ts` and requires them to go red.
 *
 * Each test loads the route with { fresh: true } so the module-level counter
 * map starts empty — otherwise tests would leak into each other.
 *
 * WHY THE DEFAULT BODY CARRIES A PHONE: signup is now WhatsApp-first and a
 * WhatsApp signup cannot succeed without a number, so a body of
 * `{ plan: "trial" }` alone would 400 and every rate-limit test would stop
 * testing the rate limiter and start testing validation instead. The default
 * body is therefore the smallest body that SUCCEEDS on the default channel.
 *
 * Run: npm run test:begin-limit
 */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ROOT, loadRoute, jsonRequest, readJson, env, netCalls, resetNet,
} from "./route-harness/index.mjs";

const LIMIT = 5;

// The GLOBAL per-endpoint ceiling's env override, cleared in beforeEach so a
// developer shell can never change what these tests mean. The route's default
// is 120/hour; tests that need the ceiling to bind quickly set this instead of
// sending 121 requests, and exactly one test below sends 121 requests to prove
// the SHIPPED default is the number it claims to be.
const GLOBAL_LIMIT_ENV = "MIRA_BEGIN_GLOBAL_LIMIT";
const GLOBAL_LIMIT_DEFAULT = 120;

// The configured WhatsApp pairing surface. This repo has NO pairing route of
// its own — the machinery is in the engine — so the route composes the link
// onto this owner-configured base. Tests set it explicitly so the result never
// depends on a developer shell value.
const PAIR_BASE = "https://pair.example.test/wa/pair";

// A national-form UAE number. Deliberately NOT already E.164, so "is it stored
// normalised?" is a real question and not a tautology.
const RAW_PHONE = "050 123 4567";
const RAW_PHONE_E164 = "+971501234567";

// Gate C1: a LEGACY three-box form, exactly as the pre-r2 wizard sent it.
// specs#160r2 requires only `banRisk`, but this body is deliberately left in
// its old shape: it is the standing proof that a client still on the old
// release is accepted, and that its extra scopes are PRESERVED, not discarded.
// observationNumber is opt-IN and deliberately left false so the default body
// proves the optional scope is not needed to succeed.
const FULL_CONSENT = {
  unofficialAutomation: true,
  banRisk: true,
  ownAccountReplies: true,
  observationNumber: false,
};

/**
 * The smallest body that succeeds on the default (WhatsApp) channel.
 * It now carries consent for the same reason it carries a phone: a WhatsApp
 * signup cannot complete without one, so a body missing it would make every
 * rate-limit test below a consent test instead.
 */
const DEFAULT_BODY = { plan: "trial", phone: RAW_PHONE, consent: FULL_CONSENT };

beforeEach(() => {
  env({ MIRA_WHATSAPP_PAIR_BASE: PAIR_BASE });
  delete process.env[GLOBAL_LIMIT_ENV];
  resetNet();
});

/** A fresh route module, so BOTH in-memory limiters start empty. */
const freshRoute = () => loadRoute("src/app/api/begin/route.ts", { fresh: true });

/** The REAL store, shared with every route instance (fresh routes reuse it). */
const store = () => loadRoute("src/lib/store.ts");

/**
 * A call from a given client address.
 *
 * THE HEADER IS `x-real-ip`, NOT `x-forwarded-for`, AND THAT IS THE FIX
 * (decisions#343). x-forwarded-for is appended to by nginx, so its contents
 * are partly typed by the caller and can never be a rate-limit key. x-real-ip
 * carries ONE value that nginx sets from CF-Connecting-IP after
 * `set_real_ip_from` has established that the request really came through
 * Cloudflare. The route reads it whole and never splits it on anything.
 */
const callFrom = (POST, ip, body = DEFAULT_BODY) =>
  POST(jsonRequest(body, { headers: { "x-real-ip": ip } })).then(readJson);

/** A call with arbitrary headers — used to prove which header is trusted. */
const callWith = (POST, headers, body = DEFAULT_BODY) =>
  POST(jsonRequest(body, { headers })).then(readJson);

test("d: 5 calls from one IP succeed and the 6th is 429 rate_limited", async () => {
  const { POST } = await freshRoute();
  const ip = "203.0.113.10";

  for (let i = 1; i <= LIMIT; i++) {
    const { status, body } = await callFrom(POST, ip);
    assert.equal(status, 200, `call ${i}/${LIMIT} must succeed, got ${status}`);
    assert.ok(body.token, `call ${i} must mint a connect token`);
    // CHANGED DELIBERATELY: this line used to assert a Telegram deep-link
    // (https://t.me/…). The default body now uses the default channel, which is
    // WhatsApp, so the correct shape to assert is the WhatsApp pairing link.
    // The Telegram deep-link is still asserted — see the explicit-channel test.
    assert.equal(body.channel, "whatsapp", `call ${i} must name the channel it provisioned`);
    assert.equal(
      body.pairUrl,
      `${PAIR_BASE}?token=${body.token}`,
      `call ${i} must return a WhatsApp pairing link built on the configured base`,
    );
    assert.equal(body.botUrl, undefined, `call ${i} must not hand a WhatsApp signup a Telegram link`);
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
  // 20 clients x 5 = 100 provisions, deliberately under the 120/hour global
  // ceiling so that this test still measures gate 1 and not gate 2.
  const { POST } = await freshRoute();
  for (let n = 0; n < 20; n++) {
    const ip = `10.0.0.${n}`;
    for (let i = 0; i < LIMIT; i++) {
      assert.equal((await callFrom(POST, ip)).status, 200, `${ip} call ${i + 1}`);
    }
    assert.equal((await callFrom(POST, ip)).status, 429, `${ip} must trip at ${LIMIT + 1}`);
  }
});

// ── x-forwarded-for is NOT a key (gotchas#247, decisions#343) ─────────────
// These four replace the deleted test that asserted the leftmost x-forwarded-for
// hop WAS the bucket key. Each one is red against the pre-fix route; the
// counterfactual section at the foot of this file proves it.

test("s: SPOOFING x-forwarded-for does NOT buy a fresh bucket — THE defect (gotchas#247)", async () => {
  // The whole vulnerability in one test. One real client (one x-real-ip) rotates
  // a forged x-forwarded-for on every request, exactly as an attacker would
  // against nginx's proxy_add_x_forwarded_for. Pre-fix this bought an unlimited
  // number of buckets and the limiter never fired. It must fire on the 6th.
  const { POST } = await freshRoute();
  const realClient = "203.0.113.50";

  for (let i = 1; i <= LIMIT; i++) {
    const res = await callWith(POST, {
      "x-real-ip": realClient,
      "x-forwarded-for": `10.0.0.${i}, 172.16.0.${i}`, // a different forgery each time
    });
    assert.equal(res.status, 200, `call ${i}/${LIMIT} is still inside the allowance`);
  }

  const sixth = await callWith(POST, {
    "x-real-ip": realClient,
    "x-forwarded-for": "198.51.100.77, 172.16.0.99",
  });
  assert.equal(
    sixth.status,
    429,
    "a forged x-forwarded-for must NOT mint a new bucket — the key is the trusted address",
  );
  assert.equal(sixth.body.error, "rate_limited");
  assert.equal(sixth.body.token, undefined, "a refused call must not provision anything");
});

test("s: x-forwarded-for ALONE grants no allowance at all — it is never read as a key", async () => {
  // The inverse of the test that was deleted. With no trusted address present,
  // a repeated x-forwarded-for must NOT become a bucket: the route fails OPEN
  // and the global ceiling carries these requests. Pre-fix these 12 identical
  // chains shared one bucket and the 6th was refused.
  const { POST } = await freshRoute();
  const client = "203.0.113.51";
  const chains = [
    `${client}`,
    `${client}, 10.1.1.1`,
    `${client}, 10.2.2.2, 10.3.3.3`,
    `  ${client}  , 10.4.4.4`,
  ];

  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < chains.length; i++) {
      const res = await callWith(POST, { "x-forwarded-for": chains[i] });
      assert.equal(
        res.status,
        200,
        `round ${round + 1} chain ${i + 1}: x-forwarded-for must not be keyed on`,
      );
    }
  }
});

test("s: a COMMA-BEARING x-real-ip is a chain, not an address — it is never a key", async () => {
  // If the edge regresses to emitting a chain here, the leftmost hop is
  // attacker-typed again. The route must refuse to split on the comma and treat
  // the whole value as absent, NOT quietly key on "203.0.113.52".
  const { POST } = await freshRoute();
  const client = "203.0.113.52";

  // Exhaust the genuine bucket for that address first.
  for (let i = 0; i < LIMIT; i++) assert.equal((await callFrom(POST, client)).status, 200);
  assert.equal((await callFrom(POST, client)).status, 429, "the clean address is now limited");

  // A chain that STARTS with the same address must not land in that bucket…
  const chained = await callFrom(POST, `${client}, 10.9.9.9`);
  assert.equal(chained.status, 200, "the route must not split the value and reuse the first hop");

  // …and must not build a bucket of its own out of the chain either.
  for (let i = 0; i < 10; i++) {
    assert.equal(
      (await callFrom(POST, `${client}, 10.9.9.9`)).status,
      200,
      "a chain value is unparseable, so it is treated as ABSENT (fail-open), not as a key",
    );
  }
});

test("s: an UNPARSEABLE x-real-ip is treated as absent, never used as a bucket key", async () => {
  // Every one of these is something we cannot prove is an address. Using any of
  // them as a key would be inventing trust; the route fails open instead and
  // lets the global ceiling hold the request (decisions#343).
  const { POST } = await freshRoute();
  const junk = [
    "not-an-ip",
    "999.1.1.1",
    "1.2.3",
    "1.2.3.4.5",
    "01.2.3.4", // non-canonical octet: one address must not have two spellings
    "1.2.3.4:8080", // a port is not part of an address
    "   ",
    "2001:db8::1::2", // two "::" is not a legal literal
    "gggg::1",
  ];

  for (const value of junk) {
    for (let i = 0; i < LIMIT + 3; i++) {
      const res = await callFrom(POST, value);
      assert.equal(
        res.status,
        200,
        `"${value}" must not become a rate-limit bucket (call ${i + 1})`,
      );
    }
  }
});

// ── The FAIL_OPEN fallback (decisions#343) ───────────────────────────────
// The ruling overturned both "fall back to the socket address" and "fail
// closed". The socket address is always 127.0.0.1 here (the app listens on
// 127.0.0.1 behind an nginx on the same host), so that fallback degenerates
// into one global bucket — a signup outage. The old `|| "unknown"` constant
// was that same outage, already shipped. These tests pin its removal.

test("f: NO client address at all means NO per-client limiting — fail OPEN, not closed", async () => {
  // Pre-fix, these all shared the constant "unknown" bucket and the 6th was
  // refused. That was a global signup outage one missing header away.
  const { POST } = await freshRoute();
  for (let i = 1; i <= 20; i++) {
    const res = await callWith(POST, {});
    assert.equal(res.status, 200, `call ${i} must not be refused for a missing header`);
    assert.ok(res.body.token, `call ${i} must still provision normally`);
  }
});

test("f: an EMPTY x-real-ip is absent, not an empty-string bucket", async () => {
  const { POST } = await freshRoute();
  for (let i = 1; i <= 12; i++) {
    assert.equal((await callFrom(POST, "")).status, 200, `call ${i}`);
  }
});

test("f: fail-open callers do NOT share a bucket with each other or with real ones", async () => {
  // The failure this removes: one shared fallback bucket means a single caller
  // with no header can lock out every other caller with no header, and (worse)
  // any real customer who happens to land in the same bucket.
  const { POST } = await freshRoute();
  const real = "203.0.113.60";

  for (let i = 0; i < 12; i++) assert.equal((await callWith(POST, {})).status, 200);

  // A genuine client still has its own untouched, full allowance.
  for (let i = 1; i <= LIMIT; i++) {
    assert.equal((await callFrom(POST, real)).status, 200, `real client call ${i}`);
  }
  assert.equal((await callFrom(POST, real)).status, 429, "and it still ends at 5");

  // And the headerless traffic is STILL not limited by that client's exhaustion.
  assert.equal((await callWith(POST, {})).status, 200);
});

test("d: the limiter runs BEFORE body parsing — a limited IP is refused even with a bad body", async () => {
  const { POST } = await freshRoute();
  const ip = "203.0.113.99";
  for (let i = 0; i < LIMIT; i++) await callFrom(POST, ip);

  const res = await POST(jsonRequest("{not json", { headers: { "x-real-ip": ip } })).then(readJson);
  assert.equal(res.status, 429, "rate limiting must not depend on a parseable body");
  assert.equal(res.body.error, "rate_limited");
});

// ── IP masking: IPv4 /32, IPv6 /64 ────────────────────────────────────────

test("m: IPv4 is keyed at /32 — neighbouring addresses are separate customers", async () => {
  const { POST } = await freshRoute();
  for (let i = 0; i < LIMIT; i++) assert.equal((await callFrom(POST, "203.0.113.70")).status, 200);
  assert.equal((await callFrom(POST, "203.0.113.70")).status, 429);

  // .71 is a different household on the same /24 and must be untouched.
  assert.equal(
    (await callFrom(POST, "203.0.113.71")).status,
    200,
    "IPv4 must NOT be truncated to a prefix — that would punish whole networks",
  );
});

test("m: IPv6 is keyed at /64 — a whole /64 is ONE customer, because it costs pennies", async () => {
  // Any hosting customer is handed a /64. Keying on all 128 bits would give an
  // attacker 2^64 free buckets, which is the same as having no limiter.
  const { POST } = await freshRoute();
  const sameSixtyFour = [
    "2001:db8:1:2::1",
    "2001:db8:1:2::2",
    "2001:db8:1:2:ffff:ffff:ffff:ffff",
    "2001:db8:1:2:dead:beef:0:1",
    "2001:db8:1:2::abcd",
  ];
  for (let i = 0; i < sameSixtyFour.length; i++) {
    assert.equal((await callFrom(POST, sameSixtyFour[i])).status, 200, `address ${i + 1}`);
  }
  assert.equal(
    (await callFrom(POST, "2001:db8:1:2:9999::5")).status,
    429,
    "the 6th address inside one /64 must hit the SAME exhausted bucket",
  );

  // A DIFFERENT /64 is a different customer and keeps its own allowance.
  assert.equal(
    (await callFrom(POST, "2001:db8:1:3::1")).status,
    200,
    "the /64 next door must not be collateral damage",
  );
});

test("m: every spelling of one IPv6 address lands in one bucket", async () => {
  // Compressed, expanded, bracketed, mixed-case, IPv4-mapped. If any spelling
  // produced its own key, an attacker would just cycle spellings.
  const { POST } = await freshRoute();
  const spellings = [
    "2001:db8:0:0:0:0:0:1",
    "2001:db8::1",
    "2001:0db8:0000:0000:0000:0000:0000:0001",
    "[2001:DB8::1]",
    "2001:db8::0.0.0.1", // the last 32 bits written as a dotted quad
  ];
  for (let i = 0; i < spellings.length; i++) {
    assert.equal((await callFrom(POST, spellings[i])).status, 200, `spelling ${i + 1}`);
  }
  assert.equal(
    (await callFrom(POST, "2001:db8::1")).status,
    429,
    "five spellings of one address consumed one allowance, not five",
  );
  // The discriminating half. "They all share a bucket" is also true of a single
  // global constant bucket — which is exactly what the old code had — so the
  // convergence assertion above cannot stand alone: an UNRELATED address must
  // still be untouched.
  assert.equal(
    (await callFrom(POST, "2001:db8:2::1")).status,
    200,
    "a different address must not have been swept into the same bucket",
  );
});

test("m: an IPv4-mapped IPv6 address is the SAME customer as the bare IPv4", async () => {
  const { POST } = await freshRoute();
  for (let i = 0; i < LIMIT; i++) assert.equal((await callFrom(POST, "203.0.113.80")).status, 200);
  assert.equal(
    (await callFrom(POST, "::ffff:203.0.113.80")).status,
    429,
    "::ffff:a.b.c.d and a.b.c.d are one address and must be one bucket",
  );
  // Same discriminating half as above: convergence alone is also satisfied by
  // one global bucket, so prove the neighbour was not swept in with it.
  assert.equal(
    (await callFrom(POST, "::ffff:203.0.113.81")).status,
    200,
    "the mapped form of a DIFFERENT address is a different customer",
  );
});

test("m: IPv4-mapped addresses do NOT all collapse into the ::/64 bucket", async () => {
  // The trap this guards: every ::ffff:a.b.c.d shares the /64 "0:0:0:0", so
  // treating them as IPv6 would put EVERY IPv4 customer behind a dual-stack
  // listener into ONE 5-per-hour bucket — a global signup outage. Six distinct
  // mapped addresses must be six distinct customers.
  const { POST } = await freshRoute();
  for (let n = 1; n <= 6; n++) {
    for (let i = 1; i <= LIMIT; i++) {
      assert.equal(
        (await callFrom(POST, `::ffff:198.51.100.${n}`)).status,
        200,
        `mapped client ${n}, call ${i}`,
      );
    }
    assert.equal(
      (await callFrom(POST, `::ffff:198.51.100.${n}`)).status,
      429,
      `mapped client ${n} has its OWN allowance, which also ends at ${LIMIT}`,
    );
  }
});

// ── The GLOBAL per-endpoint ceiling ───────────────────────────────────────
// FAIL_OPEN is only safe because something else is holding the endpoint. That
// something did not exist before this change: the route had a per-IP window and
// no global cap of any kind, so "fail open" would have meant "no limiting".

test("G: the ceiling holds when EVERY request arrives with no usable address", async () => {
  process.env[GLOBAL_LIMIT_ENV] = "4";
  const { POST } = await freshRoute();

  for (let i = 1; i <= 4; i++) {
    assert.equal((await callWith(POST, {})).status, 200, `provision ${i} is within the ceiling`);
  }
  const over = await callWith(POST, {});
  assert.equal(over.status, 429, "the ceiling must refuse the 5th provision");
  assert.equal(over.body.error, "rate_limited");
  assert.equal(over.body.token, undefined, "a ceilinged call must not provision anything");
});

test("G: the ceiling is INDEPENDENT of IP — distinct addresses do not evade it", async () => {
  // The point of a global ceiling: an attacker with a /64, a botnet, or simply
  // a spoofable header cannot buy their way past it with fresh addresses.
  process.env[GLOBAL_LIMIT_ENV] = "3";
  const { POST } = await freshRoute();

  for (let i = 1; i <= 3; i++) {
    assert.equal((await callFrom(POST, `198.51.100.${i}`)).status, 200, `distinct client ${i}`);
  }
  const fourth = await callFrom(POST, "198.51.100.4");
  assert.equal(fourth.status, 429, "a brand-new address must still hit the global ceiling");
  assert.equal(fourth.body.error, "rate_limited");
});

test("G: the ceiling counts PROVISIONS, not requests — refusals cannot cause an outage", async () => {
  // If junk traffic ate the global budget, anyone could turn signup off by
  // posting garbage. Refused requests create no tenant, so they cost nothing.
  process.env[GLOBAL_LIMIT_ENV] = "3";
  const { POST } = await freshRoute();

  for (let i = 0; i < 40; i++) {
    const bad = await callWith(POST, {}, { plan: "trial", phone: "not a phone", consent: FULL_CONSENT });
    assert.equal(bad.status, 400, "the junk must be refused");
  }
  // The full budget is still there for real customers.
  for (let i = 1; i <= 3; i++) {
    assert.equal((await callWith(POST, {})).status, 200, `real provision ${i} still available`);
  }
  assert.equal((await callWith(POST, {})).status, 429);
});

test("G: a call refused by the ceiling is INDISTINGUISHABLE from a per-client refusal", async () => {
  // A caller must not be able to read "the endpoint is saturated" off the
  // response — that is a useful signal to whoever is saturating it.
  process.env[GLOBAL_LIMIT_ENV] = "1";
  const { POST } = await freshRoute();

  assert.equal((await callFrom(POST, "203.0.113.90")).status, 200);
  const globalRefusal = await callFrom(POST, "203.0.113.91");

  process.env[GLOBAL_LIMIT_ENV] = String(GLOBAL_LIMIT_DEFAULT);
  const { POST: POST2 } = await freshRoute();
  for (let i = 0; i < LIMIT; i++) await callFrom(POST2, "203.0.113.92");
  const perClientRefusal = await callFrom(POST2, "203.0.113.92");

  assert.equal(globalRefusal.status, 429);
  assert.equal(perClientRefusal.status, 429);
  assert.deepEqual(
    globalRefusal.body,
    perClientRefusal.body,
    "both gates must return the identical 429 body",
  );
  assert.equal(globalRefusal.body.error, "rate_limited", "and the existing contract is preserved");
});

test("G: the SHIPPED DEFAULT ceiling is 120 provisions per hour — the number, exercised", async () => {
  // Not a constant read out of the module: 120 real provisions through the real
  // handler with no env override, then one more that must be refused. This is
  // the test that goes red if someone quietly retunes the number.
  const { POST } = await freshRoute();
  assert.equal(process.env[GLOBAL_LIMIT_ENV], undefined, "no override may be in play");

  for (let i = 1; i <= GLOBAL_LIMIT_DEFAULT; i++) {
    // A fresh address every 5 calls so gate 1 never fires and gate 2 is the
    // only thing that can refuse.
    const res = await callFrom(POST, `10.${Math.floor(i / 250)}.${i % 250}.1`);
    assert.equal(res.status, 200, `provision ${i} must be inside the default ceiling`);
  }
  const overCeiling = await callFrom(POST, "10.200.200.1");
  assert.equal(overCeiling.status, 429, `provision ${GLOBAL_LIMIT_DEFAULT + 1} must be refused`);
  assert.equal(overCeiling.body.error, "rate_limited");
});

test("G: a broken MIRA_BEGIN_GLOBAL_LIMIT falls back to the default, never to 'no ceiling'", async () => {
  // A typo in the environment must not silently remove the only backstop that
  // makes FAIL_OPEN safe.
  for (const broken of ["", "abc", "0", "-5", "12.5", "1e3x"]) {
    process.env[GLOBAL_LIMIT_ENV] = broken;
    const { POST } = await freshRoute();
    // Prove a ceiling still exists by walking past the default with fresh IPs.
    for (let i = 1; i <= GLOBAL_LIMIT_DEFAULT; i++) {
      assert.equal(
        (await callFrom(POST, `10.${Math.floor(i / 250)}.${i % 250}.2`)).status,
        200,
        `${JSON.stringify(broken)}: provision ${i}`,
      );
    }
    assert.equal(
      (await callFrom(POST, "10.201.201.2")).status,
      429,
      `${JSON.stringify(broken)} must fall back to the default ceiling, not disable it`,
    );
  }
});

test("d: field-length caps still apply within the allowance (limiter did not replace validation)", async () => {
  const { POST } = await freshRoute();
  const ip = "203.0.113.77";
  const res = await callFrom(POST, ip, { ...DEFAULT_BODY, setup: { role: "x".repeat(201) } });
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /too long/);
});

test("d: no outbound network call is made by /api/begin at all", async () => {
  const { POST } = await freshRoute();
  await callFrom(POST, "203.0.113.200");
  assert.equal(netCalls.length, 0, "the mock onboarding path must not touch any payment provider");
});

// ── WhatsApp-first signup contract (decisions#340) ────────────────────────

test("p: a valid phone is NORMALISED to E.164 and persisted — the raw input is not stored", async () => {
  const { POST } = await freshRoute();
  const { getConnect } = await store();

  const res = await callFrom(POST, "203.0.113.1", { ...DEFAULT_BODY });
  assert.equal(res.status, 200, "a valid number must be accepted");

  const rec = await getConnect(res.body.token);
  assert.ok(rec, "the connect record must exist");
  assert.equal(rec.phone, RAW_PHONE_E164, "the stored number must be canonical E.164");
  assert.notEqual(rec.phone, RAW_PHONE, "the raw typed input must NOT be what is stored");
});

test("p: differently-typed forms of the SAME number converge on one stored identity", async () => {
  const { POST } = await freshRoute();
  const { getConnect } = await store();

  // Four ways a real person types one number. If normalisation were skipped,
  // these would become four different customers.
  const forms = ["050 123 4567", "+971 50 123 4567", "00971501234567", "(050)123-4567"];
  for (const form of forms) {
    const res = await callFrom(POST, "203.0.113.2", { ...DEFAULT_BODY, phone: form });
    assert.equal(res.status, 200, `"${form}" must be accepted`);
    const rec = await getConnect(res.body.token);
    assert.equal(rec.phone, RAW_PHONE_E164, `"${form}" must normalise to one identity`);
  }
});

test("p: an INVALID phone is a clear 400 and provisions nothing", async () => {
  const { POST } = await freshRoute();
  const { getConnect } = await store();

  for (const [raw, reason] of [["not a phone", "no-digits"], ["+1234567", "length"]]) {
    const res = await callFrom(POST, "203.0.113.3", { plan: "trial", phone: raw });
    assert.equal(res.status, 400, `"${raw}" must be refused, not silently accepted`);
    assert.equal(res.body.error, "invalid_phone");
    assert.equal(res.body.reason, reason, `"${raw}" must say WHY it was refused`);
    assert.ok(String(res.body.message).length > 0, "a refusal must carry human-readable text");
    assert.equal(res.body.token, undefined, "a refused call must not mint a token");
    assert.equal(res.body.pairUrl, undefined, "a refused call must not return a pairing link");
  }

  // And nothing at all was written for the refused calls: the only way to reach
  // a record is a token, and no token was ever handed out.
  assert.equal(await getConnect("no-such-token"), null);
});

test("p: a MISSING phone on the default (WhatsApp) channel is refused — signup captures the number", async () => {
  const { POST } = await freshRoute();

  for (const body of [{ plan: "trial" }, { plan: "trial", phone: "" }, { plan: "trial", phone: "   " }]) {
    const res = await callFrom(POST, "203.0.113.4", body);
    assert.equal(res.status, 400, `${JSON.stringify(body)} must be refused`);
    assert.equal(res.body.error, "invalid_phone");
    assert.equal(res.body.reason, "empty");
    assert.equal(res.body.token, undefined);
  }
});

test("p: the CHANNEL is persisted, and defaults to whatsapp when the client says nothing", async () => {
  const { POST } = await freshRoute();
  const { getConnect } = await store();

  const implicit = await callFrom(POST, "203.0.113.5", { ...DEFAULT_BODY });
  assert.equal(implicit.body.channel, "whatsapp", "an unspecified channel means WhatsApp");
  assert.equal((await getConnect(implicit.body.token)).channel, "whatsapp", "the channel must be stored");

  const explicit = await callFrom(POST, "203.0.113.5", { ...DEFAULT_BODY, channel: "whatsapp" });
  assert.equal((await getConnect(explicit.body.token)).channel, "whatsapp");
});

test("p: Telegram still works when asked for EXPLICITLY, and still returns its deep-link", async () => {
  // The old response shape is intact for the old channel — this is the
  // assertion that moved off the default-body test at the top of this file.
  const { POST } = await freshRoute();
  const { getConnect } = await store();

  const res = await callFrom(POST, "203.0.113.6", { plan: "trial", channel: "telegram" });
  assert.equal(res.status, 200, "Telegram must not require a phone — it pairs on a Telegram id");
  assert.match(res.body.botUrl, /^https:\/\/t\.me\//, "Telegram must still return a Telegram deep-link");
  assert.ok(res.body.botUrl.endsWith(`?start=${res.body.token}`), "the deep-link must carry the token");
  assert.equal(res.body.pairUrl, undefined, "a Telegram signup gets no WhatsApp pairing link");

  const rec = await getConnect(res.body.token);
  assert.equal(rec.channel, "telegram");
  assert.equal(rec.phone, undefined, "no number was given, so none is invented");
});

test("p: a phone supplied ALONGSIDE telegram is still normalised before it is stored", async () => {
  const { POST } = await freshRoute();
  const { getConnect } = await store();

  const ok = await callFrom(POST, "203.0.113.7", { plan: "trial", channel: "telegram", phone: RAW_PHONE });
  assert.equal((await getConnect(ok.body.token)).phone, RAW_PHONE_E164);

  const bad = await callFrom(POST, "203.0.113.7", { plan: "trial", channel: "telegram", phone: "zzz" });
  assert.equal(bad.status, 400, "a broken number is broken on every channel");
  assert.equal(bad.body.error, "invalid_phone");
});

test("p: an UNKNOWN channel is refused rather than silently coerced", async () => {
  const { POST } = await freshRoute();
  const res = await callFrom(POST, "203.0.113.8", { ...DEFAULT_BODY, channel: "sms" });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "invalid_channel");
  assert.equal(res.body.token, undefined);
});

test("p: with NO pairing base configured the route fails honestly — no broken link, no orphan record", async () => {
  // The public WhatsApp pairing surface is not open yet. The route must say so
  // rather than hand the customer a URL that goes nowhere.
  env({ MIRA_WHATSAPP_PAIR_BASE: undefined });
  const { POST } = await freshRoute();

  const res = await callFrom(POST, "203.0.113.9");
  assert.equal(res.status, 503, "an unconfigured pairing surface is a 503, not a 200");
  assert.equal(res.body.error, "whatsapp_unavailable");
  assert.equal(res.body.token, undefined, "nothing is provisioned that could never be paired");
  assert.equal(res.body.pairUrl, undefined);
  assert.ok(String(res.body.message).length > 0, "the customer is told plainly, not shown a broken link");
});

test("p: a pairing base that already carries query parameters is preserved, not clobbered", async () => {
  env({ MIRA_WHATSAPP_PAIR_BASE: "https://pair.example.test/wa/pair?v=2" });
  const { POST } = await freshRoute();

  const res = await callFrom(POST, "203.0.113.12");
  assert.equal(res.status, 200);
  assert.match(res.body.pairUrl, /[?&]v=2(&|$)/, "the base own parameters must survive");
  assert.match(res.body.pairUrl, new RegExp(`[?&]token=${res.body.token}(&|$)`));
});

test("p: a MALFORMED pairing base is treated as unconfigured, not shipped to the customer", async () => {
  env({ MIRA_WHATSAPP_PAIR_BASE: "not-a-url" });
  const { POST } = await freshRoute();

  const res = await callFrom(POST, "203.0.113.13");
  assert.equal(res.status, 503, "we will not hand out a link we cannot prove is a URL");
  assert.equal(res.body.error, "whatsapp_unavailable");
});

test("p: the WhatsApp path still makes NO outbound network call", async () => {
  // The same tripwire as the Telegram path: adding a channel must not have
  // added a call to any provider.
  const { POST } = await freshRoute();
  const res = await callFrom(POST, "203.0.113.14");
  assert.equal(res.status, 200);
  assert.equal(netCalls.length, 0, "provisioning a WhatsApp signup must not talk to anyone");
});

// ── /api/connect GET: the welcome page must be told the CHANNEL ───────────
// The post-checkout welcome page reads /api/connect, NOT /api/begin. If the
// channel and pairing link stop at /api/begin, every customer — including the
// WhatsApp-first ones — is shown the Telegram branch and handed a t.me link for
// a product we no longer sell there. These tests pin the whole hand-off.

const connectRoute = () => loadRoute("src/app/api/connect/route.ts");
const tokenLib = () => loadRoute("src/lib/connect-token.ts");

/** GET /api/connect?token=… against the real handler. */
const getConnectRoute = async (token) => {
  const { GET } = await connectRoute();
  return GET(new Request(`https://mira.vualet.com/api/connect?token=${encodeURIComponent(token)}`)).then(readJson);
};

test("c: a WhatsApp signup is still WhatsApp when the welcome page reads it back", async () => {
  const { POST } = await freshRoute();

  const begun = await callFrom(POST, "203.0.113.20", { ...DEFAULT_BODY });
  assert.equal(begun.status, 200);

  const res = await getConnectRoute(begun.body.token);
  assert.equal(res.status, 200);
  assert.equal(res.body.channel, "whatsapp", "the welcome page must be able to take the WhatsApp branch");
  assert.equal(res.body.botUrl, undefined, "a WhatsApp customer must NOT be handed a Telegram link");
  assert.equal(
    res.body.pairUrl,
    begun.body.pairUrl,
    "both routes must produce the SAME link — a reload cannot change where a customer pairs",
  );
  assert.ok(res.body.pairUrl.includes(`token=${begun.body.token}`), "the link must carry the token");
  // The rest of the record is unchanged — this is additive.
  assert.equal(res.body.plan, "trial");
  assert.equal(res.body.status, "pending");
});

test("c: a Telegram record still gets its deep-link, and now says so", async () => {
  const { POST } = await freshRoute();

  const begun = await callFrom(POST, "203.0.113.21", { plan: "trial", channel: "telegram" });
  const res = await getConnectRoute(begun.body.token);

  assert.equal(res.status, 200);
  assert.equal(res.body.channel, "telegram");
  assert.equal(res.body.botUrl, begun.body.botUrl, "botUrlFor must keep working, unchanged");
  assert.match(res.body.botUrl, /^https:\/\/t\.me\//);
  assert.equal(res.body.pairUrl, undefined, "a Telegram record gets no WhatsApp link");
});

test("c: a LEGACY record with no channel field reads back as Telegram, not WhatsApp", async () => {
  // Every record written before the channel field existed was a Telegram
  // signup. Guessing WhatsApp for them would strand real customers on a
  // channel they were never paired on.
  const { putConnect } = await store();
  const { mintConnectToken } = await tokenLib();

  const token = mintConnectToken();
  await putConnect({
    token,
    plan: "companion",
    status: "bound",
    createdAt: new Date().toISOString(),
    // deliberately NO channel and NO phone — this is what old rows look like
  });

  const res = await getConnectRoute(token);
  assert.equal(res.status, 200);
  assert.equal(res.body.channel, "telegram", "an absent channel means the legacy channel");
  assert.match(res.body.botUrl, /^https:\/\/t\.me\//, "the old link must keep working");
  assert.equal(res.body.pairUrl, undefined);
  assert.equal(res.body.plan, "companion", "the rest of an old record is untouched");
});

test("c: with no pairing base configured the welcome page gets the record and NO link", async () => {
  // Provision while the surface is configured, then read it back after it is
  // gone. A read of something already provisioned must not 503 — that would
  // blank the customer's plan and status as well. The page's own "unusable"
  // state renders no call-to-action for a 2xx with no link, so silence here
  // degrades correctly; a guessed link would be a dead end.
  const { POST } = await freshRoute();
  const begun = await callFrom(POST, "203.0.113.22", { ...DEFAULT_BODY });
  assert.equal(begun.status, 200);

  env({ MIRA_WHATSAPP_PAIR_BASE: undefined });
  const res = await getConnectRoute(begun.body.token);

  assert.equal(res.status, 200, "a read of an existing record must not fail");
  assert.equal(res.body.channel, "whatsapp", "the channel is a fact about the record, not about config");
  assert.equal(res.body.pairUrl, null, "no link is offered rather than a broken one");
  assert.equal(res.body.botUrl, undefined, "and it must NOT fall back to Telegram");
  assert.equal(res.body.plan, "trial", "the customer can still see their plan");
  assert.equal(res.body.status, "pending");
});

test("c: the token guards on GET are untouched by the channel work", async () => {
  const { GET } = await connectRoute();
  const missing = await GET(new Request("https://mira.vualet.com/api/connect")).then(readJson);
  assert.equal(missing.status, 400);

  const forged = await getConnectRoute("not-a-real-token");
  assert.equal(forged.status, 403, "an unsigned token must still be refused");

  const { mintConnectToken } = await tokenLib();
  const unknown = await getConnectRoute(mintConnectToken());
  assert.equal(unknown.status, 404, "a well-signed token with no record is still 404");
});

// ── Gate C1 consent (specs#160) ───────────────────────────────────────────
// /api/begin used to ACCEPT `consent` and throw it away, so a trial customer
// could end up with a bound WhatsApp number and no server-side proof they were
// ever shown the ban-risk notice. A gate enforced only in a browser is a gate
// anyone can walk around, so these tests drive the server directly.

const consentLib = () => loadRoute("src/lib/consent.ts");

/** A consent object with only the named required scopes ticked. */
const consentWith = (...scopes) => {
  const c = {
    unofficialAutomation: false,
    banRisk: false,
    ownAccountReplies: false,
    observationNumber: false,
  };
  for (const s of scopes) c[s] = true;
  return c;
};

test("g: consent is PERSISTED, stamped with the disclosure revision and a timestamp", async () => {
  const { POST } = await freshRoute();
  const { getConnect } = await store();

  const before = Date.now();
  const res = await callFrom(POST, "203.0.113.30");
  assert.equal(res.status, 200);

  const rec = await getConnect(res.body.token);
  assert.ok(rec.consent, "the proof of disclosure must be ON the record, not only in the browser");
  assert.equal(rec.consent.unofficialAutomation, true);
  assert.equal(rec.consent.banRisk, true);
  assert.equal(rec.consent.ownAccountReplies, true);
  assert.equal(rec.consent.observationNumber, false, "an opt-IN extra must not be flipped on for them");
  assert.equal(rec.consent.disclosure, "specs#160r2", "we must know WHICH copy they agreed to");
  const at = Date.parse(rec.consent.acceptedAt);
  assert.ok(Number.isFinite(at), "acceptedAt must be a real timestamp");
  assert.ok(at >= before - 1000 && at <= Date.now() + 1000, "and must be when it actually happened");
});

test("g: an opted-IN observation number is recorded as true", async () => {
  const { POST } = await freshRoute();
  const { getConnect } = await store();

  const res = await callFrom(POST, "203.0.113.31", {
    ...DEFAULT_BODY,
    consent: { ...FULL_CONSENT, observationNumber: true },
  });
  assert.equal(res.status, 200);
  assert.equal((await getConnect(res.body.token)).consent.observationNumber, true);
});

test("g: NO consent at all is refused, and names every scope that is missing", async () => {
  const { POST } = await freshRoute();

  const cases = [undefined, null, "yes", 42, [], "{}"];
  for (let i = 0; i < cases.length; i++) {
    const missingConsent = cases[i];
    const body = { plan: "trial", phone: RAW_PHONE };
    if (missingConsent !== undefined) body.consent = missingConsent;

    // A fresh IP per case: six calls from one IP would trip the rate limiter and
    // turn a consent assertion into a 429, testing the wrong thing.
    const res = await callFrom(POST, `203.0.113.${40 + i}`, body);
    assert.equal(res.status, 400, `consent=${JSON.stringify(missingConsent)} must be refused`);
    assert.equal(res.body.error, "consent_required");
    assert.deepEqual(
      [...res.body.missing].sort(),
      ["banRisk"],
      "the one required scope must be reported missing",
    );
    assert.ok(String(res.body.message).length > 0, "the customer must be told what to do");
    assert.equal(res.body.token, undefined, "nothing may be provisioned without consent");
    assert.equal(res.body.pairUrl, undefined);
  }
});

test("g: an INCOMPLETE form is refused and names exactly the box that is not ticked", async () => {
  const { POST } = await freshRoute();

  // specs#160r2: only `banRisk` is required, so "incomplete" now means exactly
  // one thing — that box unticked. The demoted scopes are listed here ticked on
  // their own precisely to prove they can NEVER stand in for it.
  const cases = [
    [consentWith(), ["banRisk"]],
    [consentWith("unofficialAutomation"), ["banRisk"]],
    [consentWith("ownAccountReplies"), ["banRisk"]],
    [consentWith("unofficialAutomation", "ownAccountReplies"), ["banRisk"]],
    [consentWith("observationNumber"), ["banRisk"]],
  ];

  for (const [consent, expected] of cases) {
    const res = await callFrom(POST, "203.0.113.33", { ...DEFAULT_BODY, consent });
    assert.equal(res.status, 400, `${JSON.stringify(expected)} unticked must be refused`);
    assert.equal(res.body.error, "consent_required");
    assert.deepEqual([...res.body.missing].sort(), [...expected].sort());
    assert.equal(res.body.token, undefined);
  }
});

test("g: TRUTHY is not TRUE — agreement to a ban risk must be unambiguous", async () => {
  // A client bug that sends "yes", 1 or "true" must not be read as a person
  // having understood and accepted that their number can be banned.
  const { POST } = await freshRoute();

  for (const truthy of ["true", "yes", 1, "on", {}]) {
    const res = await callFrom(POST, "203.0.113.34", {
      ...DEFAULT_BODY,
      consent: { ...FULL_CONSENT, banRisk: truthy },
    });
    assert.equal(res.status, 400, `banRisk=${JSON.stringify(truthy)} must not count as consent`);
    assert.equal(res.body.error, "consent_required");
    assert.deepEqual(res.body.missing, ["banRisk"]);
  }
});

test("g: a non-boolean optional scope is consent_invalid, not silently coerced either way", async () => {
  const { POST } = await freshRoute();

  const res = await callFrom(POST, "203.0.113.35", {
    ...DEFAULT_BODY,
    consent: { ...FULL_CONSENT, observationNumber: "maybe" },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "consent_invalid");
  assert.deepEqual(res.body.missing, []);
  assert.equal(res.body.token, undefined);

  // null and absent are both "not added" — those are fine, not errors.
  for (const ok of [null, undefined]) {
    const consent = { ...FULL_CONSENT, observationNumber: ok };
    if (ok === undefined) delete consent.observationNumber;
    const good = await callFrom(POST, "203.0.113.35", { ...DEFAULT_BODY, consent });
    assert.equal(good.status, 200, `observationNumber=${ok} must be treated as "not added"`);
  }
});

test("g: Telegram neither requires nor records WhatsApp consent", async () => {
  // specs#160 is a WhatsApp disclosure. Demanding it from a Telegram customer
  // would be theatre, and storing a WhatsApp consent against a Telegram record
  // would be a false record.
  const { POST } = await freshRoute();
  const { getConnect } = await store();

  const res = await callFrom(POST, "203.0.113.36", { plan: "trial", channel: "telegram" });
  assert.equal(res.status, 200, "a Telegram signup must not be blocked by a WhatsApp gate");

  const rec = await getConnect(res.body.token);
  assert.equal(rec.consent, undefined, "no WhatsApp consent may be invented for a Telegram record");
});

test("g: consent is checked BEFORE the pairing surface — a customer bug outranks our config gap", async () => {
  // With the surface unconfigured, a complete request 503s. An INCOMPLETE one
  // must still hear about its own missing boxes rather than be told to come
  // back later — and either way nothing is provisioned.
  env({ MIRA_WHATSAPP_PAIR_BASE: undefined });
  const { POST } = await freshRoute();

  const complete = await callFrom(POST, "203.0.113.37");
  assert.equal(complete.status, 503, "a complete request hits the config gap");

  const incomplete = await callFrom(POST, "203.0.113.37", {
    ...DEFAULT_BODY,
    consent: consentWith("unofficialAutomation", "ownAccountReplies"),
  });
  assert.equal(incomplete.status, 400, "an incomplete form is told about ITSELF");
  assert.equal(incomplete.body.error, "consent_required");
});

test("g: ONE rule — the browser predicate and the server validator cannot disagree", async () => {
  // The whole point of @/lib/consent. Every combination of the required
  // boxes: whatever whatsAppConsentComplete lets the wizard submit is exactly
  // what readConsent accepts. If someone adds a required scope to one and not
  // the other, this goes red.
  const { readConsent, whatsAppConsentComplete, REQUIRED_CONSENT_SCOPES, EMPTY_WHATSAPP_CONSENT } =
    await consentLib();

  assert.deepEqual(
    [...REQUIRED_CONSENT_SCOPES].sort(),
    ["banRisk"],
    "specs#160r2: one merged required scope, stating unofficial automation AND the ban risk",
  );
  assert.equal(whatsAppConsentComplete(EMPTY_WHATSAPP_CONSENT), false, "nothing is pre-agreed");

  for (let mask = 0; mask < 1 << REQUIRED_CONSENT_SCOPES.length; mask++) {
    const form = { ...EMPTY_WHATSAPP_CONSENT };
    REQUIRED_CONSENT_SCOPES.forEach((scope, i) => {
      form[scope] = Boolean(mask & (1 << i));
    });
    assert.equal(
      whatsAppConsentComplete(form),
      readConsent(form).ok,
      `browser and server disagree about ${JSON.stringify(form)}`,
    );
  }
});

test("g: the shared predicate already matches the disclosure component it will replace", async () => {
  // Writer C's component is not edited here, but the module it is about to
  // import must already agree with it, or handing over the import would be a
  // silent behaviour change.
  const { whatsAppConsentComplete } = await consentLib();
  assert.equal(whatsAppConsentComplete(FULL_CONSENT), true, "a legacy three-box form is still enough");
  assert.equal(whatsAppConsentComplete(consentWith("banRisk")), true, "the one merged box is enough");
  assert.equal(
    whatsAppConsentComplete({ ...FULL_CONSENT, observationNumber: true }),
    true,
    "the optional scope changes nothing about completeness",
  );
  // The DEMOTED scopes are prose now. Ticking them cannot substitute for the box.
  assert.equal(whatsAppConsentComplete(consentWith("unofficialAutomation", "ownAccountReplies")), false);
});

// ── COUNTERFACTUAL: prove the new tests can tell fixed from broken ────────
// Standing project rule (ledger gotchas #138/#139): a test that would still
// pass with the fix removed proves nothing. This file's own history is the
// argument for that rule — it shipped a test that asserted the vulnerability.
//
// So the "s:", "f:", "m:" and "G:" assertions above are re-run here against
// `git show HEAD:src/app/api/begin/route.ts`, the route as it stands before
// this change, and every one of them is REQUIRED to fail. The old revision is
// extracted into a temp directory at run time; nothing under src/ is touched,
// and the suite is reproducible on any clone.

const OLD_REV = "f889ee5"; // PINNED, not "HEAD": once the fix is committed HEAD IS the fix,
                      // and every pre-fix assertion silently starts testing the fix.
let OLD_BEGIN = null;
let OLD_SRC = "";

before(() => {
  OLD_SRC = execFileSync("git", ["show", `${OLD_REV}:src/app/api/begin/route.ts`], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const dir = mkdtempSync(path.join(tmpdir(), "mira-begin-counterfactual-"));
  OLD_BEGIN = path.join(dir, "begin-old.ts");
  writeFileSync(OLD_BEGIN, OLD_SRC);
});

/** A fresh instance of the OLD, unfixed route. */
const oldRoute = () => loadRoute(OLD_BEGIN, { fresh: true });

/**
 * Require that `fn` — an assertion copied from the real tests above — FAILS
 * when pointed at code without the fix. Anything else means the test cannot
 * tell the fixed code from the broken code and is decoration.
 */
async function mustFail(what, fn) {
  let caught = null;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(
    caught,
    `COUNTERFACTUAL BROKEN — "${what}" PASSED against code without the fix. ` +
      `That test does not actually detect the fix and must be strengthened.`,
  );
  assert.ok(
    caught instanceof assert.AssertionError,
    `expected an assertion failure for "${what}", got: ${caught?.message}`,
  );
  return caught;
}

test("CF-0: the counterfactual base really is the defective code", async () => {
  // Anchors everything below. If this ever stops matching, HEAD has moved past
  // the defect and the base must be re-pointed at a revision that still has it.
  assert.match(
    OLD_SRC,
    /x-forwarded-for/,
    "the base must be the revision that keyed the limiter on x-forwarded-for",
  );
  assert.match(OLD_SRC, /\.split\(","\)/, "…by splitting the header on commas");
  assert.match(OLD_SRC, /\|\|\s*"unknown"/, "…and falling back to a single constant bucket");
  assert.doesNotMatch(OLD_SRC, /x-real-ip/, "the base must not already read the trusted header");
  assert.doesNotMatch(
    OLD_SRC,
    /MIRA_BEGIN_GLOBAL_LIMIT/,
    "and it must have no global per-endpoint ceiling of any kind",
  );
});

test("CF-1: the DEFECT — a spoofed x-forwarded-for bypasses the OLD limiter entirely", async () => {
  // The centrepiece. Same real client, a different forged x-forwarded-for each
  // time. Against the old route the limiter never fires, no matter how many
  // times you call it: the caller is choosing their own bucket key.
  const { POST } = await oldRoute();
  const realClient = "203.0.113.50";

  for (let i = 1; i <= 30; i++) {
    const res = await callWith(POST, {
      "x-real-ip": realClient,
      "x-forwarded-for": `10.0.0.${i}, 172.16.0.${i}`,
    });
    assert.equal(res.status, 200, `old route: spoofed call ${i} sailed through`);
    assert.ok(res.body.token, "…and provisioned a real tenant every single time");
  }

  // And the exact assertion from the "s:" test above goes red against it.
  const sixth = await callWith(POST, {
    "x-real-ip": realClient,
    "x-forwarded-for": "198.51.100.77, 172.16.0.99",
  });
  await mustFail("a forged x-forwarded-for must NOT mint a new bucket", () => {
    assert.equal(sixth.status, 429);
    assert.equal(sixth.body.error, "rate_limited");
  });
  assert.equal(sixth.status, 200, "the old route provisioned yet another tenant");
});

test("CF-2: the DELETED test asserted the vulnerability — it PASSES on the old code", async () => {
  // The removed test, verbatim in behaviour:
  //   "x-forwarded-for chains use the FIRST (client) hop as the bucket key"
  // It passes against the defective route, which is the whole indictment: a
  // green suite was pinning an attacker-chosen bucket key in place as a
  // requirement. Deleting it was not enough, so this records what it did.
  const deletedTestAssertions = async (POST) => {
    const client = "203.0.113.50";
    const chains = [
      `${client}`,
      `${client}, 10.1.1.1`,
      `${client}, 10.2.2.2, 10.3.3.3`,
      `  ${client}  , 10.4.4.4`,
    ];
    for (let i = 0; i < chains.length; i++) {
      const res = await callWith(POST, { "x-forwarded-for": chains[i] });
      assert.equal(res.status, 200, `chain ${i + 1} must count toward the same allowance`);
    }
    assert.equal((await callWith(POST, { "x-forwarded-for": `${client}, 10.9.9.9` })).status, 200);
    assert.equal(
      (await callWith(POST, { "x-forwarded-for": client })).status,
      429,
      "all chain forms share one bucket",
    );
  };

  const { POST: OLD_POST } = await oldRoute();
  await deletedTestAssertions(OLD_POST); // green against the vulnerable route

  // And it is RED against the fixed route, which is why it had to go rather
  // than be kept "for coverage": its claim is now false, by design.
  const { POST } = await freshRoute();
  await mustFail("the deleted test's claim, against the FIXED route", () =>
    deletedTestAssertions(POST),
  );
});

test("CF-3: the OLD route keys on NOTHING trustworthy — x-real-ip is ignored outright", async () => {
  const { POST } = await oldRoute();
  // Against the fix, 12 calls from one address are refused after 5. Against the
  // old route the header is not read at all, so all 12 land in "unknown".
  await mustFail("x-real-ip is the bucket key", async () => {
    for (let i = 0; i < LIMIT; i++) {
      assert.equal((await callFrom(POST, "203.0.113.121")).status, 200);
    }
    // The old route has already spent the shared "unknown" allowance on those
    // five, so a DIFFERENT address is refused — which is exactly the bug.
    assert.equal(
      (await callFrom(POST, "203.0.113.122")).status,
      200,
      "a different client must have its own allowance",
    );
  });
});

test("CF-4: FAIL_OPEN is new — the old route refused the 6th headerless call", async () => {
  // The removed `|| "unknown"` constant bucket, demonstrated: it is a global
  // signup outage one missing header away, and it was already shipped.
  const { POST } = await oldRoute();
  for (let i = 1; i <= LIMIT; i++) {
    assert.equal((await callWith(POST, {})).status, 200, `old route call ${i}`);
  }
  assert.equal(
    (await callWith(POST, {})).status,
    429,
    "the old route put every headerless caller in ONE shared 5-per-hour bucket",
  );

  // So the "f:" assertion above cannot pass against it.
  await mustFail("no client address means no per-client limiting", async () => {
    const { POST: P } = await oldRoute();
    for (let i = 1; i <= 20; i++) {
      assert.equal((await callWith(P, {})).status, 200, `call ${i}`);
    }
  });
});

test("CF-5: the comma-bearing x-real-ip assertion fails against the old route", async () => {
  const { POST } = await oldRoute();
  await mustFail("a comma-bearing x-real-ip is never a key", async () => {
    const client = "203.0.113.52";
    for (let i = 0; i < LIMIT; i++) await callFrom(POST, client);
    assert.equal(
      (await callFrom(POST, `${client}, 10.9.9.9`)).status,
      200,
      "the route must not split the value and reuse the first hop",
    );
  });
});

test("CF-6: the IPv4 /32 and IPv6 /64 masking assertions fail against the old route", async () => {
  await mustFail("IPv4 is keyed at /32 — the neighbour is untouched", async () => {
    const { POST } = await oldRoute();
    for (let i = 0; i < LIMIT; i++) await callFrom(POST, "203.0.113.70");
    assert.equal((await callFrom(POST, "203.0.113.71")).status, 200);
  });

  await mustFail("a different /64 keeps its own allowance", async () => {
    const { POST } = await oldRoute();
    for (const a of ["2001:db8:1:2::1", "2001:db8:1:2::2", "2001:db8:1:2::3", "2001:db8:1:2::4", "2001:db8:1:2::5"]) {
      await callFrom(POST, a);
    }
    assert.equal((await callFrom(POST, "2001:db8:1:3::1")).status, 200);
  });

  await mustFail("one /64 is ONE bucket", async () => {
    const { POST } = await oldRoute();
    // Six addresses in one /64 must exhaust one allowance. The old route puts
    // them all in "unknown" — which happens to also trip at 6 — so the tell is
    // that the old route ALSO refuses an address in an unrelated /64.
    for (const a of ["2001:db8:9:9::1", "2001:db8:9:9::2", "2001:db8:9:9::3", "2001:db8:9:9::4", "2001:db8:9:9::5"]) {
      await callFrom(POST, a);
    }
    assert.equal((await callFrom(POST, "2001:db8:9:9::6")).status, 429);
    assert.equal((await callFrom(POST, "2001:db8:aa:aa::1")).status, 200, "an unrelated /64");
  });

  // The two convergence tests ("every spelling is one bucket", "the mapped form
  // is the same customer") would ALSO pass against one global constant bucket,
  // so each carries a discriminating tail. These prove the tails are the part
  // doing the work.
  await mustFail("a different address is not swept into the same bucket", async () => {
    const { POST } = await oldRoute();
    for (const s of [
      "2001:db8:0:0:0:0:0:1",
      "2001:db8::1",
      "2001:0db8:0000:0000:0000:0000:0000:0001",
      "[2001:DB8::1]",
      "2001:db8::0.0.0.1",
    ]) {
      await callFrom(POST, s);
    }
    assert.equal((await callFrom(POST, "2001:db8:2::1")).status, 200);
  });

  await mustFail("the mapped form of a DIFFERENT address is a different customer", async () => {
    const { POST } = await oldRoute();
    for (let i = 0; i < LIMIT; i++) await callFrom(POST, "203.0.113.80");
    assert.equal((await callFrom(POST, "::ffff:203.0.113.81")).status, 200);
  });
});

test("CF-7: the GLOBAL ceiling did not exist — the old route has no cap of any kind", async () => {
  // The judge's ruling assumed a "pre-existing global per-endpoint ceiling".
  // There was none, which is why building it was a prerequisite for FAIL_OPEN
  // rather than a nice-to-have: without it, failing open means no limiting.
  process.env[GLOBAL_LIMIT_ENV] = "4";
  const { POST } = await oldRoute();

  await mustFail("the ceiling refuses the 5th provision", async () => {
    for (let i = 1; i <= 4; i++) {
      assert.equal((await callWith(POST, { "x-forwarded-for": `10.5.5.${i}` })).status, 200);
    }
    assert.equal((await callWith(POST, { "x-forwarded-for": "10.5.5.99" })).status, 429);
  });

  // Positively: 200 provisions from 200 fresh (spoofable) addresses, all fine.
  const { POST: P } = await oldRoute();
  for (let i = 1; i <= 200; i++) {
    const res = await callWith(P, { "x-forwarded-for": `10.6.${Math.floor(i / 250)}.${i % 250}` });
    assert.equal(res.status, 200, `old route provision ${i} — an open faucet with no ceiling`);
  }
});

test("CF-8: the global ceiling is IP-independent — the old route's is not, because it has none", async () => {
  process.env[GLOBAL_LIMIT_ENV] = "3";
  const { POST } = await oldRoute();
  await mustFail("a brand-new address must still hit the global ceiling", async () => {
    for (let i = 1; i <= 3; i++) {
      assert.equal((await callFrom(POST, `198.51.100.${i}`)).status, 200);
    }
    assert.equal((await callFrom(POST, "198.51.100.4")).status, 429);
  });
});


// ── THE EDGE-ADDRESS GUARD ────────────────────────────────────────────────
// The hazard the previous round of this work flagged but did NOT cover.
//
// Fail-open only fires when x-real-ip is ABSENT. The likely bad state is the
// header being PRESENT AND WRONG: nginx emitting $remote_addr because
// real_ip_header CF-Connecting-IP is not configured, which behind Cloudflare
// is a CLOUDFLARE EDGE IP. That value parses and masks cleanly and produces a
// confident key, so the route logged nothing, degraded nothing and looked
// healthy while funnelling every visitor on earth into ~12 shared buckets of
// 5/hour — gotchas#252's collapse, arriving through config drift instead of
// through an attacker, and with no log line to find it by.
//
// The rule that fixes it is self-verifying: an x-real-ip inside a Cloudflare
// range is PROOF that real_ip is not configured, because a correctly
// configured nginx would have replaced it with the true client address and no
// genuine end user is ever a Cloudflare edge IP. So it is treated exactly like
// an absent header — untrusted, null key, fail open, loud log.

/**
 * Cloudflare's published ranges, and an address that really sits inside each.
 *
 * This is a DELIBERATE SECOND COPY of the list in the route, and that is the
 * anti-drift mechanism: if the route's list loses a range, the matching case
 * here goes red. It cannot catch the opposite drift — if Cloudflare ADDS a
 * range and neither copy learns about it, both stay quiet — which is exactly
 * the staleness failure mode documented in the route.
 */
const CLOUDFLARE_INSIDE = [
  ["173.245.48.0/20", "173.245.48.1"],
  ["103.21.244.0/22", "103.21.244.1"],
  ["103.22.200.0/22", "103.22.200.1"],
  ["103.31.4.0/22", "103.31.4.1"],
  ["141.101.64.0/18", "141.101.64.1"],
  ["108.162.192.0/18", "108.162.200.1"],
  ["190.93.240.0/20", "190.93.240.1"],
  ["188.114.96.0/20", "188.114.96.1"],
  ["197.234.240.0/22", "197.234.240.1"],
  ["198.41.128.0/17", "198.41.140.1"],
  ["162.158.0.0/15", "162.158.1.1"],
  ["104.16.0.0/13", "104.16.0.1"],
  ["104.24.0.0/14", "104.24.0.1"],
  ["172.64.0.0/13", "172.64.0.1"],
  ["131.0.72.0/22", "131.0.72.1"],
  ["2400:cb00::/32", "2400:cb00::1"],
  ["2606:4700::/32", "2606:4700::1111"],
  ["2803:f800::/32", "2803:f800::1"],
  ["2405:b500::/32", "2405:b500::1"],
  ["2405:8100::/32", "2405:8100::1"],
  ["2a06:98c0::/29", "2a06:98c7::1"],
  ["2c0f:f248::/32", "2c0f:f248::1"],
];

/** Real customer addresses that sit JUST OUTSIDE a Cloudflare range. */
const JUST_OUTSIDE = [
  "173.245.64.1", // 173.245.48.0/20 ends at 173.245.63.255
  "103.21.248.1", // 103.21.244.0/22 ends at 103.21.247.255
  "104.28.0.1", // 104.24.0.0/14 ends at 104.27.255.255
  "162.160.0.1", // 162.158.0.0/15 ends at 162.159.255.255
  "172.72.0.1", // 172.64.0.0/13 ends at 172.71.255.255
  "198.41.127.1", // 198.41.128.0/17 starts at 198.41.128.0
  "2400:cb01::1", // 2400:cb00::/32 is only 2400:cb00:*
  "2a06:98c8::1", // 2a06:98c0::/29 ends at 2a06:98c7:*
  "2a06:98bf::1", // …and starts at 2a06:98c0:*
];

test("e: a CLOUDFLARE edge address in x-real-ip does NOT consume a per-client bucket", async () => {
  // THE CENTREPIECE. 104.16.0.1 is a genuine Cloudflare address. If the route
  // trusted it, these 20 calls would look like one client and the 6th would be
  // 429 — the silent global outage. It must fail OPEN instead.
  const { POST } = await freshRoute();
  for (let i = 1; i <= 20; i++) {
    const res = await callFrom(POST, "104.16.0.1");
    assert.equal(
      res.status,
      200,
      `call ${i}: a Cloudflare edge address must never become a rate-limit bucket`,
    );
    assert.ok(res.body.token, `call ${i} must still provision normally — this is fail-OPEN`);
  }
});

test("e: EVERY vendored Cloudflare range is recognised, IPv6 included", async () => {
  // A v4-only guard would be a half guard: the direct-to-origin exposure is on
  // both families, and every IPv6 visitor would still get the silent collapse.
  for (const [cidr, inside] of CLOUDFLARE_INSIDE) {
    const { POST } = await freshRoute();
    for (let i = 1; i <= LIMIT + 3; i++) {
      assert.equal(
        (await callFrom(POST, inside)).status,
        200,
        `${inside} is inside ${cidr} and must be treated as untrusted (call ${i})`,
      );
    }
  }
});

test("e: a Cloudflare address cannot sneak past the guard in IPv4-MAPPED form", async () => {
  // ::ffff:104.16.0.1 is the same address. If the guard ran after masking, or
  // only on bare IPv4, a dual-stack listener would hand it straight through.
  const { POST } = await freshRoute();
  for (const spelling of ["::ffff:104.16.0.1", "::ffff:172.64.0.1", "[::ffff:162.158.1.1]"]) {
    for (let i = 1; i <= LIMIT + 2; i++) {
      assert.equal(
        (await callFrom(POST, spelling)).status,
        200,
        `${spelling} must be recognised as a Cloudflare address (call ${i})`,
      );
    }
  }
});

test("e: an edge-address flood neither limits itself nor poisons a real client", async () => {
  // Many unrelated visitors arrive through ONE Cloudflare edge, so the flood
  // uses one repeated address — that is what the real bad state looks like.
  const { POST } = await freshRoute();
  const real = "203.0.113.140";

  for (let i = 1; i <= 15; i++) {
    assert.equal(
      (await callFrom(POST, "104.16.0.1")).status,
      200,
      `edge call ${i}: unrelated visitors behind one edge must not share a bucket`,
    );
  }
  for (let i = 1; i <= LIMIT; i++) {
    assert.equal((await callFrom(POST, real)).status, 200, `real client call ${i}`);
  }
  assert.equal((await callFrom(POST, real)).status, 429, "and the real client still ends at 5");
});

test("e: the guard is NOT over-broad — an address just outside a range is a normal customer", async () => {
  // The opposite failure, and the reason this test exists separately: a guard
  // that swept real customers into fail-open would quietly disable rate
  // limiting for whole neighbourhoods. Each of these keeps its own bucket.
  for (const addr of JUST_OUTSIDE) {
    const { POST } = await freshRoute();
    for (let i = 1; i <= LIMIT; i++) {
      assert.equal(
        (await callFrom(POST, addr)).status,
        200,
        `${addr} is a real customer: call ${i} must be inside its own allowance`,
      );
    }
    assert.equal(
      (await callFrom(POST, addr)).status,
      429,
      `${addr} is NOT a Cloudflare address and must still be limited at ${LIMIT}`,
    );
  }
});

test("e: the guard does NOT weaken the ceiling — gate 2 still holds edge-address traffic", async () => {
  // Fail-open is only safe because the ceiling is underneath it. This proves
  // the new path lands on the same backstop as the absent-header one.
  process.env[GLOBAL_LIMIT_ENV] = "4";
  const { POST } = await freshRoute();

  for (let i = 1; i <= 4; i++) {
    assert.equal((await callFrom(POST, "104.16.0.1")).status, 200, `provision ${i}`);
  }
  const over = await callFrom(POST, "104.16.0.1");
  assert.equal(over.status, 429, "the global ceiling must still refuse the 5th provision");
  assert.equal(over.body.error, "rate_limited");
  assert.equal(over.body.token, undefined);
});

test("e: the absent-header path is UNCHANGED by the guard", async () => {
  // Explicitly re-pinned: adding the edge-address case must not have altered
  // how a missing header behaves.
  const { POST } = await freshRoute();
  for (let i = 1; i <= 20; i++) {
    assert.equal((await callWith(POST, {})).status, 200, `absent-header call ${i}`);
  }
});

// ── COUNTERFACTUALS for the guard: the fix REMOVED, not an older commit ───
// HEAD predates the whole limiter rewrite, so failing against HEAD proves
// little about THIS condition. The honest base is the CURRENT route with only
// the guard taken out — the vendored range list emptied, nothing else touched.
// A second mutant makes the guard maximally OVER-BROAD, which is the failure
// the "not over-broad" test exists to catch and which an empty list cannot
// produce. Both mutations are applied to temp copies; src/ is never written to.
//
// Honest note on coverage: not every "e:" assertion can fail against every
// base, and pretending otherwise would be the same sin as the test this whole
// task deleted. Each is matched below to the base that actually discriminates
// it — guard-removed, guard-over-broad, or HEAD.

const RANGES_RE = /const CLOUDFLARE_RANGES: readonly string\[\] = \[[\s\S]*?\n\];/;

/**
 * Build the mutants LAZILY, on first use, rather than in a before() hook.
 *
 * A before() hook here would read the live route file for every test in this
 * file, so anything that upset the mutation — including someone temporarily
 * swapping the route out to run an experiment — would take down all 74 tests
 * and produce a meaningless all-red result that looks like evidence. A broken
 * counterfactual must fail the counterfactual tests and nothing else.
 */
let MUTANTS = null;

function mutants() {
  if (MUTANTS) return MUTANTS;
  const current = readFileSync(path.join(ROOT, "src/app/api/begin/route.ts"), "utf8");
  const dir = mkdtempSync(path.join(tmpdir(), "mira-begin-guard-mutants-"));

  const mutate = (name, replacement) => {
    const mutated = current.replace(RANGES_RE, replacement);
    if (mutated === current) {
      throw new Error(
        `COUNTERFACTUAL BROKEN — could not find CLOUDFLARE_RANGES to build the "${name}" mutant. ` +
          "The mutation must actually apply, or these tests would be checking the FIXED code " +
          "against itself and would prove nothing.",
      );
    }
    const dest = path.join(dir, `begin-${name}.ts`);
    writeFileSync(dest, mutated);
    return dest;
  };

  MUTANTS = {
    guardless: mutate("guardless", "const CLOUDFLARE_RANGES: readonly string[] = [];"),
    overbroad: mutate(
      "overbroad",
      'const CLOUDFLARE_RANGES: readonly string[] = ["0.0.0.0/0", "::/0"];',
    ),
  };
  return MUTANTS;
}

/** The current route with ONLY the edge-address guard removed. */
const guardlessRoute = () => loadRoute(mutants().guardless, { fresh: true });
/** The current route with the guard widened to swallow every address. */
const overbroadRoute = () => loadRoute(mutants().overbroad, { fresh: true });

test("CF-9: with the guard removed, a Cloudflare address IS trusted — the silent collapse", async () => {
  // The exact damage, demonstrated: without the guard the route confidently
  // keys on the edge IP, so the 6th visitor arriving through that edge is
  // refused. Every user on earth, ~12 buckets, and no log line to find it by.
  const { POST } = await guardlessRoute();
  for (let i = 1; i <= LIMIT; i++) {
    assert.equal((await callFrom(POST, "104.16.0.1")).status, 200, `call ${i}`);
  }
  assert.equal(
    (await callFrom(POST, "104.16.0.1")).status,
    429,
    "without the guard, unrelated visitors behind one Cloudflare edge share ONE bucket",
  );

  await mustFail("a Cloudflare edge address must never become a rate-limit bucket", async () => {
    const { POST: P } = await guardlessRoute();
    for (let i = 1; i <= 20; i++) {
      assert.equal((await callFrom(P, "104.16.0.1")).status, 200, `call ${i}`);
    }
  });
});

test("CF-10: the range-coverage and mapped-form assertions fail with the guard removed", async () => {
  await mustFail("every vendored range is recognised", async () => {
    for (const [cidr, inside] of CLOUDFLARE_INSIDE) {
      const { POST } = await guardlessRoute();
      for (let i = 1; i <= LIMIT + 3; i++) {
        assert.equal((await callFrom(POST, inside)).status, 200, `${inside} inside ${cidr}`);
      }
    }
  });

  await mustFail("a Cloudflare address cannot sneak past in IPv4-mapped form", async () => {
    const { POST } = await guardlessRoute();
    for (let i = 1; i <= LIMIT + 2; i++) {
      assert.equal((await callFrom(POST, "::ffff:104.16.0.1")).status, 200, `call ${i}`);
    }
  });

  await mustFail("an edge-address flood does not limit itself", async () => {
    const { POST } = await guardlessRoute();
    for (let i = 1; i <= 15; i++) {
      assert.equal((await callFrom(POST, "104.16.0.1")).status, 200, `edge call ${i}`);
    }
  });
});

test("CF-11: EVERY vendored range is load-bearing — emptying the list breaks each one", async () => {
  // Per-range, not in aggregate: a typo in any single CIDR must go red rather
  // than hide behind the other twenty-one still working.
  for (const [cidr, inside] of CLOUDFLARE_INSIDE) {
    await mustFail(`${cidr} is recognised as Cloudflare`, async () => {
      const { POST } = await guardlessRoute();
      for (let i = 1; i <= LIMIT + 1; i++) {
        assert.equal((await callFrom(POST, inside)).status, 200, `${inside} call ${i}`);
      }
    });
  }
});

test("CF-12: the 'not over-broad' assertion fails against an OVER-BROAD guard", async () => {
  // The empty-list mutant cannot exercise this one — removing ranges can never
  // sweep a real customer into fail-open. A guard widened to 0.0.0.0/0 and ::/0
  // can, and that is the mistake this assertion is here to catch.
  await mustFail("an address just outside a range is still a normal customer", async () => {
    for (const addr of JUST_OUTSIDE) {
      const { POST } = await overbroadRoute();
      for (let i = 1; i <= LIMIT; i++) {
        assert.equal((await callFrom(POST, addr)).status, 200, `${addr} call ${i}`);
      }
      assert.equal((await callFrom(POST, addr)).status, 429, `${addr} must still be limited`);
    }
  });

  // And an over-broad guard is caught by the ordinary per-client tests too: it
  // disables rate limiting for everyone, which is its own outage.
  await mustFail("an ordinary client is limited at 5", async () => {
    const { POST } = await overbroadRoute();
    for (let i = 1; i <= LIMIT; i++) await callFrom(POST, "203.0.113.10");
    assert.equal((await callFrom(POST, "203.0.113.10")).status, 429);
  });
});

test("CF-13: the ceiling and absent-header regressions fail against HEAD", async () => {
  // These two "e:" tests are regression pins — removing the guard cannot make
  // them fail, because they assert that behaviour NEXT to the guard is
  // untouched. HEAD is the base that discriminates them: it has no ceiling and
  // it puts every headerless caller in one shared bucket.
  await mustFail("the ceiling still refuses the 5th edge-address provision", async () => {
    process.env[GLOBAL_LIMIT_ENV] = "4";
    const { POST } = await oldRoute();
    for (let i = 1; i <= 4; i++) {
      assert.equal((await callFrom(POST, "104.16.0.1")).status, 200, `provision ${i}`);
    }
    assert.equal((await callFrom(POST, "104.16.0.1")).status, 429);
  });

  await mustFail("the absent-header path allows 20 calls", async () => {
    const { POST } = await oldRoute();
    for (let i = 1; i <= 20; i++) {
      assert.equal((await callWith(POST, {})).status, 200, `absent-header call ${i}`);
    }
  });

  // Belt and braces: the centrepiece cannot pass against HEAD either.
  await mustFail("a Cloudflare edge address must never become a rate-limit bucket", async () => {
    const { POST } = await oldRoute();
    for (let i = 1; i <= 20; i++) {
      assert.equal((await callFrom(POST, "104.16.0.1")).status, 200, `call ${i}`);
    }
  });
});
