// Jury #107, constraint 3: the customer-service bot may READ a customer's own
// order and FILE their refund reason. It may NEVER adjudicate that reason.
//
// These tests exist because that boundary is easy to erode one helpful-sounding
// field at a time ("just a confidence score for the reviewer"). So they assert
// it two ways:
//   - BEHAVIOURALLY, by running the real code with injected fakes: the exact key
//     set of a refund context, the reason carried word for word, and the guards
//     throwing when a judgement field or an internal id is smuggled through.
//   - STRUCTURALLY, by source-scanning the shipped files: the route reads no
//     identifier from the request, and no scoring function exists at all.
//
// No env, no network, no store, no live payment provider.
//
// Run: node --test scripts/support-core-test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  summariseOrderForCustomer,
  refundContext,
  assertNeutralContext,
  assertNoInternals,
  friendlyDate,
  REFUND_CONTEXT_KEYS,
} from "../src/lib/support-core.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => readFileSync(join(root, ...p), "utf8");

const routeSrc = read("src", "app", "api", "support", "order-status", "route.ts");
const coreSrc = read("src", "lib", "support-core.mjs");
const pageSrc = read("src", "app", "mira", "account", "page.tsx");
const tiersSrc = read("src", "app", "mira", "_components", "tiers.ts");

// Prose that MENTIONS a thing is not a call to it. We judge executable code.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const routeCode = stripComments(routeSrc);
const coreCode = stripComments(coreSrc);
const pageCode = stripComments(pageSrc);

/** The plan features the account page paints under "What that includes", pulled
 *  from the same tier file the page imports — so this test breaks if that copy
 *  ever starts naming our plumbing. */
const tierItems = [...tiersSrc.matchAll(/items:\s*\[([^\]]*)\]/g)].flatMap((m) =>
  [...m[1].matchAll(/"([^"]*)"/g)].map((s) => s[1]),
);

/** Names a customer must never be shown. Same list section 2 holds the summary
 *  to, reused so the UI cannot drift away from the core's promise. */
const BANNED_WORDS = [
  "dodo",
  "stripe",
  "upstash",
  "redis",
  "vercel",
  "hetzner",
  "nginx",
  "openrouter",
  "anthropic",
  "claude",
  "webhook",
  "api key",
  "endpoint",
  "database",
  "cus_",
  "sub_",
  "pdt_",
];

// ---------------------------------------------------------------- fixtures --
// Injected fakes only: plain records shaped like store.ts's ConnectRecord, and a
// frozen clock. Nothing here touches Upstash, a file store, or a provider.

const FIXED_NOW = () => new Date("2026-08-05T09:30:00.000Z");

/** An active customer, with every internal identifier populated on purpose —
 *  if the summary can leak, this record makes it leak. */
const activeRec = {
  token: "tok_2f9d41c6aa5e4b12",
  plan: "assistant",
  email: "customer@example.com",
  status: "active",
  customerId: "cus_9XvQ2LmT",
  subscriptionId: "sub_0NkKvaOqLD7rJcoq",
  telegramId: 748193355,
  createdAt: "2026-03-14T08:02:11.000Z",
};

const cancelledRec = { ...activeRec, status: "cancelled", plan: "studio" };
const pendingRec = { ...activeRec, status: "pending", plan: "companion" };
const boundRec = { ...activeRec, status: "bound" };
const weirdRec = { ...activeRec, status: "half_migrated_2019" };

// ============================================================================
// 1. THE SUMMARY SPEAKS PLAINLY
// ============================================================================

test("the summary names the plan in plain language", () => {
  const s = summariseOrderForCustomer(activeRec);
  assert.equal(s.found, true);
  assert.equal(s.planLabel, "Assistant");
  assert.match(s.text, /Assistant plan/);
  assert.doesNotMatch(s.text, /\bassistant\b/, "the slug must not leak; the label is what they read");
});

test("the summary states the status in plain language", () => {
  const s = summariseOrderForCustomer(activeRec);
  assert.equal(s.statusLabel, "Active");
  assert.match(s.text, /active right now/i);
});

test("an active plan is told exactly what cancelling would cost them", () => {
  const s = summariseOrderForCustomer(activeRec);
  assert.match(s.cancelLine, /cancel/i);
  assert.match(s.cancelLine, /keep everything you've already paid for/i);
  assert.match(s.cancelLine, /no charge after that/i);
});

test("a cancelled plan is told plainly that billing has stopped", () => {
  const s = summariseOrderForCustomer(cancelledRec);
  assert.equal(s.planLabel, "Studio");
  assert.equal(s.statusLabel, "Cancelled");
  assert.match(s.text, /nothing more will be charged/i);
  assert.match(s.text, /until the end of the period you already paid for/i);
});

test("a pending order is told nothing has been charged — no false alarm", () => {
  const s = summariseOrderForCustomer(pendingRec);
  assert.equal(s.planLabel, "Companion");
  assert.match(s.text, /nothing has been charged/i);
  assert.match(s.cancelLine, /nothing to cancel/i);
});

test("a bound order says what it is actually waiting on", () => {
  const s = summariseOrderForCustomer(boundRec);
  assert.equal(s.statusLabel, "Almost there");
  assert.match(s.text, /waiting on the payment/i);
});

test("an unrecognised status is admitted, never guessed at", () => {
  const s = summariseOrderForCustomer(weirdRec);
  assert.equal(s.statusLabel, "Unknown");
  assert.match(s.text, /can't tell you its exact state/i);
  assert.match(s.text, /person/i, "an honest unknown must route to a human");
  assert.doesNotMatch(s.text, /half_migrated_2019/, "the raw status string must not be shown");
});

test("no record at all is answered warmly, not with a dead end", () => {
  const s = summariseOrderForCustomer(null);
  assert.equal(s.found, false);
  assert.match(s.text, /can't see a plan on this account/i);
  assert.match(s.text, /person/i);
  assert.doesNotMatch(s.text, /error|invalid|failed/i, "no machine voice at a confused customer");
});

test("the join date is rendered warmly and deterministically", () => {
  assert.equal(friendlyDate("2026-03-14T08:02:11.000Z"), "14 March 2026");
  assert.equal(friendlyDate("nonsense"), "");
  assert.equal(friendlyDate(undefined), "");
  assert.match(summariseOrderForCustomer(activeRec).sinceLine, /since 14 March 2026/);
});

// ============================================================================
// 2. THE SUMMARY LEAKS NOTHING  (scan the output string)
// ============================================================================

test("the summary NEVER contains an internal identifier from the record", () => {
  for (const rec of [activeRec, cancelledRec, pendingRec, boundRec, weirdRec]) {
    const blob = JSON.stringify(summariseOrderForCustomer(rec));
    for (const secret of [rec.customerId, rec.subscriptionId, rec.token, String(rec.telegramId)]) {
      assert.ok(!blob.includes(secret), `leaked "${secret}" to the customer`);
    }
  }
});

test("the summary NEVER names a provider, a vendor, or infrastructure", () => {
  const banned = [
    "dodo",
    "stripe",
    "upstash",
    "redis",
    "vercel",
    "hetzner",
    "nginx",
    "openrouter",
    "anthropic",
    "claude",
    "webhook",
    "api key",
    "endpoint",
    "database",
    "cus_",
    "sub_",
    "pdt_",
  ];
  for (const rec of [activeRec, cancelledRec, pendingRec, boundRec, weirdRec, null]) {
    const blob = JSON.stringify(summariseOrderForCustomer(rec)).toLowerCase();
    for (const word of banned) {
      assert.ok(!blob.includes(word), `customer copy mentioned "${word}"`);
    }
  }
});

test("the leak guard THROWS rather than letting an id through", () => {
  // Simulates a future edit that helpfully "includes the reference number".
  assert.throws(
    () =>
      assertNoInternals(
        { found: true, text: `Your reference is ${activeRec.subscriptionId}.` },
        activeRec,
      ),
    /internal identifier/,
  );
  assert.throws(
    () => assertNoInternals({ found: true, text: "Your Stripe plan renews soon." }, activeRec),
    /name internals/,
  );
});

// ============================================================================
// 3. THE REFUND CONTEXT IS EVIDENCE, NOT A VERDICT
// ============================================================================

test("refundContext has EXACTLY the agreed key set — nothing rides along", () => {
  const ctx = refundContext(activeRec, "it charged me twice", { now: FIXED_NOW });
  assert.deepEqual(Object.keys(ctx).sort(), [...REFUND_CONTEXT_KEYS].sort());
  assert.deepEqual(Object.keys(ctx).sort(), [
    "plan",
    "planLabel",
    "preparedAt",
    "reasonVerbatim",
    "startedAt",
    "status",
    "statusLabel",
  ]);
});

test("refundContext contains NO judgement, score, or recommendation field", () => {
  const ctx = refundContext(activeRec, "it charged me twice", { now: FIXED_NOW });
  const judgement =
    /score|rating|rank|risk|legit|fraud|abus|suspic|credib|trust|recommend|verdict|judg|confidence|likelihood|probab|assess|approve|reject|deny|decision|eligib|valid|flag|priority|severity|sentiment/i;
  for (const key of Object.keys(ctx)) {
    assert.doesNotMatch(key, judgement, `"${key}" is an adjudication field`);
  }
});

test("refundContext carries the customer's reason VERBATIM", () => {
  const reason = "  I was charged TWICE on the 3rd — see my bank statement!!  ";
  const ctx = refundContext(activeRec, reason, { now: FIXED_NOW });
  assert.equal(ctx.reasonVerbatim, reason, "not trimmed, not re-cased, not rewritten");
});

test("a long or messy reason is not truncated or cleaned up", () => {
  const reason = "x".repeat(5000) + "\n\nsecond paragraph\t<b>bold</b>";
  const ctx = refundContext(activeRec, reason, { now: FIXED_NOW });
  assert.equal(ctx.reasonVerbatim, reason);
  assert.equal(ctx.reasonVerbatim.length, reason.length);
});

test("an angry or accusatory reason reaches the human completely unaltered", () => {
  // The exact case the jury cared about: the bot must not soften, score, or
  // rebut this. It hands it over.
  const reason = "this is a scam, you stole my money and the bot lied to me";
  const ctx = refundContext(activeRec, reason, { now: FIXED_NOW });
  assert.equal(ctx.reasonVerbatim, reason);
  assert.deepEqual(Object.keys(ctx).sort(), [...REFUND_CONTEXT_KEYS].sort());
});

test("a missing reason is an empty string, never an inference about the customer", () => {
  for (const input of [undefined, null, 0, {}, []]) {
    const ctx = refundContext(activeRec, input, { now: FIXED_NOW });
    assert.equal(ctx.reasonVerbatim, "");
  }
});

test("refundContext reports only facts drawn from the record", () => {
  const ctx = refundContext(activeRec, "double charge", { now: FIXED_NOW });
  assert.equal(ctx.plan, "assistant");
  assert.equal(ctx.planLabel, "Assistant");
  assert.equal(ctx.status, "active");
  assert.equal(ctx.statusLabel, "Active");
  assert.equal(ctx.startedAt, "2026-03-14T08:02:11.000Z");
  assert.equal(ctx.preparedAt, "2026-08-05T09:30:00.000Z", "the clock is injected, not read");
});

test("refundContext still files a request when there is no record to attach", () => {
  const ctx = refundContext(null, "I never meant to subscribe", { now: FIXED_NOW });
  assert.equal(ctx.plan, "unknown");
  assert.equal(ctx.status, "unknown");
  assert.equal(ctx.startedAt, null);
  assert.equal(ctx.reasonVerbatim, "I never meant to subscribe");
});

test("refundContext leaks no internal identifier into the human's bundle either", () => {
  const blob = JSON.stringify(refundContext(activeRec, "double charge", { now: FIXED_NOW }));
  for (const secret of [activeRec.customerId, activeRec.subscriptionId, activeRec.token]) {
    assert.ok(!blob.includes(secret));
  }
});

// ============================================================================
// 4. THE BOUNDARY IS A GUARD THAT THROWS, NOT A FLAG THAT FLIPS
// ============================================================================

test("adding a judgement field to a context THROWS at runtime", () => {
  assert.throws(
    () =>
      assertNeutralContext({
        plan: "assistant",
        planLabel: "Assistant",
        status: "active",
        statusLabel: "Active",
        startedAt: null,
        reasonVerbatim: "double charge",
        fraudScore: 0.87,
      }),
    /judgement field/,
  );
});

test("even a politely named recommendation field THROWS", () => {
  for (const key of ["recommendation", "credibility", "riskLevel", "eligible", "reviewerVerdict"]) {
    assert.throws(
      () => assertNeutralContext({ [key]: "anything" }),
      /judgement field/,
      `"${key}" must be rejected`,
    );
  }
});

test("any extra field at all THROWS — the bundle shape is closed", () => {
  assert.throws(
    () =>
      assertNeutralContext({
        plan: "assistant",
        planLabel: "Assistant",
        status: "active",
        statusLabel: "Active",
        startedAt: null,
        reasonVerbatim: "double charge",
        preparedAt: "2026-08-05T09:30:00.000Z",
        internalNote: "seen this customer before",
      }),
    /must be exactly/,
  );
});

// ============================================================================
// 5. SOURCE SCAN — THE ROUTE READS NO IDENTIFIER FROM THE REQUEST
// ============================================================================

test("the route handler takes NO request parameter — there is nothing to tamper with", () => {
  assert.match(routeCode, /export async function GET\(\)/, "GET must take no request parameter");
  assert.doesNotMatch(routeCode, /function GET\(\s*(req|request|_req)/);
});

test("the route reads no identifier from body, query, headers, or params", () => {
  for (const forbidden of [
    /req\.json\(/,
    /request\.json\(/,
    /searchParams/,
    /nextUrl/,
    /new URL\(/,
    /\bheaders\(\)/,
    /params\./,
    /body\.(customerId|customer_id|subscriptionId|subscription_id|email|token)/,
  ]) {
    assert.doesNotMatch(routeCode, forbidden, `route must not read ${forbidden}`);
  }
});

test("the route resolves the order ONLY from the verified session email", () => {
  assert.match(routeCode, /getSession\(\)/);
  assert.match(routeCode, /getSubscriptionByEmail\(\s*session\.email\s*\)/);
});

test("the route refuses an unauthenticated caller", () => {
  assert.match(routeCode, /not_signed_in/);
  assert.match(routeCode, /status:\s*401/);
});

test("the route returns only the customer-safe summary — never the raw record", () => {
  assert.doesNotMatch(routeCode, /customerId/, "customerId must never be serialised out");
  assert.doesNotMatch(routeCode, /subscriptionId/);
  assert.doesNotMatch(routeCode, /\.\.\.rec\b/, "the record must never be spread into the response");
  assert.doesNotMatch(routeCode, /\.\.\.found\b/);
  assert.match(routeCode, /summariseOrderForCustomer\(/);
});

test("the route never acts on the plan and never reaches the payment provider", () => {
  assert.doesNotMatch(routeCode, /from "@\/lib\/dodo"/);
  assert.doesNotMatch(routeCode, /cancelDodoSubscription|refundDodoPayment|putSubscription/);
  assert.doesNotMatch(routeCode, /export async function (POST|PATCH|DELETE|PUT)/, "read-only route");
});

// ============================================================================
// 6. SOURCE SCAN — NO SCORING FUNCTION EXISTS TO BE CALLED
// ============================================================================

test("support-core declares NO legitimacy-scoring function of any kind", () => {
  const declared = [...coreCode.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  assert.ok(declared.length > 0, "the scan must actually find functions");
  const judgement =
    /score|rating|rank|risk|legit|fraud|abus|suspic|credib|recommend|verdict|adjudicat|confidence|likelihood|assess|approve|reject|deny|decide|eligib/i;
  for (const name of declared) {
    assert.doesNotMatch(name, judgement, `"${name}" would be an adjudication function`);
  }
});

test("support-core never inspects, matches, or rewrites the customer's words", () => {
  for (const forbidden of [
    /reason\.(toLowerCase|toUpperCase|includes|match|test|indexOf|search|split|replace|trim|slice|substring)/,
    /test\(\s*reason/,
    /exec\(\s*reason/,
    /\.test\(\s*ctx\[/,
    // `reason === "chargeback"` would be content analysis. `typeof reason ===
    // "string"` is a type check on the way to carrying it verbatim, so it is
    // exempted — deliberately and narrowly.
    /(?<!typeof )reason\s*(===|==|!==|!=)\s*["']/,
  ]) {
    assert.doesNotMatch(coreCode, forbidden, `the reason must never be analysed (${forbidden})`);
  }
  // The only thing done to the reason is a type check, then verbatim carry.
  assert.match(coreCode, /reasonVerbatim:\s*typeof reason === "string" \? reason : ""/);
});

test("refundContext ends in the guard — the boundary is not a flag", () => {
  assert.match(
    coreCode,
    /export function refundContext[\s\S]*?return assertNeutralContext\(\{/,
    "every context must go through the guard on its way out",
  );
  assert.match(coreCode, /throw new Error/, "the guard throws; it does not warn and continue");
});

test("support-core is pure: no env, no network, no store", () => {
  assert.doesNotMatch(coreCode, /process\.env/);
  assert.doesNotMatch(coreCode, /\bfetch\(/);
  assert.doesNotMatch(coreCode, /require\(|from "@\/lib\//);
});

// ============================================================================
// 7. THE WIRE — THE ACCOUNT PAGE ACTUALLY CALLS THIS, AND CALLS IT BLIND
// ============================================================================
//
// All of the above was true while the endpoint was dead code: nothing in the UI
// called it, so a customer got nothing from it. These tests hold the connection
// open, and hold it to the same rules the route obeys — the page asks "what am
// I on?" without ever saying WHO is asking, because the session already knows.

const ORDER_URL = "/api/support/order-status";

/** The account page's order-status call exactly as shipped, options included. */
const orderFetchCall = pageCode.match(/fetch\(\s*"\/api\/support\/order-status"[^)]*\)/);

/** The card the page paints from that summary, source and all. */
const orderCard = pageCode.match(/Where things stand[\s\S]*?<\/section>/);

test("the account page actually calls the order-status endpoint — not dead code", () => {
  assert.ok(
    pageCode.includes(`"${ORDER_URL}"`),
    "the account page must call the endpoint, or the customer gains nothing from it",
  );
  assert.ok(orderFetchCall, "it must be reached by a real fetch, not just mentioned");
});

test("the page sends NO client-supplied identifier with the order-status call", () => {
  const call = orderFetchCall[0];
  assert.doesNotMatch(call, /method\s*:/, "order-status is a plain GET");
  assert.doesNotMatch(call, /body\s*:/, "nothing is sent up with it");
  for (const forbidden of [
    /customerId/,
    /customer_id/,
    /subscriptionId/,
    /subscription_id/,
    /\bemail\b/,
    /\btoken\b/,
    /telegramId/,
    /\buserId\b/,
    /\bplan\b/,
  ]) {
    assert.doesNotMatch(call, forbidden, `the call must not name whose order to read (${forbidden})`);
  }
});

test("the order-status path is a fixed literal — no query string, no interpolation", () => {
  const followedBy = [...pageCode.matchAll(/\/api\/support\/order-status(.)/g)].map((m) => m[1]);
  assert.ok(followedBy.length > 0, "the scan must actually find the call");
  for (const next of followedBy) {
    assert.equal(next, '"', "the path must end right there — no ?id=, no template literal");
  }
  assert.doesNotMatch(pageCode, /`[^`]*\/api\/support\/order-status/, "no template-literal URL");
});

test("the page reads ONLY customer-safe summary fields off the response", () => {
  const safe = [
    "found",
    "planLabel",
    "statusLabel",
    "headline",
    "statusLine",
    "sinceLine",
    "cancelLine",
    "text",
  ];
  const readFields = [...pageCode.matchAll(/\border\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  assert.ok(readFields.length > 0, "the scan must actually find field reads");
  for (const f of readFields) {
    assert.ok(safe.includes(f), `the page reads order.${f}, which is not a customer-safe field`);
  }
});

test("the card the page paints touches no entitlement id and no raw record", () => {
  assert.ok(orderCard, "the summary must actually be rendered somewhere");
  const card = orderCard[0];
  for (const forbidden of [/customerId/, /subscriptionId/, /telegramId/, /\.rec\b/, /\.\.\.order\b/]) {
    assert.doesNotMatch(card, forbidden, `the card must not render ${forbidden}`);
  }
  for (const word of BANNED_WORDS) {
    assert.ok(!card.toLowerCase().includes(word), `the card's own copy mentions "${word}"`);
  }
});

test("nothing the page renders from a summary carries an id or a provider name", () => {
  assert.ok(tierItems.length > 0, "the tier feature copy must actually be found");
  for (const rec of [activeRec, cancelledRec, pendingRec, boundRec, weirdRec, null]) {
    const s = summariseOrderForCustomer(rec);
    // Exactly the strings the card paints, in the order it paints them.
    const rendered = [s.headline, s.statusLine, s.sinceLine, ...tierItems, s.cancelLine].join(" ");
    const lower = rendered.toLowerCase();
    for (const word of BANNED_WORDS) {
      assert.ok(!lower.includes(word), `the account page would show a customer "${word}"`);
    }
    for (const secret of rec
      ? [rec.customerId, rec.subscriptionId, rec.token, String(rec.telegramId)]
      : []) {
      assert.ok(!rendered.includes(secret), `the account page would show a customer "${secret}"`);
    }
  }
});

test("the page tells an active customer what cancelling would actually cost them", () => {
  const s = summariseOrderForCustomer(activeRec);
  const rendered = [s.headline, s.statusLine, s.sinceLine, s.cancelLine].join(" ");
  assert.match(rendered, /Assistant plan/);
  assert.match(rendered, /cancel/i);
  assert.match(rendered, /keep everything you've already paid for/i);
  assert.match(orderCard[0], /order\.cancelLine/, "the cancel consequence must be on screen");
});

// ---- the boundary, held at the UI layer too (jury #107) --------------------

test("the account page scores, ranks, or flags nothing about the customer", () => {
  const judgement =
    /score|rating|\brank|\brisk|legit|fraud|abus|suspic|credib|trustworth|recommendation|verdict|adjudicat|confidence|likelihood|probab|assess|eligib|severity|sentiment/i;
  const hit = pageCode.match(judgement);
  assert.equal(hit, null, `the page must not judge a customer (matched "${hit && hit[0]}")`);
});

test("the page's refund request carries the customer's words and nothing else", () => {
  const call = pageCode.match(/fetch\(\s*"\/api\/subscription\/refund-request"[\s\S]*?\}\);/);
  assert.ok(call, "the refund request must still be a real call");
  assert.match(call[0], /JSON\.stringify\(\{\s*reason\s*\}\)/, "the reason, verbatim, and nothing more");
  assert.doesNotMatch(call[0], /score|legit|valid|assess|flag/i, "no verdict rides along with it");
});

test("the page never asks the customer to justify themselves to a machine", () => {
  // Reading an order and filing a reason are fine. Telling someone their claim
  // looks false is not, and no copy on this page may drift toward it.
  for (const forbidden of [
    /looks? (false|suspicious|unlikely)/i,
    /we (don't|do not) believe/i,
    /your claim (was|is) (denied|rejected|flagged)/i,
    /prove/i,
  ]) {
    assert.doesNotMatch(pageCode, forbidden, `the page must never doubt a customer (${forbidden})`);
  }
});
