// Defect E (jury #102): a paying customer must be able to CANCEL self-serve,
// while REFUNDS stay behind human approval.
//
// AND (gotchas#263, decisions#342 Q_C) cancelling must not CONFISCATE the
// period the customer already paid for. The route sends Dodo
// `atPeriodEnd: true` — billing genuinely stops at the end of the paid period —
// but it used to stamp the local record `status: "cancelled"` in the same
// breath, and src/lib/entitlement-core.mjs grants web access on the literal
// string "active" and nothing else. So the response promised "you keep
// everything you've paid for until the end of your current billing period"
// while the same request locked them out on the spot. The judge's rule:
// ACCESS IS GATED ON PERIOD-END, NOT ON CANCELLATION-FLAG TIMING.
//
// Two kinds of test live here, and the split is deliberate:
//   - SOURCE SCANS (sections 1-3) for the security properties, which are
//     statements about what the code CANNOT contain.
//   - BEHAVIOURAL tests (section 4) against the REAL route handler through
//     scripts/route-harness, because "the customer still has access" is a
//     statement about what the system DOES, and a source scan cannot make it.
//   - COUNTERFACTUALS (section 5) run the same behavioural assertions against
//     `git show HEAD:src/app/api/subscription/cancel/route.ts` and require them
//     to go RED there, so a passing suite is evidence of a fix rather than a
//     description of it.
//
// Run: npm run test:cancel
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadRoute, readJson, env, resetNet, scriptFetch, netCalls, ROOT } from "./route-harness/index.mjs";
import { __cookies } from "./route-harness/stubs/next-headers.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => readFileSync(join(root, ...p), "utf8");

const cancelSrc = read("src", "app", "api", "subscription", "cancel", "route.ts");
const refundSrc = read("src", "app", "api", "subscription", "refund-request", "route.ts");
const dodoSrc = read("src", "lib", "dodo.ts");
const storeSrc = read("src", "lib", "store.ts");

// ---- anti-IDOR: identity must come from the session, never from the client ----

test("cancel resolves the subscription from the SESSION email only", () => {
  assert.match(cancelSrc, /getSession\(\)/, "must read the verified session");
  assert.match(
    cancelSrc,
    /getSubscriptionByEmail\(\s*session\.email\s*\)/,
    "must look up by the session email",
  );
});

test("cancel accepts NO client-supplied identifier — nothing to tamper with", () => {
  // The handler takes no request argument at all, so there is no body to trust.
  assert.match(
    cancelSrc,
    /export async function POST\(\)/,
    "POST must take no request parameter",
  );
  assert.doesNotMatch(
    cancelSrc,
    /body\.(customerId|customer_id|subscriptionId|subscription_id|email)/,
    "must never read an identity field from the request body",
  );
});

test("cancel refuses an unauthenticated caller", () => {
  assert.match(cancelSrc, /not_signed_in/);
  assert.match(cancelSrc, /status:\s*401/);
});

test("getSubscriptionByEmail re-checks the record's own email (defence in depth)", () => {
  assert.match(
    storeSrc,
    /rec\.email[^\n]*toLowerCase\(\)\s*!==\s*email[^\n]*toLowerCase\(\)/,
    "the stored record's email must be re-verified against the session email",
  );
  assert.match(storeSrc, /return null/, "a mismatch must yield null, not a record");
});

// ---- refunds must NOT move money without a human ----

// Strip comments so a doc comment that *mentions* a function is never mistaken
// for a call to it. We care about executable code, not prose.
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the refund-request route NEVER calls the payment provider", () => {
  const code = stripComments(refundSrc);
  assert.doesNotMatch(
    code,
    /refundDodoPayment\s*\(/,
    "the customer-facing refund route must not call the Dodo refund API",
  );
  assert.doesNotMatch(
    code,
    /fetch\([^)]*dodo/i,
    "it must not reach the payment provider by any other route",
  );
  assert.match(refundSrc, /getSession\(\)/, "it must still be authenticated");
});

test("refundDodoPayment exists for an operator path but is not imported by the customer route", () => {
  assert.match(dodoSrc, /export async function refundDodoPayment/);
  assert.doesNotMatch(refundSrc, /from "@\/lib\/dodo"/, "customer route must not import the dodo client");
});

test("a refund request is recorded durably before any best-effort email", () => {
  const recordAt = refundSrc.indexOf("await record(");
  const mailAt = refundSrc.indexOf("sendMail(");
  assert.ok(recordAt > -1 && mailAt > -1, "both must exist");
  assert.ok(recordAt < mailAt, "durable record must be written before notification");
  assert.match(refundSrc, /not_recorded/, "a failed record must be reported honestly");
});

// ---- cancellation semantics (source-level) ----

test("cancel is at period end — the customer keeps what they paid for", () => {
  assert.match(dodoSrc, /cancel_at_next_billing_date/);
  assert.match(dodoSrc, /cancelled_by_customer/, "self-serve cancels use the customer reason");
  assert.match(cancelSrc, /atPeriodEnd:\s*true/);
});

test("the record is only touched AFTER the provider confirms", () => {
  const code = stripComments(cancelSrc);
  const providerAt = code.indexOf("await cancelDodoSubscription(");
  const writeAt = code.indexOf("rec.cancelAtPeriodEnd = true");
  assert.ok(providerAt > -1 && writeAt > -1, "both steps must exist");
  assert.ok(
    providerAt < writeAt,
    "we must not record a scheduled end while the provider call could still fail",
  );
});

test("THE FIX, STRUCTURALLY: this route never assigns rec.status at all", () => {
  // The single line that caused gotchas#263 was `rec.status = "cancelled"`.
  // Its absence is the fix; asserting the absence is what stops it coming back.
  const code = stripComments(cancelSrc);
  assert.doesNotMatch(
    code,
    /rec\.status\s*=(?!=)/,
    "assigning rec.status here revokes access the moment the customer clicks cancel — " +
      "entitlement-core.mjs grants ONLY on the literal string 'active'",
  );
  // ...and it must not be laundered through putSubscription either.
  assert.doesNotMatch(
    code,
    /putSubscription\([^)]*status\s*:/,
    "the status must not be rewritten inline on the way to the store",
  );
});

test("a provider failure fails closed and points the customer at a human", () => {
  assert.match(cancelSrc, /cancel_failed/);
  assert.match(cancelSrc, /status:\s*502/);
});

test("cancelling twice is idempotent, not an error", () => {
  assert.match(cancelSrc, /alreadyCancelled/);
});

test("a customer with no resolvable subscription is sent to a human, never guessed at", () => {
  assert.match(cancelSrc, /no_subscription/);
  assert.match(cancelSrc, /status:\s*404/);
  assert.match(cancelSrc, /manual_required/, "missing subscriptionId must not call the provider");
});

// ---- the index that makes email->subscription possible at all ----

test("putSubscription maintains the email index that cancellation depends on", () => {
  assert.match(storeSrc, /subIdByEmail/);
  assert.match(
    storeSrc,
    /export async function putSubscription[\s\S]*?kvSet\(subIdByEmail/,
    "the index must be written by the same call that persists the subscription",
  );
});

test("the email index key is normalised so session and stored emails always agree", () => {
  assert.match(storeSrc, /subIdByEmail = \(email: string\) =>[\s\S]*?toLowerCase\(\)/);
});

// ══════════════════════════════════════════════════════════════════════════
// 4. BEHAVIOURAL — the REAL route handler, the REAL store, the REAL
//    entitlement resolver (gotchas#263)
//
// Only three boundaries are faked, and they are the harness's: the `stripe` npm
// SDK, next/headers cookies(), and global fetch. src/lib/session.ts,
// src/lib/store.ts, src/lib/dodo.ts, src/lib/entitlement.ts and
// src/lib/entitlement-core.mjs all run verbatim, so "still has access" here
// means what it means in production — LIVE_DODO_STATUS decides it, not a mock.
// ══════════════════════════════════════════════════════════════════════════

const { POST } = await loadRoute("src/app/api/subscription/cancel/route.ts");
const store = await loadRoute("src/lib/store.ts");
const sessionLib = await loadRoute("src/lib/session.ts");
const { entitlementForEmail } = await loadRoute("src/lib/entitlement.ts");
const webhook = await loadRoute("src/lib/dodo-webhook-core.mjs");

// Dodo armed, Stripe absent — the current production posture, and the one where
// the Dodo entitlement path is the ONLY thing answering "has this person paid".
const DODO_ON = { DODO_API_KEY: "dodo_test_dummy_not_real", DODO_MODE: "test" };

const PERIOD_END = "2026-09-15T00:00:00.000Z";

let seq = 0;
/** A fresh identity per test: the in-memory store is shared across this file. */
function customer(tag) {
  seq += 1;
  return {
    email: `q-${tag}-${seq}@example.com`,
    customerId: `cus_Q_${tag}_${seq}`,
    subscriptionId: `sub_Q_${tag}_${seq}`,
  };
}

async function seed({ email, customerId, subscriptionId }, extra = {}) {
  await store.putSubscription(customerId, {
    token: `tok_${customerId}`,
    plan: "companion",
    email,
    status: "active",
    provider: "dodo",
    customerId,
    subscriptionId,
    createdAt: "2026-08-15T00:00:00.000Z",
    ...extra,
  });
}

function signIn(email) {
  __cookies.clear();
  __cookies.set(sessionLib.SESSION_COOKIE, sessionLib.createSessionToken(email));
}

/** Dodo's PATCH /subscriptions/<id> succeeds. Nothing else is answered. */
function dodoAccepts() {
  scriptFetch(async (url) => {
    if (!/dodopayments\.com\/subscriptions\//.test(url)) {
      throw new Error(`[test] unexpected outbound call to ${url}`);
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });
}

/** Dodo refuses. Used to prove a failed cancel changes nothing locally. */
function dodoRefuses() {
  scriptFetch(async () => new Response("nope", { status: 500 }));
}

const providerCalls = () => netCalls.filter((c) => /dodopayments\.com/.test(c.url));

/** Arm the world for one test. */
function arm(emailToSignIn) {
  env(DODO_ON);
  resetNet();
  dodoAccepts();
  __cookies.clear();
  if (emailToSignIn) signIn(emailToSignIn);
}

/** Drive the webhook exactly as the production route does, on the real store. */
async function fireWebhook(type, payload) {
  return webhook.applyDodoLifecycle(payload, type, {
    getSubscription: store.getSubscription,
    putSubscription: store.putSubscription,
    putConnect: store.putConnect,
    now: "2026-09-15T00:00:01.000Z",
    log: () => {},
    alert: () => {},
  });
}

test("Q: THE CENTREPIECE — a customer who cancels mid-period STILL has web entitlement immediately afterwards", async () => {
  const c = customer("centrepiece");
  await seed(c, { currentPeriodEnd: PERIOD_END });
  arm(c.email);

  const before = await entitlementForEmail(c.email);
  assert.equal(before.active, true, "sanity: they were entitled before clicking cancel");

  const res = await POST();
  const { status, body } = await readJson(res);
  assert.equal(status, 200);
  assert.equal(body.ok, true);

  // The whole defect, in one assertion. Pre-fix this was false.
  const after = await entitlementForEmail(c.email);
  assert.equal(
    after.active,
    true,
    "clicking cancel must not end the period the customer already paid for",
  );
  assert.equal(after.plan, "companion", "and they keep the tier they bought, not a downgrade");

  // Billing really was told to stop — this is not "we quietly did nothing".
  const calls = providerCalls();
  assert.equal(calls.length, 1, "exactly one provider call");
  assert.equal(calls[0].method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0].body).cancel_at_next_billing_date, true);
});

test("Q: the stored record keeps status 'active' and records the INTENT instead", async () => {
  const c = customer("intent");
  await seed(c, { currentPeriodEnd: PERIOD_END });
  arm(c.email);

  await POST();

  const rec = await store.getSubscription(c.customerId);
  assert.equal(rec.status, "active", "status is the entitlement gate; cancelling does not move it");
  assert.equal(rec.cancelAtPeriodEnd, true, "the scheduled end is recorded as its own fact");
  assert.equal(rec.currentPeriodEnd, PERIOD_END, "and the date we already held is preserved");
});

test("Q: the record's status is exactly the one entitlement-core grants on", async () => {
  const { LIVE_DODO_STATUS } = await loadRoute("src/lib/entitlement-core.mjs");
  const c = customer("gate");
  await seed(c, { currentPeriodEnd: PERIOD_END });
  arm(c.email);

  await POST();

  const rec = await store.getSubscription(c.customerId);
  assert.ok(
    LIVE_DODO_STATUS.has(rec.status),
    `stored status ${JSON.stringify(rec.status)} must be one LIVE_DODO_STATUS grants on`,
  );
});

test("Q: the MESSAGE names the real date when we hold one, and it matches the stored date", async () => {
  const c = customer("dated");
  await seed(c, { currentPeriodEnd: PERIOD_END });
  arm(c.email);

  const { body } = await readJson(await POST());
  assert.match(body.message, /15 September 2026/, "the promise must name the date we actually hold");
  assert.match(body.message, /keep full access/);
  assert.equal(body.currentPeriodEnd, PERIOD_END, "and the machine-readable field agrees with it");
  assert.equal(body.cancelAtPeriodEnd, true);
  assert.equal(body.status, "active", "the reported status is the STORED one, not a relabel");
});

test("Q: with NO date on file, the message promises access but states NO date — vaguer beats wrong", async () => {
  const c = customer("undated");
  await seed(c); // no currentPeriodEnd: periodFieldsFromDodo returns nothing when the field name is unrecognised
  arm(c.email);

  const { body } = await readJson(await POST());
  assert.equal(body.currentPeriodEnd, null, "we must not invent a date we do not have");
  assert.doesNotMatch(
    body.message,
    /January|February|March|April|May|June|July|August|September|October|November|December|\d{4}-\d{2}-\d{2}|\b20\d\d\b/,
    "an unknown period end must never be reported as a confident date",
  );
  assert.match(body.message, /keep full access until the end of the period/);

  // And the honest-vagueness must NOT have cost them their access.
  const after = await entitlementForEmail(c.email);
  assert.equal(after.active, true, "not knowing the date is not evidence the period ended");
});

test("Q: NOT free service — the webhook's period-end event still revokes", async () => {
  const c = customer("revokes");
  await seed(c, { currentPeriodEnd: PERIOD_END });
  arm(c.email);

  await POST();
  assert.equal((await entitlementForEmail(c.email)).active, true, "mid-period: still served");

  // The period actually runs out. This is the event the route deliberately
  // leaves the revocation to, rather than building a second scheduler.
  const out = await fireWebhook("subscription.expired", {
    customer: { customer_id: c.customerId },
    subscription_id: c.subscriptionId,
  });
  assert.equal(out.ok, true);
  assert.equal(out.action, "revoke");

  const rec = await store.getSubscription(c.customerId);
  assert.equal(rec.status, "cancelled", "the provider's own end event is what revokes");
  const after = await entitlementForEmail(c.email);
  assert.equal(after.active, false, "after the period ends, access really does stop");
});

test("Q: subscription.cancelled revokes too — both terminal events are wired", async () => {
  const c = customer("revokes2");
  await seed(c, { currentPeriodEnd: PERIOD_END });
  arm(c.email);
  await POST();

  await fireWebhook("subscription.cancelled", { customer: { customer_id: c.customerId } });
  assert.equal((await store.getSubscription(c.customerId)).status, "cancelled");
  assert.equal((await entitlementForEmail(c.email)).active, false);
});

test("Q: IDEMPOTENT — clicking cancel twice makes exactly ONE provider call and corrupts nothing", async () => {
  const c = customer("twice");
  await seed(c, { currentPeriodEnd: PERIOD_END });
  arm(c.email);

  const first = await readJson(await POST());
  const second = await readJson(await POST());

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.body.ok, true, "a second click is not an error");
  assert.equal(second.body.alreadyCancelled, true);
  assert.equal(
    providerCalls().length,
    1,
    "the second click must NOT reach Dodo again — cancelAtPeriodEnd is the durable memory of the first",
  );

  const rec = await store.getSubscription(c.customerId);
  assert.equal(rec.status, "active", "and the record is not degraded by the second click");
  assert.equal(rec.cancelAtPeriodEnd, true);
  assert.equal(rec.currentPeriodEnd, PERIOD_END);
  assert.equal(rec.plan, "companion");
  assert.equal((await entitlementForEmail(c.email)).active, true, "still served after two clicks");
});

test("Q: a record the WEBHOOK already scheduled is recognised — no duplicate provider call", async () => {
  // Dodo-initiated cancellations arrive as cancelAtPeriodEnd via the webhook.
  // The route must treat that as already-done, not cancel a second time.
  const c = customer("webhook-scheduled");
  await seed(c, { cancelAtPeriodEnd: true, currentPeriodEnd: PERIOD_END });
  arm(c.email);

  const { status, body } = await readJson(await POST());
  assert.equal(status, 200);
  assert.equal(body.alreadyCancelled, true);
  assert.match(body.message, /15 September 2026/);
  assert.equal(providerCalls().length, 0, "nothing to do at the provider");
  assert.equal((await entitlementForEmail(c.email)).active, true);
});

test("Q: an ALREADY-ENDED subscription stays ended — the route never resurrects access", async () => {
  const c = customer("ended");
  await seed(c, { status: "cancelled" });
  arm(c.email);

  const { body } = await readJson(await POST());
  assert.equal(body.alreadyCancelled, true);
  assert.equal(body.status, "cancelled");
  assert.equal(providerCalls().length, 0);
  assert.equal(
    (await entitlementForEmail(c.email)).active,
    false,
    "cancelling an ended plan must not hand access back",
  );
});

test("Q: ENTITLEMENT-NEUTRAL BOTH WAYS — a paused customer is not promoted to active by cancelling", async () => {
  // The mirror-image bug: if the route wrote status "active" to keep access, it
  // would GRANT access to someone who does not have it. It writes neither.
  const c = customer("paused");
  await seed(c, { status: "paused", currentPeriodEnd: PERIOD_END });
  arm(c.email);

  const { body } = await readJson(await POST());
  const rec = await store.getSubscription(c.customerId);
  assert.equal(rec.status, "paused", "the route must leave a non-active status exactly as it found it");
  assert.equal(rec.cancelAtPeriodEnd, true, "the scheduled end is still recorded");
  assert.equal((await entitlementForEmail(c.email)).active, false, "and they are still not entitled");
  assert.doesNotMatch(
    body.message,
    /keep full access/,
    "we must not promise access to someone who does not currently have it",
  );
  assert.match(body.message, /won't be charged again/, "the true half of the promise still holds");
});

test("Q: a FAILED provider call leaves the record completely untouched", async () => {
  const c = customer("provider-down");
  await seed(c, { currentPeriodEnd: PERIOD_END });
  arm(c.email);
  dodoRefuses();

  const { status, body } = await readJson(await POST());
  assert.equal(status, 502);
  assert.equal(body.error, "cancel_failed");

  const rec = await store.getSubscription(c.customerId);
  assert.equal(rec.cancelAtPeriodEnd, undefined, "no scheduled end may be recorded when none was scheduled");
  assert.equal(rec.status, "active");
  assert.equal((await entitlementForEmail(c.email)).active, true, "and their access is untouched");
});

test("Q: signed out, the route does nothing at all", async () => {
  arm(null);
  const { status, body } = await readJson(await POST());
  assert.equal(status, 401);
  assert.equal(body.error, "not_signed_in");
  assert.equal(providerCalls().length, 0);
});

test("Q: a Stripe-era record with no subscriptionId is sent to a human, and nothing is written", async () => {
  const c = customer("legacy");
  await seed(c, { subscriptionId: undefined, provider: "stripe" });
  arm(c.email);

  const { status, body } = await readJson(await POST());
  assert.equal(status, 409);
  assert.equal(body.error, "manual_required");
  assert.equal(providerCalls().length, 0);
  const rec = await store.getSubscription(c.customerId);
  assert.equal(rec.cancelAtPeriodEnd, undefined, "we must not claim a scheduled end we never scheduled");
  assert.equal((await entitlementForEmail(c.email)).active, true);
});

// ══════════════════════════════════════════════════════════════════════════
// 5. COUNTERFACTUAL — every assertion above must go RED against the route as
//    it stands before this fix.
//
// `git show HEAD:src/app/api/subscription/cancel/route.ts` is materialised in a
// scratch directory and imported through the SAME harness. hooks.mjs resolves
// `@/...` absolutely against the repo, so the old revision talks to the same
// real store and the same real entitlement resolver — the only thing that
// differs between the two columns is the route file itself.
// ══════════════════════════════════════════════════════════════════════════

const headSrc = execFileSync(
  "git",
  ["show", "HEAD:src/app/api/subscription/cancel/route.ts"],
  { cwd: ROOT, encoding: "utf8" },
);

const headDir = fs.mkdtempSync(path.join(os.tmpdir(), "cancel-head-"));
const headFile = path.join(headDir, "cancel-HEAD.ts");
fs.writeFileSync(headFile, headSrc, "utf8");
const head = await loadRoute(headFile);

test("COUNTERFACTUAL sanity: the HEAD route really is the one that stamped the record", () => {
  assert.match(headSrc, /rec\.status = "cancelled"/, "sanity: the defect line was there");
  assert.match(
    headSrc,
    /You keep everything you've paid for until the end of your current billing period/,
    "sanity: and it promised the customer the opposite",
  );
  assert.doesNotMatch(headSrc, /cancelAtPeriodEnd/, "sanity: the intent was recorded nowhere");
});

test("COUNTERFACTUAL: pre-fix, cancelling mid-period REVOKED web entitlement on the spot", async () => {
  const c = customer("cf-centrepiece");
  await seed(c, { currentPeriodEnd: PERIOD_END });
  arm(c.email);

  assert.equal((await entitlementForEmail(c.email)).active, true, "sanity: entitled before");

  const { body } = await readJson(await head.POST());
  const after = await entitlementForEmail(c.email);

  // The defect, reproduced.
  assert.equal(after.active, false, "sanity: HEAD really did lock them out immediately");

  // THE PROMISE AND THE BEHAVIOUR, SIDE BY SIDE IN ONE RESPONSE. This is what
  // made it a defect rather than a preference.
  assert.match(body.message, /You keep everything you've paid for/);
  assert.equal(
    after.active,
    false,
    "the same request that promised the period took it away",
  );

  // The centrepiece assertion from section 4, run against HEAD — it MUST fail
  // there, or it proves nothing about the fix.
  assert.throws(
    () => assert.equal(after.active, true),
    "if this passed pre-fix, the centrepiece test is not evidence of anything",
  );
});

test("COUNTERFACTUAL: pre-fix the stored record said 'cancelled', which is not a status the gate grants on", async () => {
  const { LIVE_DODO_STATUS } = await loadRoute("src/lib/entitlement-core.mjs");
  const c = customer("cf-record");
  await seed(c, { currentPeriodEnd: PERIOD_END });
  arm(c.email);

  await head.POST();
  const rec = await store.getSubscription(c.customerId);

  assert.equal(rec.status, "cancelled", "sanity: HEAD wrote the revoking status");
  assert.equal(rec.cancelAtPeriodEnd, undefined, "sanity: HEAD recorded no intent");
  assert.equal(
    LIVE_DODO_STATUS.has(rec.status),
    false,
    "and that is exactly why access vanished",
  );

  // The section-4 assertions, run against HEAD.
  assert.throws(() => assert.equal(rec.status, "active"));
  assert.throws(() => assert.equal(rec.cancelAtPeriodEnd, true));
});

test("COUNTERFACTUAL: pre-fix the response could not name the end date, because nothing carried one", async () => {
  const c = customer("cf-message");
  await seed(c, { currentPeriodEnd: PERIOD_END });
  arm(c.email);

  const { body } = await readJson(await head.POST());
  assert.equal(body.currentPeriodEnd, undefined, "sanity: no date was ever returned");
  assert.equal(body.cancelAtPeriodEnd, undefined);
  // The section-4 assertion, run against HEAD.
  assert.throws(
    () => assert.match(body.message, /15 September 2026/),
    "the dated-message assertion must be impossible pre-fix",
  );
});

test("COUNTERFACTUAL: pre-fix, a webhook-scheduled cancellation was cancelled AGAIN at the provider", async () => {
  // HEAD's only idempotency guard was status === "cancelled". A record whose
  // end Dodo had already scheduled still read "active", so a click sent a
  // second PATCH — and then revoked the customer mid-period for good measure.
  const c = customer("cf-double");
  await seed(c, { cancelAtPeriodEnd: true, currentPeriodEnd: PERIOD_END });
  arm(c.email);

  await head.POST();
  assert.equal(providerCalls().length, 1, "sanity: HEAD called the provider anyway");
  assert.equal(
    (await entitlementForEmail(c.email)).active,
    false,
    "sanity: and revoked a customer whose period had not ended",
  );

  // The section-4 assertions, run against HEAD.
  assert.throws(() => assert.equal(providerCalls().length, 0));
});

test("COUNTERFACTUAL: the structural assertion (no rec.status assignment) goes red against HEAD", () => {
  const headCode = stripComments(headSrc);
  assert.match(headCode, /rec\.status\s*=(?!=)/, "sanity: the assignment is really there");
  assert.throws(
    () => assert.doesNotMatch(headCode, /rec\.status\s*=(?!=)/),
    "the structural guard must be a real constraint, not a tautology",
  );
});
