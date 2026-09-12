// Assistant reliability — probe tests.
//
// NO NETWORK. Every probe takes an injected fetchImpl, an injected clock and an
// explicit nowMs, so latency and timing are deterministic and nothing here
// depends on a live service.

import test from "node:test";
import assert from "node:assert/strict";
import {
  probeHttp,
  probeAssistant,
  probeInference,
  probeWhatsApp,
  summarise,
  probeOpenRouterKey,
  creditWarning,
} from "../ops/reliability/probes.mjs";

function fakeFetch(status, bodyText) {
  return async () => ({ status, text: async () => bodyText });
}

function failingFetch(err) {
  return async () => {
    throw err;
  };
}

/** Deterministic latency: first call 0, second 42, so latencyMs is always 42. */
function steppingClock(steps) {
  let i = 0;
  return () => steps[Math.min(i++, steps.length - 1)];
}

const OPTS = (fetchImpl, extra) => ({
  fetchImpl,
  nowMs: 1000,
  clock: steppingClock([0, 42]),
  ...extra,
});

const URL_ = "https://example.test";

/* ── probeHttp ─────────────────────────────────────────────────────────── */

test("probeHttp: a 200 is ok and records latency", async () => {
  const r = await probeHttp(URL_, OPTS(fakeFetch(200, "hi")));
  assert.equal(r.ok, true, "a 2xx is ok");
  assert.equal(r.atMs, 1000, "atMs is the caller's clock, not a hidden one");
  assert.equal(r.latencyMs, 42, "latency comes from the injected clock");
  assert.equal(r.error, null, "a success carries no error");
  assert.equal(r.detail.status, 200, "detail records the status");
});

test("probeHttp: a 500 is not ok and names the status", async () => {
  const r = await probeHttp(URL_, OPTS(fakeFetch(500, "error")));
  assert.equal(r.ok, false, "a 5xx is not healthy");
  assert.ok(r.error.includes("500"), `the error should name the status, got: ${r.error}`);
});

test("probeHttp: a thrown error is captured, not raised", async () => {
  const r = await probeHttp(URL_, OPTS(failingFetch(new Error("boom"))));
  assert.equal(r.ok, false, "a thrown error is a failed probe");
  assert.equal(r.error, "boom", "a probe must never throw — it runs on a timer");
});

test("probeHttp: an AbortError is reported as a timeout", async () => {
  const err = new Error("aborted");
  err.name = "AbortError";
  const r = await probeHttp(URL_, OPTS(failingFetch(err)));
  assert.equal(r.error, "timeout", "an abort is a timeout, not a generic error");
});

/* ── probeAssistant ────────────────────────────────────────────────────── */

test("probeAssistant: a real reply is healthy", async () => {
  const body = JSON.stringify({ reply: "Hello there", trialGate: false });
  const r = await probeAssistant(URL_, OPTS(fakeFetch(200, body)));
  assert.equal(r.ok, true, "a non-empty reply is healthy");
  assert.equal(r.detail.replyLength, 11, "detail records the length, never the text");
  assert.equal(
    r.detail.usedFallbackShape,
    true,
    "trialGate being PRESENT is the signal the real route answered — its value is irrelevant",
  );
});

test("probeAssistant: a reply without trialGate still passes but flags the shape", async () => {
  const r = await probeAssistant(URL_, OPTS(fakeFetch(200, JSON.stringify({ reply: "hi" }))));
  assert.equal(r.ok, true, "a reply with no trialGate key is still a reply");
  assert.equal(r.detail.usedFallbackShape, false, "no trialGate key means the shape is unrecognised");
});

test("probeAssistant: THE HEALTH-PROBE HEADER IS ALWAYS SENT", async () => {
  let seen = null;
  const capturing = async (_url, init) => {
    seen = init.headers;
    return { status: 200, text: async () => JSON.stringify({ reply: "hi", trialGate: false }) };
  };
  await probeAssistant(URL_, OPTS(capturing));
  assert.equal(
    seen["x-mira-health-probe"],
    "1",
    "without this header every probe spends a customer LLM call; ~1900 a day would consume nearly the whole daily cap and starve real visitors",
  );
});

test("probeAssistant: AN EXACT ECHO IS NOT REQUIRED", async () => {
  const body = JSON.stringify({ reply: "I can tell you about Mira's plans.", trialGate: false });
  const r = await probeAssistant(URL_, OPTS(fakeFetch(200, body)));
  assert.equal(
    r.ok,
    true,
    "demanding the literal ASSISTANT_HEALTH_OK would report a working persona assistant as broken",
  );
});

test("probeAssistant: an empty reply is unhealthy", async () => {
  for (const body of [JSON.stringify({ reply: "" }), JSON.stringify({}), "<html>oops</html>"]) {
    const r = await probeAssistant(URL_, OPTS(fakeFetch(200, body)));
    assert.equal(r.ok, false, `body ${body.slice(0, 20)} must be unhealthy`);
    assert.equal(r.error, "empty reply", "a missing or empty reply is the same failure");
  }
});

/* ── probeInference ────────────────────────────────────────────────────── */

test("probeInference: a completion with content is healthy", async () => {
  const body = JSON.stringify({ choices: [{ message: { content: "OK" } }] });
  const r = await probeInference(URL_, "test-model", OPTS(fakeFetch(200, body)));
  assert.equal(r.ok, true, "a non-empty completion is healthy");
  assert.equal(r.detail.contentLength, 2, "detail records the length");
  assert.equal(r.detail.model, "test-model", "detail records which model answered");
});

test("probeInference: THE CONTENT IS NEVER RECORDED", async () => {
  const secret = "SENSITIVE-MODEL-OUTPUT";
  const body = JSON.stringify({ choices: [{ message: { content: secret } }] });
  const r = await probeInference(URL_, "test-model", OPTS(fakeFetch(200, body)));
  assert.ok(
    !JSON.stringify(r.detail).includes(secret),
    "a probe must never log model output — only its length",
  );
});

test("probeInference: an empty completion is unhealthy", async () => {
  for (const body of [
    JSON.stringify({ choices: [] }),
    JSON.stringify({ choices: [{ message: {} }] }),
  ]) {
    const r = await probeInference(URL_, "test-model", OPTS(fakeFetch(200, body)));
    assert.equal(r.ok, false, "a completion with no content is not healthy");
    assert.equal(r.error, "empty completion", "the error names the shape problem");
  }
});

/* ── probeWhatsApp ─────────────────────────────────────────────────────── */

test("probeWhatsApp: linked above zero is healthy", async () => {
  const body = JSON.stringify({ ok: true, linked: 2, total: 3, pending: 1, stale: 0 });
  const r = await probeWhatsApp(URL_, OPTS(fakeFetch(200, body)));
  assert.equal(r.ok, true, "at least one linked device is healthy");
  assert.equal(r.detail.linked, 2, "detail carries the linked count");
});

test("probeWhatsApp: THE 503 BODY IS STILL PARSED", async () => {
  const body = JSON.stringify({ ok: false, linked: 0, total: 3, pending: 3, stale: 0 });
  const r = await probeWhatsApp(URL_, OPTS(fakeFetch(503, body)));
  assert.equal(r.ok, false, "zero linked devices is not healthy");
  assert.equal(r.error, "no linked devices", "the error names the actual condition");
  assert.equal(
    r.detail.total,
    3,
    "the gateway signals unhealth with a 503 while still returning counts — treating non-200 as unreachable would discard the number that identified a four-day outage",
  );
});

test("probeWhatsApp: an unparseable body is reported cleanly", async () => {
  const r = await probeWhatsApp(URL_, OPTS(fakeFetch(200, "not json")));
  assert.equal(r.ok, false, "a non-JSON body is not healthy");
  assert.equal(r.error, "unparseable body", "it reports cleanly rather than throwing");
});

/* ── summarise ─────────────────────────────────────────────────────────── */

test("summarise reports failures and the worst latency", async () => {
  const s = summarise({ a: { ok: true, latencyMs: 10 }, b: { ok: false, latencyMs: 90 } });
  assert.equal(s.allOk, false, "one failure means not all ok");
  assert.deepStrictEqual(s.failed, ["b"], "the failing probe is named");
  assert.equal(s.worstLatencyMs, 90, "the worst latency is reported, not the average");
});

test("summarise is defensive", async () => {
  const n = summarise(null);
  assert.equal(n.allOk, true, "null must not throw");
  assert.deepStrictEqual(n.failed, [], "null yields no failures");
  assert.equal(summarise(undefined).allOk, true, "undefined must not throw");
  assert.equal(summarise("string").allOk, true, "a non-object must not throw");
  assert.equal(summarise({ a: "not a result" }).allOk, true, "a malformed entry is skipped, not fatal");
});

/* ── the paid provider: key and credit, never generation ───────────────── */

const keyBody = (over = {}) =>
  JSON.stringify({ data: { label: "sk-my-personal-key-for-mira", usage: 4, limit: 10, is_free_tier: false, ...over } });

test("PROBING THE PROVIDER COSTS NOTHING — it never generates", async () => {
  let seenInit = null;
  const capturing = async (url, init) => {
    seenInit = { url, init };
    return { status: 200, text: async () => keyBody() };
  };
  const r = await probeOpenRouterKey("https://openrouter.ai/api/v1", "sk-test", OPTS(capturing));

  assert.equal(r.ok, true, "a valid key with credit is healthy");
  assert.equal(seenInit.init.method, "GET", "a GET, not a completion");
  assert.ok(
    !/chat\/completions/.test(seenInit.url),
    "a generation probe at the healthy interval would bill ~1900 times a day, and monitoring that costs a fraction of what it monitors gets switched off",
  );
});

test("THE KEY AND THE LABEL NEVER REACH THE DETAIL", async () => {
  const r = await probeOpenRouterKey("https://openrouter.ai/api/v1", "sk-live-SECRET-VALUE", OPTS(fakeFetch(200, keyBody())));
  const serialised = JSON.stringify(r.detail);
  assert.ok(!serialised.includes("sk-live-SECRET-VALUE"), "the key must never be logged");
  assert.ok(!serialised.includes("SECRET"), "nor any part of it");
  assert.ok(
    !serialised.includes("sk-my-personal-key-for-mira"),
    "nor the label — it is a human-chosen key name and has been known to carry identifying text",
  );
  assert.equal(r.detail.remaining, 6, "while the number that matters is kept");
});

test("EXHAUSTED CREDIT IS AN OUTAGE, NOT A 200", async () => {
  const r = await probeOpenRouterKey("https://x/v1", "sk-test", OPTS(fakeFetch(200, keyBody({ usage: 10, limit: 10 }))));
  assert.equal(
    r.ok,
    false,
    "the provider answers 200 right up until the credit is gone — treating that as healthy is exactly the silent failure this subsystem exists to end",
  );
  assert.equal(r.error, "credit exhausted", "and it is named");
  assert.equal(r.detail.remaining, 0, "with the figure an operator needs");
});

test("an unlimited budget is not an exhausted one", async () => {
  const r = await probeOpenRouterKey("https://x/v1", "sk-test", OPTS(fakeFetch(200, keyBody({ limit: null }))));
  assert.equal(r.ok, true, "a null limit means unlimited");
  assert.equal(r.detail.remaining, null, "which is unknown remaining, not zero remaining");
});

test("a revoked key is distinguished from an outage", async () => {
  for (const status of [401, 403]) {
    const r = await probeOpenRouterKey("https://x/v1", "sk-test", OPTS(fakeFetch(status, "{}")));
    assert.equal(r.ok, false, `${status} is not healthy`);
    assert.equal(r.error, "invalid key", "our credential, not their outage — different people fix those");
  }
  const down = await probeOpenRouterKey("https://x/v1", "sk-test", OPTS(fakeFetch(503, "{}")));
  assert.equal(down.error, "http 503", "whereas a 503 is theirs");
});

test("A MISSING KEY BLAMES OUR CONFIG, NOT THE PROVIDER", async () => {
  let called = false;
  const spy = async () => {
    called = true;
    return { status: 200, text: async () => keyBody() };
  };
  for (const key of [undefined, null, "", 5]) {
    const r = await probeOpenRouterKey("https://x/v1", key, OPTS(spy));
    assert.equal(r.error, "no api key", `${String(key)} is our own missing configuration`);
  }
  assert.equal(
    called,
    false,
    "and no request is made — reporting the PROVIDER broken would send somebody to investigate the wrong system",
  );
});

test("probeOpenRouterKey never throws", async () => {
  const boom = await probeOpenRouterKey("https://x/v1", "sk-test", OPTS(failingFetch(new Error("dns"))));
  assert.equal(boom.ok, false, "a network failure is a failed probe");
  assert.equal(boom.error, "dns", "not an exception out of a timer");

  const junk = await probeOpenRouterKey("https://x/v1", "sk-test", OPTS(fakeFetch(200, "not json")));
  assert.equal(junk.error, "unparseable body", "and a garbage body is reported cleanly");
});

/* ── the warning that gets a human to act before it stops ──────────────── */

test("CREDIT RUNNING LOW WARNS BEFORE IT RUNS OUT", async () => {
  assert.equal(creditWarning({ remaining: 5 }), null, "plenty left is not news");
  const low = creditWarning({ remaining: 1 });
  assert.equal(low.severity, "high", "nearly gone is worth waking someone for");
  const gone = creditWarning({ remaining: 0 });
  assert.equal(gone.severity, "critical", "gone is worse");
  assert.ok(
    /knowledge base/i.test(gone.detail),
    "and it says what the customer actually experiences, not just a number",
  );
});

test("AN UNKNOWN BUDGET IS NOT A WARNING", () => {
  for (const detail of [null, undefined, "nope", 5, {}, { remaining: null }, { remaining: NaN }, { remaining: "3" }]) {
    assert.equal(
      creditWarning(detail),
      null,
      `${JSON.stringify(detail)} must not warn — crying wolf about an unlimited or unknown budget teaches people to ignore the alert that matters`,
    );
  }
});
