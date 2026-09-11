/**
 * The support widget must never claim an action it did not perform.
 *
 * WHY THIS FILE EXISTS. Until 2026-09-06, POST /api/support answered anyone
 * who typed "refund" with: "I've logged your request, and you'll see it back
 * on your original payment method within 5-10 business days." The route has no
 * database, no mail transport and no payment call. Nothing was logged and no
 * refund was ever initiated. It is mounted by src/components/site-chrome.tsx
 * on every public corporate page of a site that takes real card payments, so
 * that sentence was live to every visitor.
 *
 * These are REGRESSION tests, not descriptions. They do not care how the copy
 * is worded. They assert one property: no reply, on any input, in either the
 * signed-in or the signed-out branch, tells the customer that something has
 * happened or will happen on its own. Rewrite the copy freely; if a promise
 * comes back, these fail.
 *
 * Run: node --test scripts/support-promises-test.mjs   (or npm test)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadRoute, jsonRequest, readJson } from "./route-harness/index.mjs";

/** Every input that reaches a distinct branch of the route, plus the fallback. */
const PROBES = [
  "I want a refund please",
  "you charged me twice",
  "i want my money back",
  "how do I cancel my subscription",
  "please unsubscribe me",
  "send me my invoice",
  "I need to update my payment method",
  "the app is broken and throws an error",
  "everything is down",
  "hello, are you there?",
  "",
];

/**
 * Claims of a completed or automatic future action. Deliberately phrased as
 * the CLAIM rather than the old sentence, so a reworded promise still trips.
 */
const PROMISES = [
  /\bI(?:'ve| have)\s+(?:logged|recorded|sent|raised|filed|escalated|submitted|processed|refunded|cancelled|canceled)\b/i,
  /\bI(?:'ll| will)\s+(?:log|record|send|raise|file|escalate|submit|process|refund|cancel|pass|forward|get)\b/i,
  /\byou(?:'ll| will)\s+(?:see|receive|get)\b/i,
  /\bbusiness days\b/i,
  /\bwithin \d+\s*[-\u2013]?\s*\d*\s*(?:hours|days|weeks)\b/i,
  /\bI can\s+(?:pull|fetch|update|change|issue|process)\b/i,
  /\bhas been (?:logged|sent|raised|submitted|processed)\b/i,
];

/** Only claim a destination the app really serves. */
const REAL_PATHS = ["/mira/account", "/contact"];

async function reply(message) {
  const { POST } = await loadRoute("src/app/api/support/route.ts", { fresh: true });
  const { body } = await readJson(await POST(jsonRequest({ message })));
  assert.equal(typeof body.reply, "string", `no reply string for: ${JSON.stringify(message)}`);
  return body.reply;
}

test("no reply claims an action was taken or will happen automatically", async () => {
  for (const probe of PROBES) {
    const text = await reply(probe);
    for (const promise of PROMISES) {
      assert.doesNotMatch(
        text,
        promise,
        `"${probe}" produced a promise the route cannot keep (${promise}):\n  ${text}`,
      );
    }
  }
});

test("no reply invents a destination the app does not serve", async () => {
  for (const probe of PROBES) {
    const text = await reply(probe);
    for (const found of text.match(/\/[a-z0-9][a-z0-9/_-]*/gi) ?? []) {
      assert.ok(
        REAL_PATHS.some((p) => found === p || found.startsWith(p + "/")),
        `"${probe}" pointed at ${found}, which is not a path this app serves:\n  ${text}`,
      );
    }
  }
});

test("the old refund lie specifically cannot come back", async () => {
  const text = await reply("I would like a refund");
  assert.doesNotMatch(text, /logged your request/i);
  assert.doesNotMatch(text, /original payment method/i);
  assert.doesNotMatch(text, /5\s*[-\u2013]\s*10/);
});

test("a signed-out caller still gets a usable answer, never a bare error", async () => {
  // cs-bot.tsx renders a non-OK response as "Sorry, something went wrong", so
  // gating this route behind a 401 would silently break the widget for exactly
  // the visitors most likely to be using it.
  const { POST } = await loadRoute("src/app/api/support/route.ts", { fresh: true });
  const res = await POST(jsonRequest({ message: "I want a refund" }));
  assert.equal(res.status, 200, "the support route must answer 200 without a session");
  const { body } = await readJson(res);
  assert.ok(body.reply.length > 20, "a signed-out caller deserves a real answer, not a stub");
});

test("the refund answer routes to the page that actually carries the button", async () => {
  const text = await reply("can I get a refund");
  assert.match(text, /\/mira\/account/, "the refund path is the account page");
  assert.match(text, /review|person|human/i, "a refund is a request a person reviews, and must read that way");
});
