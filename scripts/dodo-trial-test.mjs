/**
 * THE ADVERTISED 14-DAY FREE TRIAL — behavioural proof that it is guaranteed by
 * CODE rather than by an unasserted dashboard toggle.
 *
 * WHAT WAS WRONG, AND WHY A TEST IS THE FIX. Eight public pages promise a
 * "14-day free trial — no charge for 14 days". That promise was true, but only
 * because all three Dodo products happened to carry trial_period_days: 14 in
 * the Dodo dashboard (verifications#411); src/lib/dodo.ts sent no trial field at
 * all and every subscription merely INHERITED the product's setting. Nothing in
 * this repository asserted any of it. One dashboard edit would have turned the
 * promise into an immediate charge with nothing failing, nothing logging and
 * nothing alerting. The defect was never a wrong value — it was the absence of
 * an owner for the promise. These tests are that owner.
 *
 * REAL CODE, NOT A MOCK OF IT. Everything below imports the production
 * src/lib/dodo.ts through scripts/route-harness (the same rig the revenue tests
 * use), so the request body asserted on is the exact body createDodoCheckout
 * builds. The harness BLOCKS every outbound fetch unless a test scripts a
 * reply, so nothing here can reach a live payment provider — and `netCalls` is
 * the positive evidence for what was actually sent.
 *
 * WHAT IS AND IS NOT PROTECTED. Section (b) pins a limit rather than papering
 * over it: Dodo does not echo trial_period_days on the create response
 * (gotchas#264), so the response-side LENGTH check is permanently unfalsifiable
 * and is asserted to be exactly that. The response-side FREE-NESS check
 * (trial_amount) is real and fires today, and section (f) covers the
 * product-level check that can actually catch the failure mode this all exists
 * for — a dashboard edit — via GET /products/{id}, off the checkout path.
 *
 * COUNTERFACTUAL. Section (e) re-runs the load-bearing assertions against
 * `git show HEAD:src/lib/dodo.ts` — the revision before this fix — and requires
 * them to FAIL there. A test that passes both before and after proves nothing.
 *
 * Run: node --test scripts/dodo-trial-test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadRoute, env, netCalls, resetNet, scriptFetch, ROOT } from "./route-harness/index.mjs";

// PRE_FIX_REV — the revision this file's counterfactuals materialise.
//
// It is PINNED TO A SHA on purpose. It used to say "HEAD", which is
// self-falsifying: the moment the fix is committed, HEAD becomes the FIXED
// code, so every "this must fail before the fix" assertion starts running
// against the fix and goes red. That is exactly what happened when 45c7247
// landed — 21 counterfactuals across four files turned red simultaneously
// while the product was perfectly healthy. A counterfactual must name the
// revision it is contrasting against, never a moving reference.
const PRE_FIX_REV = "f889ee5";

const dodo = await loadRoute("src/lib/dodo.ts");

/** Fully arm the Dodo money path with DUMMY values — never real credentials. */
const DODO_ARMED = {
  DODO_API_KEY: "dummy_dodo_key_not_real",
  DODO_PAYMENTS_LIVE: "1",
  DODO_PRODUCT_COMPANION: "prod_dummy_companion",
  DODO_PRODUCT_ASSISTANT: "prod_dummy_assistant",
  DODO_PRODUCT_STUDIO: "prod_dummy_studio",
};

/**
 * Reply as Dodo's POST /subscriptions does. `extra` lets a test decide what the
 * response says about the trial — including saying nothing at all, which is the
 * case the guard must NOT treat as a violation.
 */
function scriptCreateReply(extra = {}) {
  scriptFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      payment_link: "https://checkout.dodopayments.com/dummy",
      subscription_id: "sub_dummy",
      ...extra,
    }),
    text: async () => "",
  }));
}

/** The JSON body of the last outbound call, parsed. */
function lastSentBody() {
  const call = netCalls[netCalls.length - 1];
  assert.ok(call, "expected an outbound call to Dodo");
  return JSON.parse(call.body);
}

function baseInput(over = {}) {
  return { plan: "companion", email: "trial@example.com", connectToken: "tok_trial", ...over };
}

/** Capture console.error for the duration of `fn`. */
async function captureErrors(fn) {
  const errors = [];
  const real = console.error;
  console.error = (...a) => errors.push(a.join(" "));
  try {
    await fn();
  } finally {
    console.error = real;
  }
  return errors;
}

// ────────────────────────────────────────────────────────────────────────────
// (a) THE PROMISE IS IN THE REQUEST
// ────────────────────────────────────────────────────────────────────────────

test("the create-subscription body SENDS trial_period_days — the promise no longer depends on a dashboard toggle", async () => {
  env(DODO_ARMED);
  resetNet();
  scriptCreateReply({ trial_period_days: 14 });
  await dodo.createDodoCheckout(baseInput());
  assert.equal(lastSentBody().trial_period_days, 14);
});

test("the trial sent is TRIAL_PERIOD_DAYS, not a literal typed at the call site", async () => {
  assert.equal(dodo.TRIAL_PERIOD_DAYS, 14);
  env(DODO_ARMED);
  resetNet();
  scriptCreateReply();
  await dodo.createDodoCheckout(baseInput());
  assert.equal(lastSentBody().trial_period_days, dodo.TRIAL_PERIOD_DAYS);
});

test("EVERY paid plan carries the trial — not just the one somebody happened to test", async () => {
  for (const plan of ["companion", "assistant", "studio"]) {
    env(DODO_ARMED);
    resetNet();
    scriptCreateReply();
    await dodo.createDodoCheckout(baseInput({ plan }));
    const sent = lastSentBody().trial_period_days;
    // Both halves on purpose. Asserting only `sent === TRIAL_PERIOD_DAYS` is a
    // TAUTOLOGY on any revision where neither exists: undefined === undefined
    // passes, and the test goes green against the very code it is supposed to
    // catch. The literal 14 is what makes it load-bearing; the constant check on
    // top is what stops the two drifting apart later.
    assert.equal(sent, 14, `plan ${plan} must carry the advertised trial`);
    assert.equal(sent, dodo.TRIAL_PERIOD_DAYS, `plan ${plan} must carry it FROM the constant`);
  }
});

test("adding the trial did NOT disturb the rest of the request shape (price authority, plan, metadata)", async () => {
  env(DODO_ARMED);
  resetNet();
  scriptCreateReply();
  await dodo.createDodoCheckout(baseInput({ plan: "studio", name: "Ada Lovelace" }));
  const body = lastSentBody();
  // The provider decides the amount from the product; we must never send one.
  assert.equal(body.amount, undefined);
  assert.equal(body.price, undefined);
  assert.equal(body.product_id, "prod_dummy_studio");
  assert.equal(body.quantity, 1);
  assert.equal(body.payment_link, true);
  assert.deepEqual(body.metadata, { connect_token: "tok_trial", plan: "studio" });
});

/**
 * NOTE FOR THE COUNTERFACTUAL: this one also goes red against HEAD, but NOT
 * because of the trial work — HEAD predates writer J's country/name hardening
 * entirely. It is here as a regression guard proving that adding the trial field
 * did not disturb J's changes, which is a different claim from the ones in
 * section (e).
 */
test("writer J's country + name hardening still holds with the trial field alongside it", async () => {
  env(DODO_ARMED);
  resetNet();
  scriptCreateReply();
  await dodo.createDodoCheckout(baseInput({ country: " de ", name: "  Ada\nLovelace  " }));
  const body = lastSentBody();
  assert.equal(body.billing.country, "DE", "a supplied country is normalised, not ignored");
  assert.equal(body.customer.name, "Ada Lovelace", "control chars collapsed, not deleted");
  assert.equal(body.trial_period_days, dodo.TRIAL_PERIOD_DAYS);

  // And an invalid country is still a REFUSAL — resolved BEFORE the network
  // call, so no subscription (and no trial) is created at all.
  env(DODO_ARMED);
  resetNet();
  scriptCreateReply();
  await assert.rejects(() => dodo.createDodoCheckout(baseInput({ country: "ZZ" })), /ISO-3166-1/);
  assert.equal(netCalls.length, 0, "an invalid country must not reach the provider");
});

// ────────────────────────────────────────────────────────────────────────────
// (b) THE RESPONSE CHECK — WHAT IT CAN AND CANNOT DETECT
//
// The ruling asked for the created subscription to be asserted against the
// promise. Half of that is impossible and the tests say so out loud rather than
// implying coverage that does not exist:
//
//   trial_period_days — NOT in CreateSubscriptionResponse (gotchas#264). The
//     length check is PERMANENTLY UNFALSIFIABLE on the checkout path. Tests
//     below pin that as a known fact so nobody mistakes it for protection.
//   trial_amount      — IS in the response, and a free trial reports null. This
//     half is real and fires today.
//
// The check that can actually catch a dashboard edit is in section (f).
// ────────────────────────────────────────────────────────────────────────────

test("the length predicate: a value that CONTRADICTS the advertised trial is a violation", () => {
  const v = dodo.checkTrialPromise(7);
  assert.equal(v.verified, true);
  assert.equal(v.violated, true);
  assert.equal(v.observed, 7);
});

test("the length predicate: 0 is a violation — an explicit zero-day trial IS an immediate charge", () => {
  const v = dodo.checkTrialPromise(0);
  assert.equal(v.violated, true, "0 must not be waved through as falsy/absent");
  assert.equal(v.observed, 0);
});

test("the length predicate: a value that AGREES is verified and not a violation", () => {
  assert.deepEqual(dodo.checkTrialPromise(14), { verified: true, violated: false, observed: 14 });
});

test("ABSENCE is not evidence: a source that says nothing about the length is unverified, NOT a violation", () => {
  for (const absent of [undefined, null, "14", NaN, {}]) {
    const v = dodo.checkTrialPromise(absent);
    assert.equal(v.verified, false, `${String(absent)} must not count as a check`);
    assert.equal(v.violated, false, `${String(absent)} must not raise a false alarm`);
    assert.equal(v.observed, null);
  }
});

/**
 * The REAL CreateSubscriptionResponse schema, verified against Dodo's
 * POST /subscriptions reference. Reproduced here as the fixture for the two
 * tests below so the "it can never fire" claim is pinned to the actual contract
 * rather than to an assumption someone made once.
 */
const REAL_CREATE_RESPONSE = {
  subscription_id: "sub_dummy",
  recurring_pre_tax_amount: 1499,
  customer: { customer_id: "cus_dummy", email: "trial@example.com" },
  metadata: {},
  addons: [],
  payment_id: "pay_dummy",
  client_secret: "cs_dummy",
  discount_id: null,
  discount_ids: [],
  expires_on: null,
  one_time_product_cart: null,
  payment_link: "https://checkout.dodopayments.com/dummy",
  trial_amount: null,
};

test("KNOWN LIMIT: against the REAL response schema the length check is unfalsifiable — it can never fire", () => {
  // This is a documented no-op, not active protection, and the test exists so
  // that fact is asserted rather than assumed. If Dodo ever adds the field to
  // the response, this test goes red and tells us the guard has come alive.
  assert.equal(
    "trial_period_days" in REAL_CREATE_RESPONSE,
    false,
    "Dodo does not echo trial_period_days on create (gotchas#264)",
  );
  const audit = dodo.assertTrialPromise(REAL_CREATE_RESPONSE, { plan: "companion" }, () => {
    throw new Error("must not alert");
  });
  assert.equal(audit.length.verified, false, "unverifiable, forever, by contract");
  assert.equal(audit.length.violated, false, "and therefore silent by design");
});

test("the FREE-NESS check IS falsifiable on the real response — trial_amount is echoed", () => {
  // free trial: trial_amount null (the verified live shape)
  const ok = dodo.checkFreeTrial(REAL_CREATE_RESPONSE);
  assert.equal(ok.verified, true, "present, so genuinely checked");
  assert.equal(ok.violated, false);

  // a charged "free" trial: detected
  const bad = dodo.checkFreeTrial({ ...REAL_CREATE_RESPONSE, trial_amount: 1499 });
  assert.equal(bad.verified, true);
  assert.equal(bad.violated, true, "being charged to start a free trial is a violation");
  assert.equal(bad.observed, 1499);

  // 0 is free too
  assert.equal(dodo.checkFreeTrial({ trial_amount: 0 }).violated, false);

  // an ABSENT key is uncheckable, not a violation
  const absent = dodo.checkFreeTrial({ subscription_id: "sub_x" });
  assert.equal(absent.verified, false);
  assert.equal(absent.violated, false);
});

test("a violation ALERTS LOUDLY, naming the plan, the numbers, and what to RUN about it", () => {
  const alerts = [];
  const audit = dodo.assertTrialPromise(
    { ...REAL_CREATE_RESPONSE, trial_amount: 1499 },
    { plan: "assistant", subscriptionId: "sub_x", productId: "prod_y" },
    (...a) => alerts.push(a.join(" ")),
  );
  assert.equal(audit.violated, true);
  assert.equal(alerts.length, 1, "exactly one alert");
  const msg = alerts[0];
  assert.match(msg, /ALERT/);
  assert.match(msg, /assistant/, "names the plan");
  assert.match(msg, /1499/, "names what Dodo actually did");
  assert.match(msg, /sub_x/, "names the subscription so it can be found");
  // Condition B: the log line is read by a human who is already investigating,
  // so it must hand them the next action rather than just the bad news.
  assert.match(msg, /npm run verify:trial/, "tells the reader the command that diagnoses it");
});

test("the alert stays SILENT when the promise is kept, and when it cannot be checked", () => {
  const alerts = [];
  const spy = (...a) => alerts.push(a.join(" "));
  dodo.assertTrialPromise(REAL_CREATE_RESPONSE, { plan: "companion" }, spy);
  dodo.assertTrialPromise({ trial_amount: 0 }, { plan: "companion" }, spy);
  dodo.assertTrialPromise({}, { plan: "companion" }, spy);
  dodo.assertTrialPromise(null, { plan: "companion" }, spy);
  assert.equal(alerts.length, 0, "no noise on the money path when there is nothing wrong");
});

test("DELIBERATE: a trial violation ALERTS but does NOT refuse the checkout", async () => {
  // The subscription already exists at Dodo by the time the response is read.
  // Throwing would not un-create it or stop any charge — it would only withhold
  // the payment link, stranding a customer with a live subscription and no way
  // to complete or see it. So the customer still gets their link, loudly.
  env(DODO_ARMED);
  resetNet();
  scriptCreateReply({ trial_amount: 1499 });
  let out;
  const errors = await captureErrors(async () => {
    out = await dodo.createDodoCheckout(baseInput());
  });
  assert.equal(out.url, "https://checkout.dodopayments.com/dummy", "the customer is NOT stranded");
  assert.ok(
    errors.some((e) => /ADVERTISED-TRIAL VIOLATION/.test(e)),
    "the discrepancy must be screamed about even though the checkout proceeded",
  );
});

test("createDodoCheckout checks the REAL response, not the value it just sent", async () => {
  // Proves the guard reads the response rather than re-checking our own
  // constant, which would make it a tautology that can never fire. BOTH
  // directions are asserted from the same wiring: identical request, two
  // different responses, two different outcomes. A revision with no guard at all
  // fails the second half, so this cannot go green by simply being silent.
  const run = async (extra) => {
    env(DODO_ARMED);
    resetNet();
    scriptCreateReply(extra);
    const errors = await captureErrors(() => dodo.createDodoCheckout(baseInput()));
    return errors.filter((e) => /ADVERTISED-TRIAL/.test(e)).length;
  };
  assert.equal(await run({ trial_amount: null }), 0, "an agreeing response must be quiet");
  assert.equal(await run({ trial_amount: 999 }), 1, "a disagreeing response must be loud — same code");
});

test("a create that FAILS still throws — the trial guard did not swallow the error path", async () => {
  env(DODO_ARMED);
  resetNet();
  scriptFetch(async () => ({ ok: false, status: 422, text: async () => "bad request", json: async () => ({}) }));
  await assert.rejects(() => dodo.createDodoCheckout(baseInput()), /422/);
});

test("the checkout path makes EXACTLY ONE network call — product verification is NOT on it", async () => {
  // The product check is three extra round trips. Putting it in front of a
  // paying customer would trade real conversions for a check that does not need
  // to be live, so it lives in scripts/verify-trial-config.mjs instead.
  env(DODO_ARMED);
  resetNet();
  scriptCreateReply();
  await dodo.createDodoCheckout(baseInput());
  assert.equal(netCalls.length, 1, "one call: the subscription create, and nothing else");
  assert.match(netCalls[0].url, /\/subscriptions$/);
  assert.equal(
    netCalls.filter((c) => /\/products\//.test(c.url)).length,
    0,
    "no product read may happen on the checkout path",
  );
});

// ────────────────────────────────────────────────────────────────────────────
// (c) THE PUBLIC COPY AND THE CONSTANT CANNOT DRIFT APART
// ────────────────────────────────────────────────────────────────────────────

/**
 * The public pages that PRINT the promise. @/lib/dodo is server-only (it reads
 * DODO_API_KEY), so these pages deliberately do not import TRIAL_PERIOD_DAYS —
 * this test is the tie instead. It fails in BOTH directions: change the
 * constant without the copy, or the copy without the constant, and it goes red.
 */
const TRIAL_COPY_PAGES = [
  "src/app/mira/plans/page.tsx",
  "src/app/mira/checkout/page.tsx",
  "src/app/mira/account/page.tsx",
  "src/app/pricing/page.tsx",
  "src/app/products/[slug]/page.tsx",
  "src/app/legal/refund/page.tsx",
];

test("every public page that advertises a trial advertises TRIAL_PERIOD_DAYS days", () => {
  const n = dodo.TRIAL_PERIOD_DAYS;
  for (const rel of TRIAL_COPY_PAGES) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const claims = [...src.matchAll(/(\d+)[-\s]day free trial/gi)].map((m) => Number(m[1]));
    assert.ok(claims.length > 0, `${rel} should still advertise the trial (decisions#342 overturned its removal)`);
    for (const claimed of claims) {
      assert.equal(claimed, n, `${rel} advertises a ${claimed}-day trial but we send ${n}`);
    }
  }
});

test("the trial copy was NOT removed — decisions#341 Q2 was OVERTURNED by decisions#342 Q_A", () => {
  // The copy is TRUE; the ruling to delete it was reversed. This guards against
  // a well-meaning future edit re-applying the overturned ruling.
  for (const rel of TRIAL_COPY_PAGES) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.match(src, /free trial/i, `${rel} must keep its (true) free-trial copy`);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// (d) THE ACCOUNT PAGE NO LONGER TELLS A TRIALING CUSTOMER THEY ARE PAYING
// ────────────────────────────────────────────────────────────────────────────

const ACCOUNT = fs.readFileSync(path.join(ROOT, "src/app/mira/account/page.tsx"), "utf8");

/**
 * Strip comments, so these assertions read the CODE and not the prose about it.
 *
 * This matters here specifically: the fix carries a long comment that quotes the
 * old label verbatim in order to explain what was wrong with it. A bare text
 * search over the raw file would match that explanation and report the defect as
 * still present (or, worse in the other direction, be "fixed" by deleting the
 * explanation). What reaches a customer's screen is the JSX, so that is what
 * gets scanned. Line comments are only stripped when the `//` starts the line,
 * which keeps URLs inside string literals intact.
 */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

const ACCOUNT_CODE = codeOnly(ACCOUNT);

/**
 * The RENDERED label, not any mention of it. The fix carries a long comment that
 * quotes the old copy verbatim in order to explain it, so a bare text search
 * would match the explanation and go green for the wrong reason. These patterns
 * target the ternary that actually reaches the customer's screen.
 */
const OLD_LABEL_TERNARY = /\?\s*"Free trial active"\s*:\s*"Subscription active"/;
const NEW_LABEL_TERNARY = /\{inTrial \? "Free trial active" : "Active"\}/;

test('the account page no longer RENDERS "Subscription active" to a customer it cannot prove is paying', () => {
  // Dodo never emits a trialing status (dodo-webhook-core.mjs hardcodes
  // status: "active"), so the old else-branch caught EVERY Dodo customer —
  // including everyone inside their free trial, who had been charged nothing.
  assert.doesNotMatch(ACCOUNT_CODE, OLD_LABEL_TERNARY, "the phase-asserting label must be gone from the render");
  assert.match(ACCOUNT_CODE, NEW_LABEL_TERNARY, "and be replaced by one that claims only what we can prove");
});

test('the account page still shows "Free trial active" when the entitlement genuinely says trialing', () => {
  assert.match(ACCOUNT_CODE, /"Free trial active"/, "the correct label must survive for the Stripe cohort");
  assert.match(ACCOUNT_CODE, /TRIALING_STATUSES = new Set/, "driven by a named status set, not a stray literal");
  assert.match(ACCOUNT_CODE, /TRIALING_STATUSES\.has\(ent\.status\)/, "derived from the real entitlement status");
});

test("the account page states the trial terms in a form that is true in BOTH phases", () => {
  assert.match(ACCOUNT_CODE, /\{TRIAL_TERMS\}/, "and it is actually RENDERED, not merely declared");
  assert.match(ACCOUNT_CODE, /starts with a 14-day free trial/, "describes the plan, not the customer's position in it");
});

// ────────────────────────────────────────────────────────────────────────────
// (e) COUNTERFACTUAL — these assertions must FAIL against the code before the fix
// ────────────────────────────────────────────────────────────────────────────

/**
 * Materialise `git show HEAD:src/lib/dodo.ts` in a scratch directory and import
 * it through the same harness. hooks.mjs resolves `@/...` absolutely against the
 * repo, so a revision copied outside the repo still loads — exactly the
 * counterfactual case its own header calls out.
 */
async function loadHeadDodo() {
  const src = execFileSync("git", ["show", PRE_FIX_REV + ":src/lib/dodo.ts"], { cwd: ROOT, encoding: "utf8" });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dodo-head-"));
  const file = path.join(dir, "dodo-HEAD.ts");
  fs.writeFileSync(file, src, "utf8");
  return loadRoute(file);
}

const head = await loadHeadDodo();

test("COUNTERFACTUAL: pre-fix, the create body sent NO trial at all — the promise rested on a dashboard toggle", async () => {
  env(DODO_ARMED);
  resetNet();
  scriptCreateReply({ trial_period_days: 14 });
  await head.createDodoCheckout(baseInput());
  const body = lastSentBody();
  assert.equal(body.trial_period_days, undefined, "sanity: HEAD really did send nothing");

  // The assertion from section (a), run against HEAD — it MUST fail there.
  assert.throws(
    () => assert.equal(body.trial_period_days, 14),
    "the section-(a) assertion would have passed pre-fix, so it proves nothing",
  );
});

test("COUNTERFACTUAL: pre-fix there was no guard to fail — a 0-day trial came back and nobody heard a thing", async () => {
  assert.equal(head.TRIAL_PERIOD_DAYS, undefined, "sanity: no constant existed");
  for (const fn of ["checkTrialPromise", "checkFreeTrial", "assertTrialPromise", "checkTrialProduct", "verifyTrialProducts", "fetchDodoProduct"]) {
    assert.equal(typeof head[fn], "undefined", `sanity: ${fn} did not exist pre-fix`);
  }

  env(DODO_ARMED);
  resetNet();
  scriptCreateReply({ trial_amount: 1499, trial_period_days: 0 });
  const errors = await captureErrors(() => head.createDodoCheckout(baseInput()));
  assert.equal(
    errors.length,
    0,
    "SILENCE is the defect: Dodo charged for the 'free' trial and nothing anywhere noticed",
  );
});

test("COUNTERFACTUAL: pre-fix, the account page told a trialing customer their subscription was active", () => {
  const before = codeOnly(
    execFileSync("git", ["show", PRE_FIX_REV + ":src/app/mira/account/page.tsx"], { cwd: ROOT, encoding: "utf8" }),
  );
  assert.match(before, OLD_LABEL_TERNARY, "sanity: the false label really was rendered");
  assert.match(before, /ent\.status === "trialing"/, "sanity: gated on a status Dodo never emits");
  // The section-(d) assertions, run against HEAD — they MUST fail there.
  assert.throws(
    () => assert.doesNotMatch(before, OLD_LABEL_TERNARY),
    "the section-(d) assertion would have passed pre-fix, so it proves nothing",
  );
  assert.throws(
    () => assert.match(before, NEW_LABEL_TERNARY),
    "the honest label did not exist pre-fix",
  );
});

test("PRESERVED: everything that was already correct pre-fix is byte-for-byte unchanged post-fix", async () => {
  // A counterfactual only means something if the rest did NOT change. Same
  // input, both revisions: everything except the trial field must match.
  env(DODO_ARMED);
  resetNet();
  scriptCreateReply();
  await head.createDodoCheckout(baseInput({ plan: "assistant" }));
  const beforeBody = lastSentBody();

  env(DODO_ARMED);
  resetNet();
  scriptCreateReply();
  await dodo.createDodoCheckout(baseInput({ plan: "assistant" }));
  const afterBody = lastSentBody();

  assert.equal(afterBody.trial_period_days, 14, "the one intended difference");
  delete afterBody.trial_period_days;
  assert.deepEqual(afterBody, beforeBody, "nothing else about the request changed");
});

// ────────────────────────────────────────────────────────────────────────────
// (f) THE PRODUCT-LEVEL CHECK — the one that can actually fail
//
// The risk is a dashboard edit to a PRODUCT. GET /products/{id} reports
// trial_period_days, trial_type and trial_amount, so that is what gets checked.
// Every product payload below is a FIXTURE — verifyTrialProducts takes its
// reader as a dependency, so these tests never touch the network, and the
// harness would block them if they tried.
// ────────────────────────────────────────────────────────────────────────────

/** The verified live shape: all three products carry exactly this (verifications#411). */
const GOOD_PRODUCT = { trial_period_days: 14, trial_type: "free", trial_amount: null };

test("a correctly configured product passes with no problems", () => {
  const v = dodo.checkTrialProduct("companion", "pdt_x", GOOD_PRODUCT);
  assert.equal(v.ok, true);
  assert.deepEqual(v.problems, []);
  assert.equal(v.observed.trialPeriodDays, 14);
});

test("ABSENCE IS EVIDENCE on a product — unlike on the checkout response", () => {
  // The asymmetry is the point. GET /products/{id} is documented to report
  // trial_period_days, so a product that reports none genuinely HAS no trial:
  // silence from a source that is supposed to answer IS an answer. The same
  // silence on the create response means only "not echoed".
  const v = dodo.checkTrialProduct("companion", "pdt_x", { trial_type: "free", trial_amount: null });
  assert.equal(v.ok, false);
  assert.match(v.problems.join(" "), /no trial_period_days/);
});

test("the exact dashboard edits we are guarding against are each caught", () => {
  const cases = [
    [{ ...GOOD_PRODUCT, trial_period_days: 0 }, /trial_period_days is 0/, "trial switched off"],
    [{ ...GOOD_PRODUCT, trial_period_days: 7 }, /trial_period_days is 7/, "trial shortened"],
    [{ ...GOOD_PRODUCT, trial_type: "paid" }, /trial_type is "paid"/, "trial made paid"],
    [{ ...GOOD_PRODUCT, trial_amount: 500 }, /trial_amount is 500/, "trial given a price"],
  ];
  for (const [product, pattern, why] of cases) {
    const v = dodo.checkTrialProduct("studio", "pdt_x", product);
    assert.equal(v.ok, false, why);
    assert.match(v.problems.join(" "), pattern, why);
  }
});

test("an unreadable or unconfigured product is a PROBLEM, never a silent pass", () => {
  assert.equal(dodo.checkTrialProduct("companion", "pdt_x", null).ok, false, "unreadable product");
  const unset = dodo.checkTrialProduct("companion", null, null);
  assert.equal(unset.ok, false, "no product id configured");
  assert.match(unset.problems.join(" "), /DODO_PRODUCT_COMPANION/, "names the env var to fix");
});

test("verifyTrialProducts checks ALL THREE plans and reports a clean bill only when all pass", async () => {
  env(DODO_ARMED);
  const seen = [];
  const report = await dodo.verifyTrialProducts({
    fetchProduct: async (id) => {
      seen.push(id);
      return GOOD_PRODUCT;
    },
  });
  assert.equal(report.ok, true);
  assert.equal(report.checked, 3);
  assert.deepEqual(report.problems, []);
  assert.deepEqual(seen.sort(), ["prod_dummy_assistant", "prod_dummy_companion", "prod_dummy_studio"]);
});

test("verifyTrialProducts FAILS when ONE product drifts — and names which", async () => {
  env(DODO_ARMED);
  const report = await dodo.verifyTrialProducts({
    fetchProduct: async (id) =>
      id === "prod_dummy_studio" ? { ...GOOD_PRODUCT, trial_period_days: 0 } : GOOD_PRODUCT,
  });
  assert.equal(report.ok, false, "one bad product fails the whole check");
  assert.equal(report.problems.length, 1);
  assert.match(report.problems[0], /studio/, "names the plan");
  assert.match(report.problems[0], /prod_dummy_studio/, "names the product id");
  assert.match(report.problems[0], /trial_period_days is 0/, "names what is wrong");
});

test("verifyTrialProducts NEVER throws — one unreadable product must not hide the other two", async () => {
  env(DODO_ARMED);
  const report = await dodo.verifyTrialProducts({
    fetchProduct: async (id) => {
      if (id === "prod_dummy_companion") throw new Error("403 Forbidden");
      return GOOD_PRODUCT;
    },
  });
  assert.equal(report.ok, false);
  assert.equal(report.checked, 3, "all three were still attempted");
  assert.match(report.problems.join(" "), /403 Forbidden/, "the read failure is reported, not swallowed");
  assert.equal(report.verdicts.filter((v) => v.ok).length, 2, "the other two still returned real verdicts");
});

test("verifyTrialProducts reports UNCONFIGURED plans instead of quietly checking nothing", async () => {
  // A green run that checked nothing is worse than a red one: it retires the
  // question. An unset product id must therefore be a problem, not a skip.
  env({ ...DODO_ARMED, DODO_PRODUCT_STUDIO: undefined });
  const report = await dodo.verifyTrialProducts({ fetchProduct: async () => GOOD_PRODUCT });
  assert.equal(report.ok, false);
  assert.equal(report.checked, 3);
  assert.match(report.problems.join(" "), /DODO_PRODUCT_STUDIO/);
});

// ── the runnable entry point (Condition B: failure a human actually meets) ──

/**
 * Read LAZILY, inside each test. At module scope a missing file throws while the
 * runner is still registering tests, and the remaining tests then silently
 * vanish from the report instead of failing — which is exactly the wrong
 * behaviour for a counterfactual, where the file is deliberately absent and the
 * tests MUST go red rather than disappear.
 */
const verifyScript = () => fs.readFileSync(path.join(ROOT, "scripts/verify-trial-config.mjs"), "utf8");
const pkg = () => JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

test("the product check is RUNNABLE — wired into package.json, not just exported", () => {
  assert.equal(pkg().scripts["verify:trial"], "node scripts/verify-trial-config.mjs");
});

test("the verifier EXITS NON-ZERO on drift — that is the part a human actually encounters", () => {
  // console.error inside the Next server goes to journalctl and pages nobody.
  // A failing command reddens a terminal, fails a cron job and breaks CI. The
  // non-zero exit IS the alerting mechanism, so it is asserted, not assumed.
  assert.match(verifyScript(), /process\.exit\(1\)/, "drift must fail the command");
  assert.match(verifyScript(), /process\.exit\(2\)/, "an unconfigured run must not look like a pass");
  assert.match(verifyScript(), /process\.exit\(0\)/, "and a clean run must succeed");
});

test("the verifier is READ-ONLY — it may look at products and nothing else", () => {
  const code = codeOnly(verifyScript());
  assert.doesNotMatch(code, /createDodoCheckout|cancelDodoSubscription|refundDodoPayment/, "no money movement");
  assert.doesNotMatch(code, /method:\s*["'](POST|PATCH|DELETE|PUT)["']/, "no mutating HTTP verb");
  assert.match(code, /fetchDodoProduct/, "it reads products");
});

test("HONESTY: the code states what the alert does and does NOT do, rather than implying paging", () => {
  // Condition B asked for the truth to be written down rather than dressed up.
  // These strings are load-bearing documentation, so they are pinned.
  const DODO_SRC = fs.readFileSync(path.join(ROOT, "src/lib/dodo.ts"), "utf8");
  assert.match(DODO_SRC, /NOBODY IS PAGED/, "says plainly that nothing pages");
  assert.match(DODO_SRC, /journalctl -u mira-web/, "names the only place the line lands");
  assert.match(DODO_SRC, /UNFALSIFIABLE/, "says the length check cannot fire");
});
