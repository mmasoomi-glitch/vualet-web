/**
 * THE PUBLIC CONNECT-TOKEN PAIRING ENTRY POINT — behavioural tests.
 *
 * WHAT IS ACTUALLY BEING PROVEN HERE. Customer signup was dead: /api/begin
 * answered 503 whatsapp_unavailable because MIRA_WHATSAPP_PAIR_BASE was unset
 * and there was nothing correct to set it to — this repo had no pairing route,
 * so any value would have been a link to nowhere. This change adds the route
 * that variable can honestly point at, and these tests drive the REAL handlers
 * end to end: begin mints a token and a pair URL, that URL is fed straight into
 * the new entry route, and the entry route redirects to a QR page.
 *
 * WHAT IS REAL AND WHAT IS FAKED. The route handlers, store.ts,
 * connect-token.ts, pairing.ts, client-address.ts, pair-gateway.ts and
 * whatsapp-claim.ts are the untouched production source. Exactly ONE boundary
 * is faked: global fetch, via the harness's kill switch. THE GATEWAY IS NEVER
 * CALLED FOR REAL and neither is Dodo — an unscripted outbound call throws and
 * fails the test rather than reaching a live provider.
 *
 * ── ON COUNTERFACTUAL BASES: A LESSON FROM THIS SUITE'S OWN BASELINE ───────
 * The counterfactual section at the foot pins an EXPLICIT COMMIT SHA and does
 * not say "HEAD". That is deliberate, and the reason is measurable: at the time
 * this file was written the repo's suite reported 765 tests / 744 pass / 21
 * FAIL, and all 21 failures were counterfactual tests written as
 * `OLD_REV = "HEAD"` on a branch where HEAD was pre-fix. Once the fix merged,
 * "HEAD" started resolving to the FIXED code, so every one of those tests began
 * asserting that fixed code is broken. A counterfactual that names a moving
 * target stops being a counterfactual the moment it lands. Ours names c8cf90d.
 *
 * Run: npm run test:pair-entry
 */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ROOT, loadRoute, jsonRequest, readJson, env, netCalls, resetNet, scriptFetch,
} from "./route-harness/index.mjs";

// ── Fixtures ──────────────────────────────────────────────────────────────

/** Where an operator points MIRA_WHATSAPP_PAIR_BASE. The value under test. */
const PAIR_BASE = "https://mira.vualet.com/api/pair/start";

/** A gateway session, in the exact shape whatsapp-gateway-v2.mjs emits today. */
const SID = "wss_0123456789abcdef01234567";
const PAIR_KEY = "Zm9vYmFyYmF6cXV4Y29ycmVjdGhvcnNlYmF0dGVyeXN0YXBsZXhY";
const GATEWAY_LINK = `/pair/${SID}#${PAIR_KEY}`;

/** A UAE number in national form, as a customer would type it at signup. */
const RAW_PHONE = "050 123 4567";
const RAW_PHONE_E164 = "+971501234567";

/**
 * Two DIFFERENT WhatsApp accounts. The US one is not an accident: [Q_B] was
 * overruled on the live evidence that the owner scanned with a US number bought
 * FOR the assistant while his personal line is UAE, so the fixture that proves
 * "phone mismatch is advisory, never a gate" has to be exactly that shape.
 */
const JID_US = "12025550147@s.whatsapp.net";
const JID_OTHER = "447700900123@s.whatsapp.net";

/** Gate C1 (specs#160): the three required boxes, ticked. */
const FULL_CONSENT = {
  unofficialAutomation: true,
  banRisk: true,
  ownAccountReplies: true,
};

const beginBody = (over = {}) => ({
  plan: "trial",
  phone: RAW_PHONE,
  consent: FULL_CONSENT,
  ...over,
});

/** A request to the entry route, with whatever edge headers a test needs. */
function startRequest(token, { ip = "203.0.113.9", headers = {} } = {}) {
  const h = { ...headers };
  if (ip !== null) h["x-real-ip"] = ip;
  return new Request(`${PAIR_BASE}?token=${encodeURIComponent(token ?? "")}`, {
    method: "GET",
    headers: h,
  });
}

/** The full working environment: pairing configured, gateway secret present. */
function armed(over = {}) {
  env({
    MIRA_WHATSAPP_PAIR_BASE: PAIR_BASE,
    WA_PROVISION_SECRET: "test-provision-secret-not-real",
    MIRA_BIND_SECRET: "test-bind-secret-not-real",
    MIRA_ENGINE_URL: "http://127.0.0.1:8790",
    MIRA_PAIR_GLOBAL_LIMIT: undefined,
    MIRA_WEB_URL: "https://mira.vualet.com",
    ...over,
  });
}

/**
 * Script the gateway. Captures the request the route MADE (url, method,
 * headers, parsed body) so the wire contract can be asserted, and replies with
 * whatever the test wants.
 */
function stubGateway(reply = { status: 200, body: { sessionId: SID, link: GATEWAY_LINK } }) {
  const seen = [];
  scriptFetch(async (url, init) => {
    const headers = {};
    for (const [k, v] of Object.entries(init?.headers ?? {})) headers[k.toLowerCase()] = v;
    let body = null;
    try { body = JSON.parse(init?.body ?? "null"); } catch { body = init?.body ?? null; }
    seen.push({ url, method: init?.method, headers, body });
    if (typeof reply === "function") return reply(url, init, seen.length);
    if (reply.throw) throw new Error(reply.throw);
    return new Response(reply.body === undefined ? "" : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  });
  return seen;
}

/** Run a body with console.log/warn/error captured, and return every line. */
async function captureLogs(fn) {
  const lines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  const grab = (...a) => lines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  console.log = grab; console.warn = grab; console.error = grab;
  try {
    await fn();
  } finally {
    console.log = orig.log; console.warn = orig.warn; console.error = orig.error;
  }
  return lines;
}

let store;

before(async () => {
  store = await import("@/lib/store");
});

beforeEach(() => {
  resetNet();
  armed();
});

/** Mint a real WhatsApp connect record through the REAL /api/begin. */
async function seedViaBegin(over = {}) {
  const { POST } = await loadRoute("src/app/api/begin/route.ts", { fresh: true });
  const res = await POST(jsonRequest(beginBody(over), { headers: { "x-real-ip": "198.51.100.7" } }));
  const { status, body } = await readJson(res);
  assert.equal(status, 200, `seed failed: ${JSON.stringify(body)}`);
  return body;
}

const start = () => loadRoute("src/app/api/pair/start/route.ts", { fresh: true });
const bind = () => loadRoute("src/app/api/pair/bind/route.ts", { fresh: true });

// ─────────────────────────────────────────────────────────────────────────
// A. THE CENTREPIECE — signup is alive again
// ─────────────────────────────────────────────────────────────────────────

test("CENTREPIECE: with MIRA_WHATSAPP_PAIR_BASE set, /api/begin no longer 503s and returns a usable pair URL", async () => {
  const body = await seedViaBegin();

  assert.equal(typeof body.token, "string", "a token was minted");
  assert.equal(body.channel, "whatsapp");
  assert.ok(body.pairUrl, "a pair URL was returned instead of a 503");

  // "Usable" is not "a string". It must be a real URL, on the public host, at
  // the route this change added, carrying the token this call minted.
  const u = new URL(body.pairUrl);
  assert.equal(u.origin, "https://mira.vualet.com", "the public origin, not the engine host");
  assert.equal(u.pathname, "/api/pair/start", "points at the entry route this change adds");
  assert.equal(u.searchParams.get("token"), body.token, "carries this call's token");
});

test("CENTREPIECE, second half: the URL /api/begin hands out actually resolves to a QR page", async () => {
  const { token, pairUrl } = await seedViaBegin();
  const seen = stubGateway();

  // Feed begin's own output straight into the entry route. Nothing in this test
  // constructs a URL by hand — the two halves have to agree by themselves.
  const { GET } = await start();
  const res = await GET(new Request(pairUrl, { headers: { "x-real-ip": "203.0.113.9" } }));

  assert.equal(res.status, 302, "the customer is redirected, not shown an error");
  assert.equal(res.headers.get("location"), GATEWAY_LINK);
  assert.equal(seen.length, 1, "exactly one gateway call");
  assert.equal(seen[0].body.connectToken, token, "the gateway was given begin's token");
});

test("PRESERVED: with the base UNSET, /api/begin still refuses with 503 rather than hand out a dead link", async () => {
  armed({ MIRA_WHATSAPP_PAIR_BASE: undefined });
  const { POST } = await loadRoute("src/app/api/begin/route.ts", { fresh: true });
  const { status, body } = await readJson(
    await POST(jsonRequest(beginBody(), { headers: { "x-real-ip": "198.51.100.8" } })),
  );
  assert.equal(status, 503, "the refusal is not weakened by this change");
  assert.equal(body.error, "whatsapp_unavailable");
  assert.equal(netCalls.length, 0, "and nothing was provisioned anywhere");
});

// ─────────────────────────────────────────────────────────────────────────
// B. THE ENTRY ROUTE — refusals, all of them honest and stateless
// ─────────────────────────────────────────────────────────────────────────

test("a missing token and an invalid token get the SAME answer — no oracle", async () => {
  const { GET } = await start();
  const missing = await GET(startRequest(null));
  const invalid = await GET(startRequest("A".repeat(44)));

  assert.equal(missing.status, 400);
  assert.equal(invalid.status, 400);
  assert.equal(await missing.text(), await invalid.text(), "byte-identical bodies");
  assert.equal(netCalls.length, 0, "neither reached the gateway");
});

test("every refusal is an HTML page a human can read, never a JSON error object", async () => {
  const { GET } = await start();
  const res = await GET(startRequest(null));
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  const html = await res.text();
  assert.match(html, /<!doctype html>/i);
  assert.doesNotMatch(html, /\b(4\d\d|5\d\d)\b/, "no status codes shown to a customer");
  assert.doesNotMatch(html, /gateway|nginx|tunnel|token|secret|HMAC/i, "no component names");
});

test("a valid signature over an expired record gets its own honest answer, and no gateway call", async () => {
  const { token } = await seedViaBegin();
  await store.kvDel(`mira:connect:${token}`); // what a 7-day TTL does

  const { GET } = await start();
  const res = await GET(startRequest(token));
  assert.equal(res.status, 410, "Gone — the remedy is 'start again', not 'check your link'");
  assert.match(await res.text(), /expired/i);
  assert.equal(netCalls.length, 0);
});

test("a Telegram record is refused at the WhatsApp entry point, and no gateway call is made", async () => {
  const { token } = await seedViaBegin();
  const rec = await store.getConnect(token);
  await store.putConnect({ ...rec, channel: "telegram" });

  const { GET } = await start();
  const res = await GET(startRequest(token));
  assert.equal(res.status, 400);
  assert.match(await res.text(), /Telegram/);
  assert.equal(netCalls.length, 0);
});

// ─────────────────────────────────────────────────────────────────────────
// B2. THE WIRE CONTRACT WITH THE GATEWAY
// ─────────────────────────────────────────────────────────────────────────

test("the gateway call: POST /pair/request, bearer secret, { connectToken } and NO tenantId [Q_A]", async () => {
  const { token } = await seedViaBegin();
  const seen = stubGateway();
  const { GET } = await start();
  await GET(startRequest(token));

  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, "POST");
  assert.equal(seen[0].url, "http://127.0.0.1:8790/pair/request", "loopback, i.e. over the tunnel");
  assert.equal(seen[0].headers.authorization, "Bearer test-provision-secret-not-real");
  assert.equal(seen[0].body.connectToken, token);
  assert.ok(!("tenantId" in seen[0].body), "no tenant is named, so none can be created [Q_A]");
  // The three optional fields, each deliberate. Asserted by NAME so a field
  // quietly disappearing is a red test rather than a silently inert feature —
  // which is exactly how the Q_B advisory came to be built and never fire.
  assert.deepEqual(
    Object.keys(seen[0].body).sort(),
    ["connectToken", "expiresAt", "plan", "signupPhoneHash"],
    "connectToken plus the three optional fields, and nothing else",
  );
});

test("MIRA_ENGINE_URL is honoured, and a base with the path already on it is not doubled", async () => {
  const { token } = await seedViaBegin();
  armed({ MIRA_ENGINE_URL: "http://127.0.0.1:9999/pair/request" });
  const seen = stubGateway();
  const { GET } = await start();
  await GET(startRequest(token));
  assert.equal(seen[0].url, "http://127.0.0.1:9999/pair/request");
});

test("the real client address is forwarded in x-mira-client-ip as ONE value [Q_D]", async () => {
  const { token } = await seedViaBegin();
  const seen = stubGateway();
  const { GET } = await start();
  await GET(startRequest(token, { ip: "203.0.113.9" }));

  assert.equal(seen[0].headers["x-mira-client-ip"], "203.0.113.9");
  assert.ok(!seen[0].headers["x-mira-client-ip"].includes(","), "never a chain");
  // It is the ADDRESS, not the rate-limit bucket: no "v4:" namespace prefix.
  assert.doesNotMatch(seen[0].headers["x-mira-client-ip"], /^v[46]:/);
});

test("an IPv6 client is forwarded in FULL, while its rate-limit bucket is only the /64", async () => {
  const { token } = await seedViaBegin();
  const seen = stubGateway();
  const { GET } = await start();
  await GET(startRequest(token, { ip: "2001:db8:1:2:3:4:5:6" }));
  assert.equal(
    seen[0].headers["x-mira-client-ip"],
    "2001:db8:1:2:3:4:5:6",
    "a forwarded address must be the address, never the lossy bucket key",
  );
});

test("an IPv4-mapped IPv6 address is forwarded in canonical IPv4 form, so one customer is one address", async () => {
  const { token } = await seedViaBegin();
  const seen = stubGateway();
  const { GET } = await start();
  await GET(startRequest(token, { ip: "::ffff:203.0.113.9" }));
  assert.equal(seen[0].headers["x-mira-client-ip"], "203.0.113.9");
});

test("NO x-mira-client-ip is sent when the address cannot be trusted — absent beats fake [gotchas#252]", async () => {
  const { token } = await seedViaBegin();

  for (const [label, headers] of [
    ["header absent", {}],
    ["header empty", { "x-real-ip": "   " }],
    ["a comma chain, i.e. nginx emitting proxy_add_x_forwarded_for", { "x-real-ip": "203.0.113.9, 172.68.1.1" }],
    ["a Cloudflare EDGE address, i.e. real_ip not configured", { "x-real-ip": "172.68.1.1" }],
    ["only an attacker-appendable x-forwarded-for", { "x-forwarded-for": "1.2.3.4, 104.16.0.1" }],
  ]) {
    resetNet();
    const seen = stubGateway();
    const { GET } = await start();
    const res = await GET(
      new Request(`${PAIR_BASE}?token=${token}`, { method: "GET", headers }),
    );
    assert.equal(res.status, 302, `${label}: pairing still works (fail open)`);
    assert.equal(
      seen[0].headers["x-mira-client-ip"],
      undefined,
      `${label}: the gateway is told nothing rather than told a lie`,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────
// B3. THE REDIRECT — the fragment, and the open-redirect guard
// ─────────────────────────────────────────────────────────────────────────

test("the redirect preserves the #pairKey fragment exactly, and is same-origin RELATIVE", async () => {
  const { token } = await seedViaBegin();
  stubGateway();
  const { GET } = await start();
  const res = await GET(startRequest(token));

  const loc = res.headers.get("location");
  assert.equal(loc, `/pair/${SID}#${PAIR_KEY}`);
  assert.ok(loc.startsWith("/pair/"), "relative: the browser resolves it against our own origin");
  assert.ok(!loc.startsWith("//"), "not protocol-relative");
  assert.equal(loc.split("#")[1], PAIR_KEY, "the pair key survives the hop");
});

test("the redirect is 302 and no-store — a cached permanent redirect would republish a live pair key", async () => {
  const { token } = await seedViaBegin();
  stubGateway();
  const { GET } = await start();
  const res = await GET(startRequest(token));

  assert.equal(res.status, 302);
  assert.notEqual(res.status, 301);
  assert.notEqual(res.status, 308);
  assert.match(res.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
});

test("an absolute link on OUR origin is accepted and reduced to a relative path, fragment intact", async () => {
  const { token } = await seedViaBegin();
  stubGateway({ status: 200, body: { sessionId: SID, link: `https://mira.vualet.com/pair/${SID}#${PAIR_KEY}` } });
  const { GET } = await start();
  const res = await GET(startRequest(token));
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), `/pair/${SID}#${PAIR_KEY}`);
});

test("OPEN REDIRECT GUARD: a link that is not same-origin /pair/<id> is refused, not followed", async () => {
  const { token } = await seedViaBegin();

  const hostile = [
    "https://evil.example/pair/x",
    "//evil.example/pair/x",
    "/\\evil.example/pair/x",
    "http://23.88.59.31:8790/pair/x", // the engine host directly — never
    "/pair/a/b",                       // two segments: not a page we proxy
    "/admin",
    "/pair/",
    "javascript:alert(1)",
    `/pair/${SID}#${PAIR_KEY}\r\nX-Injected: 1`,
    123,
    null,
  ];

  for (const link of hostile) {
    resetNet();
    stubGateway({ status: 200, body: { sessionId: SID, link } });
    const { GET } = await start();
    const res = await GET(startRequest(token));
    assert.equal(res.status, 503, `refused: ${String(link)}`);
    assert.equal(res.headers.get("location"), null, `no redirect issued for ${String(link)}`);
  }
});

test("a 200 with no sessionId is refused: a session we cannot name is one we cannot support", async () => {
  const { token } = await seedViaBegin();
  stubGateway({ status: 200, body: { link: GATEWAY_LINK } });
  const { GET } = await start();
  assert.equal((await GET(startRequest(token))).status, 503);
});

// ─────────────────────────────────────────────────────────────────────────
// B4. FAILURE IS HONEST, AND LEAVES NOTHING HALF-CREATED
// ─────────────────────────────────────────────────────────────────────────

test("WA_PROVISION_SECRET unset: an honest 503 and NOT A SINGLE outbound call", async () => {
  const { token } = await seedViaBegin();
  armed({ WA_PROVISION_SECRET: undefined });
  const { GET } = await start();
  const res = await GET(startRequest(token));

  assert.equal(res.status, 503);
  assert.match(await res.text(), /isn't available right now/);
  assert.equal(netCalls.length, 0, "we do not call an endpoint we know will 401");
});

test("gateway unreachable / timed out / 5xx / 401 all give the customer the SAME honest page", async () => {
  const { token } = await seedViaBegin();

  for (const reply of [
    { throw: "connect ECONNREFUSED 127.0.0.1:8790" },
    { status: 500, body: { error: "pair_request_failed" } },
    { status: 401, body: { error: "unauthorized" } },
    { status: 400, body: { error: "tenantId required" } },
  ]) {
    resetNet();
    stubGateway(reply);
    const { GET } = await start();
    const res = await GET(startRequest(token));
    assert.equal(res.status, 503, `reply ${JSON.stringify(reply)}`);
    const html = await res.text();
    assert.match(html, /isn't available right now/);
    assert.doesNotMatch(html, /401|500|unauthorized|tenantId/i, "the diagnosis stays in our logs");
  }
});

test("a gateway 403 (revoked customer) gets a TRUE sentence about their account, not 'our side'", async () => {
  const { token } = await seedViaBegin();
  stubGateway({ status: 403, body: { error: "subscription_inactive" } });
  const { GET } = await start();
  const res = await GET(startRequest(token));
  assert.equal(res.status, 403);
  assert.match(await res.text(), /subscription isn't active/i);
});

test("a gateway 429 is passed through as 429, so a retry loop is told to slow down", async () => {
  const { token } = await seedViaBegin();
  stubGateway({ status: 429, body: { error: "rate_limited" } });
  const { GET } = await start();
  assert.equal((await GET(startRequest(token))).status, 429);
});

test("NOTHING is half-created by a failure: the record is byte-identical after every kind of fault", async () => {
  const { token } = await seedViaBegin();
  const before = JSON.stringify(await store.getConnect(token));

  for (const reply of [
    { throw: "boom" },
    { status: 500, body: {} },
    { status: 403, body: {} },
    { status: 200, body: { sessionId: SID, link: "https://evil.example/" } },
  ]) {
    resetNet();
    stubGateway(reply);
    const { GET } = await start();
    await GET(startRequest(token));
    assert.equal(JSON.stringify(await store.getConnect(token)), before, JSON.stringify(reply));
  }
});

// ─────────────────────────────────────────────────────────────────────────
// B5. NOTHING SECRET IS EVER LOGGED
// ─────────────────────────────────────────────────────────────────────────

test("no log line anywhere carries the token, the pair key, the phone number, or a secret", async () => {
  const { token } = await seedViaBegin();

  const lines = await captureLogs(async () => {
    // A success, then one of every failure shape, so every logging branch runs.
    for (const reply of [
      { status: 200, body: { sessionId: SID, link: GATEWAY_LINK } },
      { throw: "ECONNREFUSED" },
      { status: 401, body: {} },
      { status: 200, body: { sessionId: SID, link: "https://evil.example/" } },
    ]) {
      resetNet();
      stubGateway(reply);
      const { GET } = await start();
      await GET(startRequest(token, { ip: "172.68.1.1" })); // also the edge-address log
    }
    // And the disabled-secret branch.
    resetNet();
    armed({ WA_PROVISION_SECRET: undefined });
    const { GET } = await start();
    await GET(startRequest(token));
  });

  assert.ok(lines.length > 0, "the failure branches DO log — silence is its own bug");
  const all = lines.join("\n");
  for (const [what, needle] of [
    ["the connect token", token],
    ["the pair key", PAIR_KEY],
    ["the redirect target", GATEWAY_LINK],
    ["the provisioning secret", "test-provision-secret-not-real"],
    ["the bind secret", "test-bind-secret-not-real"],
    ["the phone number", RAW_PHONE_E164],
    ["the phone number, digits only", "971501234567"],
  ]) {
    assert.ok(!all.includes(needle), `${what} must never be logged. Offending output:\n${all}`);
  }
  // The session id IS logged, on purpose: opaque, not a secret, and the only
  // thing that makes a support call tractable.
  assert.ok(all.includes(SID), "the session id is logged so a human can trace a pairing");
});

// ─────────────────────────────────────────────────────────────────────────
// C. REPEATABILITY [Q_C]
// ─────────────────────────────────────────────────────────────────────────

test("REPEATABLE: hitting the entry route twice redirects twice and consumes nothing [Q_C]", async () => {
  const { token } = await seedViaBegin();
  const before = await store.getConnect(token);
  const seen = stubGateway();
  const { GET } = await start();

  const first = await GET(startRequest(token));
  const second = await GET(startRequest(token));

  assert.equal(first.status, 302, "first visit works");
  assert.equal(second.status, 302, "so does the second — the customer is not stranded");
  assert.equal(seen.length, 2);
  assert.equal(seen[0].body.connectToken, seen[1].body.connectToken,
    "the SAME token is presented, so the gateway can return the SAME session");

  const after = await store.getConnect(token);
  assert.equal(after.whatsappIdHash, undefined, "presenting a token does not claim it");
  assert.equal(after.tenantId, undefined, "and creates no tenant [Q_A]");
  assert.equal(after.status, before.status, "and changes no state at all");
});

test("REPEATABLE: an idempotent gateway means the customer reopens THE SAME QR", async () => {
  const { token } = await seedViaBegin();
  // What the gateway must do per the contract: same token -> same live session.
  const sessions = new Map();
  stubGateway((url, init) => {
    const { connectToken } = JSON.parse(init.body);
    if (!sessions.has(connectToken)) sessions.set(connectToken, `/pair/${SID}#${PAIR_KEY}`);
    return new Response(JSON.stringify({ sessionId: SID, link: sessions.get(connectToken) }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  });

  const { GET } = await start();
  const a = await GET(startRequest(token));
  const b = await GET(startRequest(token));
  assert.equal(a.headers.get("location"), b.headers.get("location"),
    "same QR, same pair key — an abandoned pairing can be resumed");
});

// ─────────────────────────────────────────────────────────────────────────
// D. RATE LIMITING, BY TOKEN AS WELL AS IP [Q_D]
// ─────────────────────────────────────────────────────────────────────────

const TOKEN_LIMIT = 10;
const IP_LIMIT = 20;

test("BY TOKEN: the 11th start for one token is refused even from 11 DIFFERENT addresses [Q_D]", async () => {
  const { token } = await seedViaBegin();
  stubGateway();
  const { GET } = await start();

  for (let i = 0; i < TOKEN_LIMIT; i++) {
    const res = await GET(startRequest(token, { ip: `203.0.113.${10 + i}` }));
    assert.equal(res.status, 302, `call ${i + 1} of ${TOKEN_LIMIT} should pass`);
  }
  const over = await GET(startRequest(token, { ip: "203.0.113.99" }));
  assert.equal(over.status, 429, "a fresh address does NOT buy a fresh allowance");
  assert.match(await over.text(), /still valid/, "and it says the link still works");
});

test("BY TOKEN: exhausting one token leaves another token untouched", async () => {
  const a = await seedViaBegin();
  const b = await seedViaBegin({ phone: "050 765 4321" });
  stubGateway();
  const { GET } = await start();

  for (let i = 0; i <= TOKEN_LIMIT; i++) await GET(startRequest(a.token));
  assert.equal((await GET(startRequest(a.token))).status, 429, "token A is spent");
  assert.equal((await GET(startRequest(b.token))).status, 302, "token B is not");
});

test("BY ADDRESS: one machine cycling through many tokens is stopped too", async () => {
  stubGateway();
  const { GET } = await start();
  const IP = "198.51.100.200";

  let refused = 0;
  for (let i = 0; i < IP_LIMIT + 2; i++) {
    const { token } = await seedViaBegin({ phone: `05012345${String(10 + i).padStart(2, "0")}` });
    const res = await GET(startRequest(token, { ip: IP }));
    if (res.status === 429) refused++;
  }
  assert.ok(refused >= 2, `the address gate binds (${refused} refusals past the limit)`);
});

test("BY ADDRESS: an IPv6 customer is bucketed by /64, so a whole cheap /64 is one allowance", async () => {
  stubGateway();
  const { GET } = await start();

  let refused = 0;
  for (let i = 0; i < IP_LIMIT + 2; i++) {
    const { token } = await seedViaBegin({ phone: `05011122${String(10 + i).padStart(2, "0")}` });
    // A different /128 every time, all inside ONE /64.
    const res = await GET(startRequest(token, { ip: `2001:db8:abcd:1234::${(i + 1).toString(16)}` }));
    if (res.status === 429) refused++;
  }
  assert.ok(refused >= 2, "a /64 cannot mint unlimited buckets");
});

test("FAIL OPEN, never fail closed and never a shared bucket, when there is no trustworthy address", async () => {
  stubGateway();
  const { GET } = await start();

  // Thirty addressless calls, each on its own token. If the route had fallen
  // back to a constant key (the classic `|| "unknown"`) these would share one
  // 20/hour allowance and most would 429. If it failed closed, all would.
  let ok = 0;
  for (let i = 0; i < 30; i++) {
    const { token } = await seedViaBegin({ phone: `05099${String(100000 + i).slice(-6)}` });
    const res = await GET(new Request(`${PAIR_BASE}?token=${token}`, { method: "GET" }));
    if (res.status === 302) ok++;
  }
  assert.equal(ok, 30, "a missing edge header must not be a signup outage");
});

test("a Cloudflare EDGE address is treated as ABSENT, not as a bucket key [gotchas#252]", async () => {
  stubGateway();
  const { GET } = await start();

  // If the edge address were accepted as a key, all 25 of these would share one
  // bucket and the last few would 429 — the whole internet in ~12 buckets.
  let ok = 0;
  for (let i = 0; i < 25; i++) {
    const { token } = await seedViaBegin({ phone: `05088${String(200000 + i).slice(-6)}` });
    const res = await GET(startRequest(token, { ip: "172.68.1.1" }));
    if (res.status === 302) ok++;
  }
  assert.equal(ok, 25);
});

test("the GLOBAL ceiling is what carries the endpoint when no address is trustworthy", async () => {
  armed({ MIRA_PAIR_GLOBAL_LIMIT: "3" });
  stubGateway();
  const { GET } = await start();

  const statuses = [];
  for (let i = 0; i < 5; i++) {
    const { token } = await seedViaBegin({ phone: `05077${String(300000 + i).slice(-6)}` });
    statuses.push((await GET(new Request(`${PAIR_BASE}?token=${token}`, { method: "GET" }))).status);
  }
  assert.deepEqual(statuses, [302, 302, 302, 429, 429], "three sessions, then the ceiling");
});

test("a request refused BEFORE the gateway does not burn a global slot", async () => {
  armed({ MIRA_PAIR_GLOBAL_LIMIT: "2" });
  stubGateway();
  const { GET } = await start();

  // Five refusals of three different kinds, none of which reaches the gateway.
  const { token: dead } = await seedViaBegin();
  await store.kvDel(`mira:connect:${dead}`);
  for (let i = 0; i < 5; i++) {
    await GET(startRequest(null));
    await GET(startRequest("Z".repeat(44)));
    await GET(startRequest(dead));
  }

  // The budget is untouched.
  const one = await seedViaBegin({ phone: "050 111 2233" });
  const two = await seedViaBegin({ phone: "050 111 2244" });
  assert.equal((await GET(startRequest(one.token))).status, 302);
  assert.equal((await GET(startRequest(two.token))).status, 302);
});

test("an unparseable MIRA_PAIR_GLOBAL_LIMIT falls back to the default — a typo cannot remove the ceiling", async () => {
  for (const bad of ["", "abc", "0", "-5", "1.5"]) {
    armed({ MIRA_PAIR_GLOBAL_LIMIT: bad });
    stubGateway();
    const { GET } = await start();
    const { token } = await seedViaBegin({ phone: "050 222 3344" });
    assert.equal((await GET(startRequest(token))).status, 302, `limit=${JSON.stringify(bad)}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// E. THE SINGLE-USE CLAIM [Q_C] — POST /api/pair/bind
// ─────────────────────────────────────────────────────────────────────────

function bindRequest(body, { secret = "test-bind-secret-not-real" } = {}) {
  return new Request("https://mira.vualet.com/api/pair/bind", {
    method: "POST",
    headers: { "content-type": "application/json", "x-mira-bind-secret": secret },
    body: JSON.stringify(body),
  });
}

test("the bind callback is authenticated: a wrong or missing secret is 401", async () => {
  const { token } = await seedViaBegin();
  const { POST } = await bind();
  for (const secret of ["", "wrong", "test-bind-secret-not-rea"]) {
    const { status, body } = await readJson(await POST(bindRequest({ token, whatsappId: JID_US }, { secret })));
    assert.equal(status, 401, JSON.stringify(secret));
    assert.equal(body.error, "unauthorized");
  }
});

test("FIRST bind claims the token: whatsappIdHash is stamped and pending becomes bound", async () => {
  const { token } = await seedViaBegin();
  const { POST } = await bind();
  const { status, body } = await readJson(
    await POST(bindRequest({ token, whatsappId: JID_US, tenantId: "tnt_abc123" })),
  );

  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.firstBind, true);

  const rec = await store.getConnect(token);
  assert.equal(typeof rec.whatsappIdHash, "string");
  assert.equal(rec.status, "bound");
  assert.equal(rec.tenantId, "tnt_abc123", "the tenant the engine created AT BIND [Q_A]");
});

test("the SAME account re-binding is idempotent: 200, firstBind false, and nothing is rewritten", async () => {
  const { token } = await seedViaBegin();
  const { POST } = await bind();
  await POST(bindRequest({ token, whatsappId: JID_US }));
  const after1 = JSON.stringify(await store.getConnect(token));

  // Same account, different spelling: device suffix and a change of case. One
  // account must not read as three.
  for (const spelling of [JID_US, "12025550147:12@s.whatsapp.net", "12025550147@S.WhatsApp.Net"]) {
    const { status, body } = await readJson(await POST(bindRequest({ token, whatsappId: spelling })));
    assert.equal(status, 200, spelling);
    assert.equal(body.firstBind, false, `${spelling}: recognised as the same account`);
  }
  assert.equal(JSON.stringify(await store.getConnect(token)), after1, "no write on a repeat");
});

test("A DIFFERENT account is refused with 409 — the first account to bind owns the token", async () => {
  const { token } = await seedViaBegin();
  const { POST } = await bind();
  await POST(bindRequest({ token, whatsappId: JID_US }));

  const { status, body } = await readJson(await POST(bindRequest({ token, whatsappId: JID_OTHER })));
  assert.equal(status, 409);
  assert.equal(body.error, "foreign");
  assert.equal(body.persona, undefined, "and a stranger learns nothing about the account");
});

test("a Telegram record is not bindable over WhatsApp, and neither is a record that is gone", async () => {
  const tg = await seedViaBegin();
  const rec = await store.getConnect(tg.token);
  await store.putConnect({ ...rec, channel: "telegram" });

  const { POST } = await bind();
  const wrong = await readJson(await POST(bindRequest({ token: tg.token, whatsappId: JID_US })));
  assert.equal(wrong.status, 409);
  assert.equal(wrong.body.error, "wrong_channel");

  const gone = await seedViaBegin({ phone: "050 333 4455" });
  await store.kvDel(`mira:connect:${gone.token}`);
  const missing = await readJson(await POST(bindRequest({ token: gone.token, whatsappId: JID_US })));
  assert.equal(missing.status, 404);
});

test("an unsigned token never reaches the store, however well-formed it looks", async () => {
  const { POST } = await bind();
  const { status, body } = await readJson(
    await POST(bindRequest({ token: "B".repeat(44), whatsappId: JID_US })),
  );
  assert.equal(status, 403);
  assert.equal(body.error, "invalid token");
});

test("THE JID IS NEVER STORED: the record holds a hash, and no digit of the number survives", async () => {
  const { token } = await seedViaBegin();
  const { POST } = await bind();
  await POST(bindRequest({ token, whatsappId: JID_US }));

  const blob = JSON.stringify(await store.getConnect(token));
  assert.ok(!blob.includes(JID_US), "not the JID");
  assert.ok(!blob.includes("12025550147"), "not the number inside it");
  assert.ok(!blob.includes("s.whatsapp.net"), "not even the domain");
  const rec = await store.getConnect(token);
  assert.ok(!/\d{7,}/.test(rec.whatsappIdHash), "the stored value carries no long digit run");
});

test("[Q_B] a phone mismatch between signup and the scanned account is NOT a gate", async () => {
  // Signed up with a UAE number; scanned with a US number bought FOR the
  // assistant. This is the owner's own live case, and it must succeed.
  const { token } = await seedViaBegin({ phone: RAW_PHONE });
  const seeded = await store.getConnect(token);
  assert.equal(seeded.phone, RAW_PHONE_E164, "the signup number really is the UAE one");

  const { POST } = await bind();
  const { status, body } = await readJson(await POST(bindRequest({ token, whatsappId: JID_US })));
  assert.equal(status, 200, "a different country is not a refusal");
  assert.equal(body.firstBind, true);
});

test("the tenant id is mirrored onto the durable subscription record, but never re-pointed", async () => {
  const { token } = await seedViaBegin();
  const rec = await store.getConnect(token);
  await store.putConnect({ ...rec, customerId: "cus_mirror1" });
  await store.putSubscription("cus_mirror1", { ...rec, customerId: "cus_mirror1" });

  const { POST } = await bind();
  await POST(bindRequest({ token, whatsappId: JID_US, tenantId: "tnt_first" }));
  assert.equal((await store.getSubscription("cus_mirror1")).tenantId, "tnt_first",
    "a revocation months later can still find this customer [gotchas#267]");

  // A second, different tenant must NOT silently re-aim the next revocation.
  const other = await seedViaBegin({ phone: "050 444 5566" });
  const orec = await store.getConnect(other.token);
  await store.putConnect({ ...orec, customerId: "cus_mirror1" });
  await POST(bindRequest({ token: other.token, whatsappId: JID_OTHER, tenantId: "tnt_second" }));
  assert.equal((await store.getSubscription("cus_mirror1")).tenantId, "tnt_first", "left alone");
});

test("no bind log line carries the token, the JID, the number, or the bind secret", async () => {
  const { token } = await seedViaBegin();
  const other = await seedViaBegin({ phone: "050 555 6677" });
  const lines = await captureLogs(async () => {
    const { POST } = await bind();
    await POST(bindRequest({ token, whatsappId: JID_US, tenantId: "tnt_log" }));
    await POST(bindRequest({ token, whatsappId: JID_OTHER })); // the "foreign" branch
    await POST(bindRequest({ token: other.token, whatsappId: JID_US }, { secret: "wrong" }));
  });
  const all = lines.join("\n");
  for (const needle of [token, other.token, JID_US, JID_OTHER, "12025550147", RAW_PHONE_E164, "test-bind-secret-not-real"]) {
    assert.ok(!all.includes(needle), `leaked: ${needle}\n${all}`);
  }
  assert.ok(all.includes("tnt_log"), "the tenant id IS logged — opaque, and needed for support");
});

// ─────────────────────────────────────────────────────────────────────────
// F. NON-REGRESSION — the Telegram path is untouched
// ─────────────────────────────────────────────────────────────────────────

const PRE = "c8cf90d"; // see the header note: an explicit SHA, never "HEAD".

let PRE_SRC = {};
before(() => {
  const show = (file) => execFileSync("git", ["show", `${PRE}:${file}`], { cwd: ROOT, encoding: "utf8" });
  PRE_SRC = {
    connect: show("src/app/api/connect/route.ts"),
    store: show("src/lib/store.ts"),
    begin: show("src/app/api/begin/route.ts"),
    pairing: show("src/lib/pairing.ts"),
  };
});

test("PRESERVED: src/app/api/connect/route.ts is BYTE-IDENTICAL to the pre-change revision", async () => {
  const now = await readFile(path.join(ROOT, "src/app/api/connect/route.ts"), "utf8");
  assert.equal(now.replace(/\r\n/g, "\n"), PRE_SRC.connect.replace(/\r\n/g, "\n"),
    "the live Telegram bind path was not touched to make WhatsApp work");
});

test("PRESERVED: claimConnect's body is byte-identical — the Telegram invariant was not generalised", async () => {
  const now = await readFile(path.join(ROOT, "src/lib/store.ts"), "utf8");
  // Line endings are normalised BEFORE slicing: git hands back LF and the
  // working tree here is CRLF, so a slice taken first carries a stray CR and
  // the comparison fails for a reason that has nothing to do with the code.
  const grab = (raw) => {
    const src = raw.split("\r\n").join("\n");
    const i = src.indexOf("export async function claimConnect(");
    const j = src.indexOf("\nexport async function putSubscription", i);
    assert.ok(j > i, "end found");
    return src.slice(i, j);
  };
  assert.equal(grab(now), grab(PRE_SRC.store));
});

test("PRESERVED: a Telegram signup still gets a t.me link and never touches the pairing route", async () => {
  const { POST } = await loadRoute("src/app/api/begin/route.ts", { fresh: true });
  const { status, body } = await readJson(
    await POST(jsonRequest({ plan: "trial", channel: "telegram" }, { headers: { "x-real-ip": "198.51.100.9" } })),
  );
  assert.equal(status, 200);
  assert.match(body.botUrl, /^https:\/\/t\.me\//);
  assert.equal(body.pairUrl, undefined, "a Telegram customer is never handed a WhatsApp link");
  assert.equal(netCalls.length, 0);
});

test("PRESERVED: the Telegram claim still works, and a WhatsApp claim cannot poison it", async () => {
  const { POST: beginPost } = await loadRoute("src/app/api/begin/route.ts", { fresh: true });
  const { body: tg } = await readJson(
    await beginPost(jsonRequest({ plan: "trial", channel: "telegram" }, { headers: { "x-real-ip": "198.51.100.11" } })),
  );
  const first = await store.claimConnect(tg.token, 4242);
  assert.equal(first.ok, true);
  assert.equal(first.rec.telegramId, 4242);
  const foreign = await store.claimConnect(tg.token, 9999);
  assert.deepEqual(foreign, { ok: false, reason: "foreign" });

  // And the WhatsApp predicate refuses it outright rather than stamping a
  // second identity onto a Telegram record.
  const { claimConnectWhatsapp } = await import("@/lib/whatsapp-claim");
  assert.deepEqual(await claimConnectWhatsapp(tg.token, JID_US), { ok: false, reason: "wrong_channel" });
  assert.equal((await store.getConnect(tg.token)).telegramId, 4242, "untouched");
});

// ─────────────────────────────────────────────────────────────────────────
// G. THE DUPLICATED ADDRESS LOGIC IS FENCED
// ─────────────────────────────────────────────────────────────────────────

test("DRIFT GUARD: the Cloudflare range list is SET-EQUAL to /api/begin's vendored copy", async () => {
  const mine = (await import("@/lib/client-address")).CLOUDFLARE_RANGES;
  const beginSrc = await readFile(path.join(ROOT, "src/app/api/begin/route.ts"), "utf8");
  const block = /const CLOUDFLARE_RANGES: readonly string\[\] = \[([\s\S]*?)\n\];/.exec(beginSrc);
  assert.ok(block, "found begin's vendored list");
  // Only quoted values that ARE CIDRs. The block carries prose comments, and a
  // word in quotes inside one ("healthy") is not a range.
  const theirs = [...block[1].matchAll(/"([0-9a-fA-F.:]+\/[0-9]{1,3})"/g)].map((m) => m[1]);

  assert.ok(theirs.length >= 20, "sanity: the list was actually parsed");
  assert.deepEqual(new Set(mine), new Set(theirs),
    "one of the two copies was edited without the other; they must stay in step " +
    "(the real fix is to point begin/route.ts at @/lib/client-address)");
});

test("DRIFT GUARD: the address-parsing functions are verbatim identical to /api/begin's", async () => {
  const beginSrc = (await readFile(path.join(ROOT, "src/app/api/begin/route.ts"), "utf8")).replace(/\r\n/g, "\n");
  const mineSrc = (await readFile(path.join(ROOT, "src/lib/client-address.ts"), "utf8")).replace(/\r\n/g, "\n");

  const body = (src, signature, endsBefore) => {
    const i = src.indexOf(signature);
    assert.ok(i > 0, `not found: ${signature}`);
    const j = src.indexOf(endsBefore, i + signature.length);
    assert.ok(j > i, `end not found for: ${signature}`);
    return src.slice(i, j).trim();
  };

  for (const [sig, end] of [
    ["function parseIpv4(value: string): number[] | null {", "\n\n"],
    ["function parseIpv6(input: string): number[] | null {", "\n\n"],
    ["function prefixMatches(", "\n\n"],
    ["function maskAddress(addr: Address): string {", "\n\n"],
  ]) {
    assert.equal(
      body(mineSrc, `export ${sig}`.replace("export function prefixMatches(", "function prefixMatches("), end)
        .replace(/^export /, ""),
      body(beginSrc, sig, end),
      `${sig} has drifted between /api/begin and @/lib/client-address`,
    );
  }
});

test("the two implementations agree on a table of addresses, including every rejection", async () => {
  const { parseAddress, maskAddress, formatAddress, cloudflareRange } = await import("@/lib/client-address");
  const table = [
    ["203.0.113.9", "v4:203.0.113.9", "203.0.113.9", null],
    ["::ffff:203.0.113.9", "v4:203.0.113.9", "203.0.113.9", null],
    ["2001:db8:1:2:3:4:5:6", "v6:2001:db8:1:2::/64", "2001:db8:1:2:3:4:5:6", null],
    ["172.68.1.1", null, null, "162.158.0.0/15"], // hmm: see assertion below
  ];
  for (const [value, key, wire] of table) {
    const addr = parseAddress(value);
    if (key === null) { assert.ok(addr, `${value} parses`); continue; }
    assert.equal(maskAddress(addr), key, value);
    assert.equal(formatAddress(addr), wire, value);
  }
  // Rejections: each of these must be UNPARSEABLE, i.e. treated as absent.
  for (const bad of ["203.0.113.9, 172.68.1.1", "01.2.3.4", "1.2.3.256", "1.2.3", "", "fe80::1%eth0", "not-an-ip"]) {
    assert.equal(parseAddress(bad), null, `${JSON.stringify(bad)} must not parse`);
  }
  // And a Cloudflare edge address must be RECOGNISED as one on both families.
  for (const edge of ["172.68.1.1", "104.16.0.1", "2606:4700::1111"]) {
    assert.ok(cloudflareRange(parseAddress(edge)), `${edge} is a Cloudflare address`);
  }
  for (const real of ["203.0.113.9", "2001:db8::1"]) {
    assert.equal(cloudflareRange(parseAddress(real)), null, `${real} is a real customer`);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// H. COUNTERFACTUALS — every new claim, checked against the pre-change code
//
// Standing project rule (ledger gotchas#138/#139): a test that would still pass
// with the change removed proves nothing.
// ─────────────────────────────────────────────────────────────────────────

/** Require that `fn` fails against the pre-change tree. */
function mustFailAgainstOldCode(what, fn) {
  let caught = null;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(
    caught,
    `COUNTERFACTUAL BROKEN — "${what}" PASSED against ${PRE}, the code before this change. ` +
      `That test does not detect the change and must be strengthened.`,
  );
  return caught;
}

/** `git show <rev>:<file>`, or null when the file did not exist at that rev. */
function showOrNull(file) {
  try {
    return execFileSync("git", ["show", `${PRE}:${file}`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

test(`CF-1: at ${PRE} there was NO pairing route, so MIRA_WHATSAPP_PAIR_BASE had nothing to point at`, () => {
  // THIS is the counterfactual for the centrepiece, stated honestly. /api/begin
  // ALREADY knew how to compose a pair URL from the base — that half is not new
  // and pretending it is would be a fake test. What was missing was anything
  // correct to put in the variable: every candidate value was a link to a route
  // that did not exist, which is why the honest answer was 503.
  assert.equal(showOrNull("src/app/api/pair/start/route.ts"), null,
    "the entry route must be absent at the counterfactual base");
  assert.equal(showOrNull("src/lib/pair-gateway.ts"), null);
  assert.equal(showOrNull("src/app/api/pair/bind/route.ts"), null);
  assert.equal(showOrNull("src/lib/whatsapp-claim.ts"), null);
  assert.equal(showOrNull("src/lib/client-address.ts"), null);
  assert.equal(showOrNull("docs/nginx-pair-proxy.conf"), null);
});

test(`CF-2: at ${PRE} pairing.ts told operators the opposite — that no such route exists`, () => {
  mustFailAgainstOldCode("pairing.ts names the entry route an operator must configure", () => {
    assert.match(PRE_SRC.pairing, /MIRA_WHATSAPP_PAIR_BASE=https:\/\/mira\.vualet\.com\/api\/pair\/start/);
  });
  // And it said, in as many words, that there was none.
  assert.match(PRE_SRC.pairing, /There is deliberately NO WhatsApp pairing route in this repo/);
  // And the SHIPPED file must no longer say it, and must name the exact value
  // an operator has to set. Otherwise this change moved the code without moving
  // the instruction, which is exactly how a settable variable stays unset.
  const now = readFileSync(path.join(ROOT, "src/lib/pairing.ts"), "utf8");
  assert.doesNotMatch(now, /There is deliberately NO WhatsApp pairing route in this repo/);
  assert.match(now, /MIRA_WHATSAPP_PAIR_BASE=https:\/\/mira\.vualet\.com\/api\/pair\/start/);
});

test(`CF-3: at ${PRE} the record had no way to express a WhatsApp claim at all`, () => {
  mustFailAgainstOldCode("ConnectRecord carries a WhatsApp claim field", () => {
    assert.match(PRE_SRC.store, /whatsappIdHash\?: string;/);
  });
  mustFailAgainstOldCode("ConnectRecord carries an engine tenant id", () => {
    assert.match(PRE_SRC.store, /\n  tenantId\?: string;/);
  });
  // The single-use rule really was telegramId and nothing else.
  assert.match(PRE_SRC.store, /claimConnect\(\s*token: string,\s*telegramId: number,/);
  assert.ok(!/whatsapp/i.test(PRE_SRC.store.slice(
    PRE_SRC.store.indexOf("export async function claimConnect("),
    PRE_SRC.store.indexOf("export async function putSubscription"),
  )), "claimConnect had no WhatsApp branch to reuse");
});

test(`CF-4: at ${PRE} the address logic was locked inside /api/begin and could not be reused`, () => {
  mustFailAgainstOldCode("the address logic is importable", () => {
    assert.match(PRE_SRC.begin, /export function clientAddress/);
  });
  mustFailAgainstOldCode("the limiter is reusable by another route", () => {
    assert.match(PRE_SRC.begin, /export function (rateLimited|takeGlobalSlot)/);
  });
  // Which is exactly why this change copied it behind a drift guard rather than
  // editing a route it does not own.
  assert.match(PRE_SRC.begin, /^function clientKey\(req: Request\): ClientKey \{/m);
});

test(`CF-5: at ${PRE} nothing forwarded a client address to the gateway`, () => {
  mustFailAgainstOldCode("some route forwards the real client address downstream", () => {
    const engine = showOrNull("src/lib/engine-push.ts") ?? "";
    assert.match(PRE_SRC.begin + engine, /x-mira-client-ip/i);
  });
});

test(`CF-6: the open-redirect guard is new — at ${PRE} nothing validated a gateway link`, () => {
  mustFailAgainstOldCode("a link from the gateway is checked before a customer is redirected to it", () => {
    const all = PRE_SRC.begin + PRE_SRC.connect + PRE_SRC.pairing + (showOrNull("src/lib/engine-push.ts") ?? "");
    assert.match(all, /safePairPath/);
  });
});

test("CF-7: the safePairPath guard actually distinguishes safe from hostile — not a rubber stamp", async () => {
  const { safePairPath } = await import("@/lib/pair-gateway");
  // If this function simply returned its input, every one of these would pass
  // and the guard test above would be theatre.
  assert.equal(safePairPath(`/pair/${SID}#${PAIR_KEY}`), `/pair/${SID}#${PAIR_KEY}`);
  for (const bad of [
    "https://evil.example/pair/x", "//evil.example/pair/x", "/\\evil.example",
    "/pair/a/b", "/admin", "javascript:alert(1)", "/pair/", "", null, 42,
    "/pair/x\nX-Injected: 1", "/pair/x y", `/pair/${SID}#${"!".repeat(4)}`,
  ]) {
    assert.equal(safePairPath(bad), null, `must reject: ${String(bad)}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// I. THE Q_B ADVISORY IS NO LONGER INERT — signupPhoneHash
//
// The engine had the phone-mismatch path built and tested, and it never fired,
// because the request body carried only `connectToken` and there was nothing to
// compare against. Sending the hash is what switches it on. These tests exist
// because a hash the two sides compute DIFFERENTLY is worse than no hash: it
// would report a mismatch on every legitimate pairing and train everyone to
// ignore the signal.
// ─────────────────────────────────────────────────────────────────────────

/**
 * VECTORS PINNED FROM THE ENGINE'S ALGORITHM, not from ours.
 *
 * apps/engine/src/wa-connect-pairing.mjs:
 *   sha256Hex(s)    = createHash('sha256').update(String(s),'utf8').digest('hex')
 *   phoneHash(e164) = digits = e164.replace(/[^0-9]/g,''); 6..18 or null; sha256Hex(digits)
 * and phoneAdvisory compares that against sha256Hex(scannedExternalId), where an
 * external id for a phone address has ALREADY been reduced to bare digits by
 * normaliseWaJid (wa-jid.mjs) — no "+", no "@domain". The engine's own test
 * (test/wa-connect-pairing.test.mjs:314-316) asserts that
 * phoneHash('+1 603 999 3369') equals the hash of the scanned id '16039993369',
 * which is the vector reproduced first below.
 *
 * If any of these three change, our hash has stopped matching the engine's and
 * the advisory has started lying about real customers.
 */
const ENGINE_VECTORS = [
  ["+1 603 999 3369", "4d378c156fd9a9252a4fc3084ff70069a6a0de3735d2c703b21b2ab0cb760ce7"],
  ["+971501234567",   "b7a8f5085aa733eb29857a02945bc84a5227e693708d469ec9fb21d34e9e44f5"],
  ["+12025550147",    "924c782cf0b054ddd1b74d25dc44f444f6e8fff94f1c1f8e934dfb8ea45e8063"],
];

test("[Q_B] our signupPhoneHash reproduces the ENGINE's vectors exactly", async () => {
  const { signupPhoneHash } = await import("@/lib/signup-phone-hash");
  for (const [input, expected] of ENGINE_VECTORS) {
    assert.equal(signupPhoneHash(input), expected, `engine vector for ${input}`);
  }
});

test("[Q_B] the hash is of the DIGITS, so one person cannot become two identities", async () => {
  const { signupPhoneHash } = await import("@/lib/signup-phone-hash");
  const canonical = signupPhoneHash("+971501234567");
  for (const spelling of ["+971 50 123 4567", "+971-50-123-4567", "971501234567", " +971501234567 "]) {
    assert.equal(signupPhoneHash(spelling), canonical, `${spelling} is the same person`);
  }
  // And the engine's own bounds, so a value we hash is never one it treats as absent.
  for (const bad of ["abc", "", "12345", "+1234567890123456789", null, undefined, 12345]) {
    assert.equal(signupPhoneHash(bad), null, `${String(bad)} must be null, i.e. "send nothing"`);
  }
});

test("[Q_B] a real scanned account id hashes to the SAME value as the signup number", async () => {
  // This is the whole point of the feature, end to end. normaliseWaJid reduces
  // "12025550147@s.whatsapp.net" to the bare digits "12025550147"; the engine
  // then hashes THAT and compares it to our signupPhoneHash. So the two agree
  // only if we hash digits too — which is what this asserts.
  const { signupPhoneHash } = await import("@/lib/signup-phone-hash");
  const scannedExternalId = "12025550147"; // what normaliseWaJid yields for JID_US
  const engineScannedHash = createHash("sha256").update(scannedExternalId, "utf8").digest("hex");
  assert.equal(signupPhoneHash("+1 202 555 0147"), engineScannedHash,
    "a customer who signs up and scans with the SAME number must read as a MATCH");
});

test("[Q_B] the hash is SENT, and the number never is", async () => {
  const { token } = await seedViaBegin({ phone: RAW_PHONE });
  const seen = stubGateway();
  const { GET } = await start();
  await GET(startRequest(token));

  const { signupPhoneHash } = await import("@/lib/signup-phone-hash");
  assert.equal(seen[0].body.signupPhoneHash, signupPhoneHash(RAW_PHONE_E164));
  assert.match(seen[0].body.signupPhoneHash, /^[0-9a-f]{64}$/);

  const wire = JSON.stringify(seen[0].body);
  assert.ok(!wire.includes(RAW_PHONE_E164), "the E.164 number does not cross the boundary");
  assert.ok(!wire.includes("971501234567"), "nor its digits");
  assert.ok(!("phone" in seen[0].body), "the raw-phone fallback field is never used");
});

test("[Q_B] NULL MEANS SEND NOTHING — a record with no usable number omits the field", async () => {
  const { token } = await seedViaBegin();
  const rec = await store.getConnect(token);
  await store.putConnect({ ...rec, phone: undefined });

  const seen = stubGateway();
  const { GET } = await start();
  assert.equal((await GET(startRequest(token))).status, 302, "pairing still works without it");
  assert.ok(!("signupPhoneHash" in seen[0].body),
    "absent makes the engine say 'not comparable', which is TRUE; a bad hash would make it " +
    "report a mismatch about a real customer, which is a lie");
});

test("[Q_B] a wrongly-shaped hash is dropped rather than sent — a lying advisory is worse than none", async () => {
  const { pairRequestBody } = await import("@/lib/pair-gateway");
  for (const bad of ["", "not-hex", "ABCD".repeat(16), "a".repeat(63), "a".repeat(65), null, undefined]) {
    const body = pairRequestBody("tok", { signupPhoneHash: bad });
    assert.ok(!("signupPhoneHash" in body), `must not send ${String(bad)}`);
  }
  assert.equal(pairRequestBody("tok", { signupPhoneHash: "a".repeat(64) }).signupPhoneHash, "a".repeat(64));
});

test("[Q_B] IT STILL DOES NOT GATE — the owner's UAE-signup / US-scan case is untouched", async () => {
  // Belt and braces alongside the bind-side test: nothing on the REQUEST path
  // may refuse, delay or alter a pairing because the numbers differ.
  const { token } = await seedViaBegin({ phone: RAW_PHONE });   // UAE
  const seen = stubGateway();
  const { GET } = await start();
  const res = await GET(startRequest(token));

  assert.equal(res.status, 302, "a mismatch is not a refusal, on either side");
  assert.equal(res.headers.get("location"), GATEWAY_LINK);
  // We send the fact and take no view on it. There is no branch here to break.
  assert.match(seen[0].body.signupPhoneHash, /^[0-9a-f]{64}$/);
});

// ─────────────────────────────────────────────────────────────────────────
// J. plan AND expiresAt
// ─────────────────────────────────────────────────────────────────────────

test("the plan travels with the request, capped at the 64 chars the engine accepts", async () => {
  const { token } = await seedViaBegin({ plan: "companion" });
  const seen = stubGateway();
  const { GET } = await start();
  await GET(startRequest(token));
  assert.equal(seen[0].body.plan, "companion");

  const { pairRequestBody } = await import("@/lib/pair-gateway");
  assert.equal(pairRequestBody("t", { plan: "x".repeat(64) }).plan, "x".repeat(64));
  assert.ok(!("plan" in pairRequestBody("t", { plan: "x".repeat(65) })),
    "over the cap it would be silently truncated into a plan id that means nothing");
});

test("expiresAt is a CEILING derived from createdAt, and can only ever SHORTEN the engine's TTL", async () => {
  const { token } = await seedViaBegin();
  const rec = await store.getConnect(token);
  const seen = stubGateway();
  const { GET } = await start();
  await GET(startRequest(token));

  const asserted = Date.parse(seen[0].body.expiresAt);
  const created = Date.parse(rec.createdAt);
  assert.ok(Number.isFinite(asserted), "a real ISO-8601 instant");
  assert.equal(asserted - created, 7 * 24 * 3600 * 1000, "7 days from CREATION, the store's TTL");
  // Under-estimating is the safe direction: every putConnect refreshes the store
  // TTL, so the real expiry is >= this, and the engine takes the MINIMUM of its
  // own TTL and ours — so this can never extend the engine's window.
  assert.ok(asserted >= Date.now(), "and it is in the future for a fresh record");
});

test("an unparseable createdAt omits expiresAt rather than guessing a lifetime", async () => {
  const { token } = await seedViaBegin();
  const rec = await store.getConnect(token);
  await store.putConnect({ ...rec, createdAt: "not-a-date" });
  const seen = stubGateway();
  const { GET } = await start();
  assert.equal((await GET(startRequest(token))).status, 302);
  assert.ok(!("expiresAt" in seen[0].body), "the engine falls back to its own TTL");
});

test("DRIFT GUARD: the 7-day TTL mirrored in the route matches store.ts's putConnect", async () => {
  const routeSrc = await readFile(path.join(ROOT, "src/app/api/pair/start/route.ts"), "utf8");
  const storeSrc = await readFile(path.join(ROOT, "src/lib/store.ts"), "utf8");

  const mine = /const CONNECT_TTL_SECONDS = ([^;]+);/.exec(routeSrc);
  assert.ok(mine, "the route declares the TTL it mirrors");
  const theirs = /kvSet\(connectKey\(rec\.token\), rec, ([^)]+)\)/.exec(storeSrc);
  assert.ok(theirs, "putConnect's TTL argument found");

  const evalNum = (expr) => Function(`"use strict";return (${expr});`)();
  assert.equal(evalNum(mine[1]), evalNum(theirs[1]),
    "one copy was edited without the other; the asserted expiry would then be wrong");
});

// ─────────────────────────────────────────────────────────────────────────
// K. THE NEW GATEWAY STATUS CODES
//
// Every one of these is a REAL, EXPECTED answer. The previous revision of this
// client mapped 409 and 410 into a generic "http_error" (a 503 "our side isn't
// responding" page, which is a lie about all three) and logged ANY 400 as
// "the two sides are on different contracts", which is now only true for a 400
// that is NOT invalid_connect_token.
// ─────────────────────────────────────────────────────────────────────────

test("409 token_already_used gets its OWN honest page — the single-use rule, explained [Q_C]", async () => {
  const { token } = await seedViaBegin();
  stubGateway({ status: 409, body: { error: "token_already_used" } });
  const { GET } = await start();
  const res = await GET(startRequest(token));

  assert.equal(res.status, 409, "not 503: this is neither our fault nor a fault at all");
  const html = await res.text();
  assert.match(html, /already been used/i);
  assert.doesNotMatch(html, /isn't available right now/, "NOT the generic infrastructure page");
  // It describes the STATE, never the account: two people can land here and one
  // of them may not be the customer.
  assert.doesNotMatch(html, /whatsapp\.net|\+?\d{7,}/, "and names no account or number");
});

test("410 token_expired gets the SAME page as our own expiry — two clocks, one remedy", async () => {
  const { token } = await seedViaBegin();
  stubGateway({ status: 410, body: { error: "token_expired" } });
  const { GET } = await start();
  const viaEngine = await GET(startRequest(token));
  assert.equal(viaEngine.status, 410);
  const engineHtml = await viaEngine.text();

  // Our own record TTL, for comparison. The engine's clock is SHORTER than
  // ours, so this branch is reachable with a record that is still alive here.
  resetNet();
  stubGateway();
  const { token: dead } = await seedViaBegin({ phone: "050 900 1122" });
  await store.kvDel(`mira:connect:${dead}`);
  const { GET: GET2 } = await start();
  const viaStore = await GET2(startRequest(dead));

  assert.equal(viaStore.status, 410);
  assert.equal(engineHtml, await viaStore.text(), "byte-identical: same situation, same sentence");
});

test("400 invalid_connect_token gets the SAME page as a mangled link, and a loud operator log", async () => {
  const { token } = await seedViaBegin();
  const lines = await captureLogs(async () => {
    stubGateway({ status: 400, body: { error: "invalid_connect_token" } });
    const { GET } = await start();
    const res = await GET(startRequest(token));
    assert.equal(res.status, 400);
    assert.match(await res.text(), /doesn't look right/);
  });
  const all = lines.join("\n");
  assert.match(all, /disagree about the connect-token format/,
    "near-unreachable, so when it fires it must say why loudly");
  assert.ok(!all.includes(token), "and still never print the token");
});

test("400 with any OTHER error is the contract mismatch, and only that case says so", async () => {
  const { token } = await seedViaBegin();
  const lines = await captureLogs(async () => {
    stubGateway({ status: 400, body: { error: "connectToken or tenantId required" } });
    const { GET } = await start();
    const res = await GET(startRequest(token));
    assert.equal(res.status, 503, "an operator problem, so the customer gets the honest page");
    assert.match(await res.text(), /isn't available right now/);
  });
  assert.match(lines.join("\n"), /DIFFERENT CONTRACTS/);
});

test("the status codes are honoured even when the body is missing, empty or not JSON", async () => {
  const { token } = await seedViaBegin();
  for (const [reply, expected] of [
    [{ status: 409, body: undefined }, 409],
    [{ status: 410, body: undefined }, 410],
    [{ status: 409, body: { nonsense: true } }, 409],
    [{ status: 410, body: "<html>gateway is having a bad day</html>" }, 410],
    [{ status: 400, body: undefined }, 503],
    [{ status: 418, body: { error: "teapot" } }, 503],
  ]) {
    resetNet();
    stubGateway(reply);
    const { GET } = await start();
    const res = await GET(startRequest(token));
    assert.equal(res.status, expected, JSON.stringify(reply));
  }
});

test("a hostile error body cannot throw: a gigantic non-JSON body is read, capped and survived", async () => {
  const { token } = await seedViaBegin();
  stubGateway({ status: 500, body: "x".repeat(200000) });
  const { GET } = await start();
  assert.equal((await GET(startRequest(token))).status, 503, "a bad body is a value, never an exception");
});

// ─────────────────────────────────────────────────────────────────────────
// L. `resumed` — surfaced deliberately, not dropped silently [Q_C]
// ─────────────────────────────────────────────────────────────────────────

test("`resumed` is read from the gateway and LOGGED, true and false alike", async () => {
  const { token } = await seedViaBegin();
  for (const [value, expected] of [[true, "resumed=true"], [false, "resumed=false"]]) {
    resetNet();
    const lines = await captureLogs(async () => {
      stubGateway({ status: 200, body: { sessionId: SID, link: GATEWAY_LINK, resumed: value } });
      const { GET } = await start();
      assert.equal((await GET(startRequest(token))).status, 302);
    });
    assert.match(lines.join("\n"), new RegExp(expected),
      `resumed=${value} must reach the log — it is the only way to see from production ` +
      `that resumability works rather than merely being implemented`);
  }
});

test("a MISSING or non-boolean `resumed` is reported as unknown, never coerced to false", async () => {
  const { token } = await seedViaBegin();
  for (const body of [
    { sessionId: SID, link: GATEWAY_LINK },                    // an older gateway
    { sessionId: SID, link: GATEWAY_LINK, resumed: "true" },   // a string, not a boolean
    { sessionId: SID, link: GATEWAY_LINK, resumed: 1 },
    { sessionId: SID, link: GATEWAY_LINK, resumed: null },
  ]) {
    resetNet();
    const lines = await captureLogs(async () => {
      stubGateway({ status: 200, body });
      const { GET } = await start();
      assert.equal((await GET(startRequest(token))).status, 302, "and pairing still works");
    });
    assert.match(lines.join("\n"), /resumed=unknown/,
      "coercing an absent field to false would report 'nobody ever resumes' from a build " +
      "that simply does not say");
  }
});

test("`resumed` is NOT surfaced to the customer — one fact, one authority", async () => {
  const { token } = await seedViaBegin();
  stubGateway({ status: 200, body: { sessionId: SID, link: GATEWAY_LINK, resumed: true } });
  const { GET } = await start();
  const res = await GET(startRequest(token));

  // The redirect is byte-identical whether or not the session was resumed: the
  // pairing page is the gateway's and already knows. Re-deriving it here would
  // make two services the authority on one thing.
  assert.equal(res.headers.get("location"), GATEWAY_LINK, "no ?resumed= smuggled into the URL");
  assert.equal(await res.text(), "", "a 302 has no body to leak it into");
  for (const h of [...res.headers.keys()]) {
    assert.doesNotMatch(h, /resum/i, `no ${h} header`);
  }
});

test("the returning customer, end to end: same token, resumed session, same QR [Q_C]", async () => {
  const { token } = await seedViaBegin();
  // The gateway's real behaviour: first call opens, second resumes the same one.
  let calls = 0;
  stubGateway(() => {
    calls++;
    return new Response(
      JSON.stringify({ sessionId: SID, link: GATEWAY_LINK, resumed: calls > 1 }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });

  const { GET } = await start();
  const first = await GET(startRequest(token));
  const second = await GET(startRequest(token));

  assert.equal(first.status, 302);
  assert.equal(second.status, 302);
  assert.equal(first.headers.get("location"), second.headers.get("location"), "the SAME QR");
  // And still nothing was consumed on this side.
  const rec = await store.getConnect(token);
  assert.equal(rec.whatsappIdHash, undefined);
  assert.equal(rec.tenantId, undefined);
});

test("no log line carries the phone number, its hash preimage, or the token — including the new branches", async () => {
  const { token } = await seedViaBegin({ phone: RAW_PHONE });
  const lines = await captureLogs(async () => {
    for (const reply of [
      { status: 200, body: { sessionId: SID, link: GATEWAY_LINK, resumed: true } },
      { status: 409, body: { error: "token_already_used" } },
      { status: 410, body: { error: "token_expired" } },
      { status: 400, body: { error: "invalid_connect_token" } },
      { status: 400, body: { error: "connectToken or tenantId required" } },
    ]) {
      resetNet();
      stubGateway(reply);
      const { GET } = await start();
      await GET(startRequest(token));
    }
  });
  const all = lines.join("\n");
  for (const needle of [token, RAW_PHONE_E164, "971501234567", PAIR_KEY, GATEWAY_LINK]) {
    assert.ok(!all.includes(needle), `leaked: ${needle}\n${all}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// M. COUNTERFACTUALS for round two
// ─────────────────────────────────────────────────────────────────────────

test(`CF-8: at ${PRE} nothing computed a signup phone hash, so the Q_B advisory was INERT`, () => {
  assert.equal(showOrNull("src/lib/signup-phone-hash.ts"), null, "the module is new");
  mustFailAgainstOldCode("some pre-change file computes a signup phone hash", () => {
    const all = PRE_SRC.begin + PRE_SRC.connect + PRE_SRC.store + PRE_SRC.pairing;
    assert.match(all, /signupPhoneHash|phoneHash/);
  });
});

test("CF-9: the OLD status mapping would have answered 503 to all three new codes", async () => {
  // The previous revision of this client had no 409/410 branch and no body
  // inspection, so every one of these fell through to `http_error` -> the
  // generic 503 page. Reproduced here as the OLD rule, and required to differ
  // from what the shipped route now does. If these ever agree again, the new
  // mapping has been lost.
  const oldMapping = (status) => (status === 401 || status === 403 || status === 429 ? status : 503);
  const { token } = await seedViaBegin();

  for (const [status, code] of [[409, "token_already_used"], [410, "token_expired"], [400, "invalid_connect_token"]]) {
    resetNet();
    stubGateway({ status, body: { error: code } });
    const { GET } = await start();
    const now = (await GET(startRequest(token))).status;
    assert.equal(now, status, `${code} is passed through honestly`);
    assert.notEqual(now, oldMapping(status),
      `${code} must no longer collapse into the generic ${oldMapping(status)}`);
  }
});

test("CF-10: sending nothing would leave the advisory inert — the field is genuinely on the wire", async () => {
  const { token } = await seedViaBegin({ phone: RAW_PHONE });
  const seen = stubGateway();
  const { GET } = await start();
  await GET(startRequest(token));
  // The inert state was: a body of exactly { connectToken }. Requiring the body
  // to be LARGER than that is what makes "we switched it on" checkable.
  assert.notDeepEqual(seen[0].body, { connectToken: token },
    "a body of only connectToken is the inert state this change exists to end");
  assert.ok(seen[0].body.signupPhoneHash, "and the advisory has something to compare");
});
