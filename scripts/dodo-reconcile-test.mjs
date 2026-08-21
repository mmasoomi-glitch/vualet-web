/**
 * RECONCILIATION SWEEP — behavioural tests.
 *
 * Every test here runs against FIXTURES. There is no network call, no
 * DODO_API_KEY read and no real store: the sweep takes its Dodo reader and its
 * store as injected dependencies precisely so this file can drive it through
 * scenarios that would otherwise require a broken production webhook to
 * reproduce.
 *
 * The six scenarios the sweep exists for, each proved end to end:
 *   (a) a subscription CANCELLED at Dodo whose webhook never arrived
 *   (b) a payment REFUNDED at Dodo whose refund.succeeded never arrived
 *   (c) a DUNNING STALL — Dodo says on_hold, local still says active
 *   (d) a PROVIDER ERROR mid-sweep revokes NOBODY
 *   (e) a LEGACY non-Dodo record is NOT revoked on a 404
 *   (f) DRY RUN writes nothing at all
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  planSweep,
  applySweep,
  runReconcile,
  formatReport,
  providerVerdict,
  isRepairable,
  subscriptionEventType,
  disputeEventType,
  refundEventType,
  redactEmail,
  redactId,
  redactFinding,
  SWEEP_LIMITS,
  PERIOD_ONLY_EFFECT,
  exitCodeFor,
  EXIT_MEANING,
  revocationClearance,
  SWEEP_APPLIES,
} from "../src/lib/reconcile-core.mjs";
import { fileWriterGuard } from "./dodo-reconcile.mjs";
import { DODO_EVENT_EFFECTS, dodoEventEffect, applyDodoOutcome } from "../src/lib/dodo-webhook-core.mjs";
import { LIVE_DODO_STATUS } from "../src/lib/entitlement-core.mjs";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = "2026-08-21T12:00:00.000Z";

/** A local record as the Dodo webhook would have written it at activation. */
function localRec(over = {}) {
  return {
    token: "tok_alpha",
    plan: "companion",
    email: "ada.lovelace@example.co.uk",
    status: "active",
    provider: "dodo",
    customerId: "cus_alpha",
    subscriptionId: "sub_alpha",
    createdAt: "2026-07-01T00:00:00.000Z",
    ...over,
  };
}

/** A Dodo /subscriptions list item, shaped as the verified probe returned. */
function dodoSub(over = {}) {
  return {
    subscription_id: "sub_alpha",
    status: "active",
    product_id: "prod_companion",
    product_name: "Mira Companion",
    customer: { customer_id: "cus_alpha", email: "ada.lovelace@example.co.uk", name: "Ada" },
    metadata: { connect_token: "tok_alpha", plan: "companion" },
    trial_period_days: 14,
    next_billing_date: "2026-09-01T00:00:00.000Z",
    cancelled_at: null,
    cancel_at_next_billing_date: false,
    scheduled_change: null,
    ...over,
  };
}

/** A Dodo /payments list item, shaped as the verified probe returned. */
function dodoPayment(over = {}) {
  return {
    payment_id: "pay_alpha_0001",
    status: "succeeded",
    total_amount: 1499,
    currency: "USD",
    subscription_id: "sub_alpha",
    customer: { customer_id: "cus_alpha", email: "ada.lovelace@example.co.uk" },
    metadata: { connect_token: "tok_alpha" },
    refund_status: null,
    dispute_status: null,
    invoice_id: "inv_alpha",
    invoice_url: "https://example.invalid/inv_alpha",
    // NOT part of the verifications#413 field list. Carried here only because
    // the sweep tolerates it for an operator-facing timestamp; a test below
    // proves an exactly-#413-shaped payment (no created_at) behaves the same.
    created_at: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

/**
 * An in-memory Dodo reader. `fail` lets a test break one specific read the way
 * a 429 or a dropped connection would.
 */
function fakeDodo({ subs = [], payments = [], present = new Set(), fail = {} } = {}) {
  const calls = { listSubscriptions: 0, listPayments: 0, getSubscription: [] };
  const page = (rows, { pageNumber, pageSize }) => rows.slice(pageNumber * pageSize, (pageNumber + 1) * pageSize);
  return {
    calls,
    async listSubscriptions(p) {
      calls.listSubscriptions++;
      if (fail.listSubscriptions && calls.listSubscriptions >= fail.listSubscriptions) {
        throw new Error("Dodo GET /subscriptions -> 429");
      }
      return { items: page(subs, p) };
    },
    async listPayments(p) {
      calls.listPayments++;
      if (fail.listPayments && calls.listPayments >= fail.listPayments) {
        throw new Error("Dodo GET /payments -> 503");
      }
      return { items: page(payments, p) };
    },
    async getSubscription(id) {
      calls.getSubscription.push(id);
      if (fail.getSubscription) throw new Error("Dodo GET /subscriptions/{id} -> 500");
      return { found: present.has(id) };
    },
  };
}

/** An in-memory store that RECORDS every write so "writes nothing" is provable. */
function fakeStore(records = {}, { failWritesFor = new Set() } = {}) {
  const data = new Map(Object.entries(records));
  const writes = [];
  const connectWrites = [];
  return {
    data,
    writes,
    connectWrites,
    async getSubscription(customerId) {
      const r = data.get(customerId);
      return r ? JSON.parse(JSON.stringify(r)) : null;
    },
    async listSubscriptionCustomerIds() {
      return [...data.keys()];
    },
    async putSubscription(customerId, rec) {
      if (failWritesFor.has(customerId)) throw new Error("store unavailable");
      writes.push({ customerId, rec: JSON.parse(JSON.stringify(rec)) });
      data.set(customerId, JSON.parse(JSON.stringify(rec)));
    },
    async putConnect(rec) {
      connectWrites.push(JSON.parse(JSON.stringify(rec)));
    },
  };
}

const opts = (over = {}) => ({ now: NOW, ...over });
const findingsOfKind = (plan, kind) => plan.findings.filter((f) => f.kind === kind);
const forCustomer = (plan, id) => plan.findings.filter((f) => f.customerId === id);

// ===========================================================================
// (a) A SUBSCRIPTION CANCELLED AT DODO WHOSE WEBHOOK NEVER ARRIVED
// ===========================================================================

test("(a) cancelled at Dodo, local still active: detected, and repaired in repair mode", async () => {
  const dodo = fakeDodo({ subs: [dodoSub({ status: "cancelled", cancelled_at: "2026-08-10T00:00:00.000Z" })] });
  const store = fakeStore({ cus_alpha: localRec({ status: "active" }) });

  const plan = await planSweep({ dodo, store }, opts());
  assert.equal(plan.complete, true);

  const f = plan.findings.find((x) => x.phase === "subscriptions" && x.customerId === "cus_alpha");
  assert.equal(f.kind, "revoke", "a cancelled provider status must produce a revoke finding");
  assert.equal(f.eventType, "subscription.cancelled");
  assert.equal(f.from, "active");
  assert.equal(f.to, "cancelled");
  assert.equal(f.applicable, true);
  assert.equal(f.entitlementLoss, true, "this is exactly the unbounded leak the sweep exists to close");

  const applied = await applySweep(plan, { store }, { mode: "repair" });
  assert.equal(applied.wrote, 1);
  assert.equal(store.writes.length, 1);
  assert.equal(store.writes[0].rec.status, "cancelled");
  assert.equal(LIVE_DODO_STATUS.has(store.writes[0].rec.status), false, "the repaired record must not entitle");
});

test("(a) the repair preserves every unrelated field of the record", async () => {
  const rich = localRec({
    status: "active",
    phone: "+971500000000",
    channel: "whatsapp",
    consent: { banRisk: true, at: "2026-07-01T00:00:00.000Z", rev: "c1" },
    persona: "warm",
    telegramId: 12345,
    trialEndsAt: "2026-07-15T00:00:00.000Z",
  });
  const dodo = fakeDodo({ subs: [dodoSub({ status: "cancelled" })] });
  const store = fakeStore({ cus_alpha: rich });

  const { applied } = await runReconcile({ dodo, store }, opts({ mode: "repair" }));
  assert.equal(applied.wrote, 1);
  const w = store.writes[0].rec;
  for (const k of ["phone", "channel", "consent", "persona", "telegramId", "trialEndsAt", "createdAt", "email"]) {
    assert.deepEqual(w[k], rich[k], `repair dropped ${k} — the same defect gotchas#257 fixed in activation`);
  }
});

test("(a) a cancel-at-period-end that never arrived syncs the DATES without touching access", async () => {
  const dodo = fakeDodo({
    subs: [
      dodoSub({
        status: "active",
        cancel_at_next_billing_date: true,
        next_billing_date: "2026-09-01T00:00:00.000Z",
      }),
    ],
  });
  const store = fakeStore({ cus_alpha: localRec({ status: "active" }) });

  const { plan, applied } = await runReconcile({ dodo, store }, opts({ mode: "repair" }));
  const f = forCustomer(plan, "cus_alpha").find((x) => x.phase === "subscriptions");
  assert.equal(f.kind, "period");
  assert.equal(f.entitlementLoss, false);
  assert.equal(applied.wrote, 1);
  assert.equal(store.writes[0].rec.status, "active", "period sync must never revoke");
  assert.equal(store.writes[0].rec.cancelAtPeriodEnd, true);
  assert.equal(store.writes[0].rec.currentPeriodEnd, "2026-09-01T00:00:00.000Z");
});

// ===========================================================================
// (b) A PAYMENT REFUNDED AT DODO WHOSE refund.succeeded NEVER ARRIVED
// ===========================================================================

test("(b) refund_status on the payment is detected even though no refund webhook arrived", async () => {
  const dodo = fakeDodo({
    subs: [dodoSub()],
    payments: [dodoPayment({ refund_status: "succeeded" })],
  });
  const store = fakeStore({ cus_alpha: localRec({ status: "active" }) });

  const plan = await planSweep({ dodo, store }, opts());
  assert.equal(plan.complete, true);

  const f = plan.findings.find((x) => x.phase === "payments");
  assert.equal(f.kind, "revoke");
  assert.equal(f.eventType, "refund.succeeded");
  assert.equal(f.to, "refunded");
  assert.equal(f.entitlementLoss, true);

  const applied = await applySweep(plan, { store }, { mode: "repair" });
  assert.equal(store.writes.length, 1, "one write per customer, however many findings they attract");
  assert.equal(store.writes[0].rec.status, "refunded");
  assert.equal(applied.wrote, 1);
});

test("(b) a dispute OUTCOME on the payment is caught; an OPEN dispute only flags", async () => {
  const lost = fakeDodo({ subs: [dodoSub()], payments: [dodoPayment({ dispute_status: "dispute_lost" })] });
  const lostStore = fakeStore({ cus_alpha: localRec() });
  await runReconcile({ dodo: lost, store: lostStore }, opts({ mode: "repair" }));
  assert.equal(lostStore.writes[0].rec.status, "chargeback");
  assert.equal(lostStore.writes[0].rec.disputed, true);

  const open = fakeDodo({ subs: [dodoSub()], payments: [dodoPayment({ dispute_status: "dispute_opened" })] });
  const openStore = fakeStore({ cus_alpha: localRec() });
  const { plan } = await runReconcile({ dodo: open, store: openStore }, opts({ mode: "repair" }));
  const f = plan.findings.find((x) => x.phase === "payments");
  assert.equal(f.kind, "flag");
  assert.equal(f.entitlementLoss, false, "an open dispute is not an outcome; many merchants win");
  assert.equal(openStore.writes[0].rec.status, "active", "access must stand while a dispute is undecided");
  assert.equal(openStore.writes[0].rec.disputed, true);
});

test("(b) a refund that did NOT succeed revokes nothing", async () => {
  for (const refund_status of ["pending", "review", "failed", "weird_new_value"]) {
    const dodo = fakeDodo({ subs: [dodoSub()], payments: [dodoPayment({ refund_status })] });
    const store = fakeStore({ cus_alpha: localRec() });
    const { plan } = await runReconcile({ dodo, store }, opts({ mode: "repair" }));
    assert.equal(
      plan.findings.some((f) => f.phase === "payments"),
      false,
      `refund_status="${refund_status}" must produce no payment finding at all`,
    );
    assert.equal(
      store.writes.some((w) => w.rec.status !== "active"),
      false,
      `refund_status="${refund_status}" must never revoke`,
    );
  }
});

test("(b) a payment against a DIFFERENT subscription is reported, never applied", async () => {
  const dodo = fakeDodo({
    subs: [dodoSub()],
    payments: [dodoPayment({ subscription_id: "sub_previous", refund_status: "succeeded" })],
  });
  const store = fakeStore({ cus_alpha: localRec({ subscriptionId: "sub_alpha", status: "active" }) });

  const { plan } = await runReconcile({ dodo, store }, opts({ mode: "repair" }));
  const f = plan.findings.find((x) => x.kind === "review_subscription_mismatch");
  assert.ok(f, "a refund on a superseded subscription must not silently revoke the live one");
  assert.equal(f.applicable, false);
  assert.equal(
    plan.findings.some((x) => x.phase === "payments" && x.applicable),
    false,
    "the payment phase must have applied nothing at all for this customer",
  );
  assert.equal(store.data.get("cus_alpha").status, "active", "the LIVE subscription keeps its entitlement");
});

// ===========================================================================
// (c) A DUNNING STALL — Dodo says on_hold, local still says active
// ===========================================================================

test("(c) dunning stall: Dodo on_hold vs local active is detected and repaired", async () => {
  const dodo = fakeDodo({ subs: [dodoSub({ status: "on_hold" })] });
  const store = fakeStore({ cus_alpha: localRec({ status: "active", pastDue: true, pastDueSince: "2026-08-05T00:00:00.000Z" }) });

  const plan = await planSweep({ dodo, store }, opts());
  const f = plan.findings.find((x) => x.phase === "subscriptions");
  assert.equal(f.kind, "revoke");
  assert.equal(f.eventType, "subscription.on_hold");
  assert.equal(f.to, "on_hold");
  assert.equal(f.entitlementLoss, true, "dunning exhausted with no on_hold webhook is indefinite free access");

  await applySweep(plan, { store }, { mode: "repair" });
  assert.equal(store.writes[0].rec.status, "on_hold");
  assert.equal(store.writes[0].rec.pastDueSince, "2026-08-05T00:00:00.000Z", "the dunning history must survive");
});

test("(c) a stall that has NOT reached on_hold still grants access — the sweep does not overreach", async () => {
  // Dodo still says active. The local record is flagged pastDue. That is the
  // documented, ruled-on state: retries are ongoing and one decline must not
  // lock a paying customer out mid-period. The sweep must not "help".
  const dodo = fakeDodo({ subs: [dodoSub({ status: "active" })] });
  const store = fakeStore({ cus_alpha: localRec({ status: "active", pastDue: true }) });

  const { plan, applied } = await runReconcile({ dodo, store }, opts({ mode: "repair" }));
  assert.equal(plan.stats.entitlementLosses, 0);
  assert.equal(
    plan.findings.some((f) => f.kind === "revoke"),
    false,
    "an in-progress dunning run is not a lapse and must produce no revocation",
  );
  assert.equal(store.data.get("cus_alpha").status, "active", "access stands");
  assert.equal(store.data.get("cus_alpha").pastDue, true, "and the flag is left exactly as the webhook set it");
  for (const w of store.writes) assert.equal(w.rec.status, "active");
  void applied;
});

test("(c) [#344] a dispute we WON is reported, not restored — and the cost is real", async () => {
  // BEFORE decisions#344 this test asserted the opposite: that a dispute.won
  // wrote status "active" and gave the customer their subscription back. The
  // owner revoked that authority. What remains is the honest consequence.
  const wonStore = fakeStore({ cus_alpha: localRec({ status: "chargeback", disputed: true }) });
  const { plan } = await runReconcile(
    {
      dodo: fakeDodo({ subs: [dodoSub()], payments: [dodoPayment({ dispute_status: "dispute_won" })] }),
      store: wonStore,
    },
    opts({ mode: "repair" }),
  );

  const f = plan.findings.find((x) => x.phase === "payments");
  assert.equal(f.kind, "review_restore");
  assert.equal(f.applicable, false);
  assert.equal(
    wonStore.data.get("cus_alpha").status,
    "chargeback",
    "we won the dispute and the customer STAYS revoked until a human acts — the accepted cost",
  );
  assert.equal(wonStore.writes.length, 0);

  // And the restore is refused at the level of authority, not at the level of
  // the `from` list: a record the effects table could never have restored
  // anyway (refunded is not in dispute.won's `from`) takes the same path, so
  // there is one rule here rather than two.
  const refundedStore = fakeStore({ cus_alpha: localRec({ status: "refunded" }) });
  const second = await runReconcile(
    {
      dodo: fakeDodo({ subs: [dodoSub()], payments: [dodoPayment({ dispute_status: "dispute_won" })] }),
      store: refundedStore,
    },
    opts({ mode: "repair" }),
  );
  assert.equal(second.plan.findings.find((x) => x.phase === "payments").kind, "review_restore");
  assert.equal(refundedStore.data.get("cus_alpha").status, "refunded");
  assert.equal(refundedStore.writes.length, 0);
});

// ===========================================================================
// (d) A PROVIDER ERROR MID-SWEEP REVOKES NOBODY
// ===========================================================================

test("(d) a provider error on page 2 revokes NOBODY — including the customers page 1 condemned", async () => {
  // Page 1 is full (so the sweep asks for page 2) and contains a genuine,
  // correctly-detected cancellation. Page 2 then 429s. The cancellation on page
  // 1 is real and correct — and it is STILL refused, because a half-read
  // provider is not a source of truth.
  const pageSize = 2;
  const subs = [
    dodoSub({ status: "cancelled" }),
    dodoSub({ subscription_id: "sub_beta", customer: { customer_id: "cus_beta" }, metadata: { connect_token: "tok_beta" } }),
    dodoSub({ subscription_id: "sub_gamma", customer: { customer_id: "cus_gamma" } }),
  ];
  const dodo = fakeDodo({ subs, fail: { listSubscriptions: 2 } });
  const store = fakeStore({
    cus_alpha: localRec({ status: "active" }),
    cus_beta: localRec({ customerId: "cus_beta", subscriptionId: "sub_beta", token: "tok_beta", status: "active" }),
  });

  const plan = await planSweep({ dodo, store }, opts({ limits: { pageSize } }));
  assert.equal(plan.complete, false);
  assert.equal(plan.errors.length, 1);
  assert.equal(plan.errors[0].phase, "subscriptions");
  assert.ok(
    plan.applicable.some((f) => f.entitlementLoss),
    "the plan should still SEE the revocation it found before the failure",
  );

  const applied = await applySweep(plan, { store }, { mode: "repair" });
  assert.equal(applied.wrote, 0, "an incomplete sweep must write nothing");
  assert.equal(store.writes.length, 0);
  assert.equal(store.data.get("cus_alpha").status, "active", "nobody was revoked");
  assert.match(applied.refused[0], /INCOMPLETE SWEEP/);
});

test("(d) an error in ANY phase refuses the repairs planned in the others", async () => {
  const dodo = fakeDodo({ subs: [dodoSub({ status: "cancelled" })], fail: { listPayments: 1 } });
  const store = fakeStore({ cus_alpha: localRec({ status: "active" }) });

  const { plan, applied } = await runReconcile({ dodo, store }, opts({ mode: "repair" }));
  assert.equal(plan.complete, false);
  assert.equal(plan.errors[0].phase, "payments");
  assert.equal(applied.wrote, 0);
  assert.equal(store.data.get("cus_alpha").status, "active");
});

test("(d) truncation counts as incomplete: a capped walk writes nothing", async () => {
  // Every page comes back full, so the walk never sees its own end and the cap
  // stops it. A capped listing looks exactly like a shorter one, so it is not
  // trusted.
  const subs = Array.from({ length: 6 }, (_, i) =>
    dodoSub({ subscription_id: `sub_${i}`, status: "cancelled", customer: { customer_id: `cus_${i}` } }),
  );
  const records = Object.fromEntries(
    subs.map((s, i) => [`cus_${i}`, localRec({ customerId: `cus_${i}`, subscriptionId: `sub_${i}`, token: `tok_${i}` })]),
  );
  const dodo = fakeDodo({ subs });
  const store = fakeStore(records);

  const plan = await planSweep({ dodo, store }, opts({ limits: { pageSize: 2, maxSubscriptionPages: 2 } }));
  assert.equal(plan.truncated.subscriptions, true);
  assert.equal(plan.complete, false);

  const applied = await applySweep(plan, { store }, { mode: "repair" });
  assert.equal(applied.wrote, 0);
  assert.equal(store.writes.length, 0);
});

test("(d) a sweep that runs past its total timeout is an error, not a verdict", async () => {
  let t = 0;
  const dodo = fakeDodo({ subs: [dodoSub({ status: "cancelled" })] });
  const store = fakeStore({ cus_alpha: localRec() });
  const plan = await planSweep(
    { dodo, store },
    opts({ limits: { totalTimeoutMs: 10 }, monotonicNow: () => (t += 1000) }),
  );
  assert.equal(plan.complete, false);
  assert.match(plan.errors[0].message, /totalTimeoutMs/);
  const applied = await applySweep(plan, { store }, { mode: "repair" });
  assert.equal(applied.wrote, 0);
});

test("(d) the blast-radius cap stops a sweep that wants to change implausibly many records", async () => {
  const n = 5;
  const subs = Array.from({ length: n }, (_, i) =>
    dodoSub({ subscription_id: `sub_${i}`, status: "cancelled", customer: { customer_id: `cus_${i}` } }),
  );
  const records = Object.fromEntries(
    subs.map((s, i) => [`cus_${i}`, localRec({ customerId: `cus_${i}`, subscriptionId: `sub_${i}`, token: `tok_${i}` })]),
  );
  const dodo = fakeDodo({ subs });
  const store = fakeStore(records);

  const plan = await planSweep({ dodo, store }, opts());
  assert.equal(plan.complete, true);
  assert.equal(plan.repairs.length, n);

  const applied = await applySweep(plan, { store }, { mode: "repair", maxRepairs: 3 });
  assert.equal(applied.wrote, 0, "over the cap, nothing is written at all");
  assert.match(applied.refused[0], /BLAST-RADIUS STOP/);
  assert.equal(store.writes.length, 0);
});

test("(d) one failing store write does not abort the others, and re-running finishes the job", async () => {
  const subs = [
    dodoSub({ status: "cancelled" }),
    dodoSub({ subscription_id: "sub_beta", status: "cancelled", customer: { customer_id: "cus_beta" }, metadata: { connect_token: "tok_beta" } }),
  ];
  const store = fakeStore(
    {
      cus_alpha: localRec(),
      cus_beta: localRec({ customerId: "cus_beta", subscriptionId: "sub_beta", token: "tok_beta" }),
    },
    { failWritesFor: new Set(["cus_alpha"]) },
  );
  const { applied } = await runReconcile({ dodo: fakeDodo({ subs }), store }, opts({ mode: "repair" }));
  assert.equal(applied.wrote, 1);
  assert.equal(applied.refused.length, 1);
  assert.match(applied.refused[0], /write failed/);
  assert.equal(store.data.get("cus_beta").status, "cancelled");
  assert.equal(store.data.get("cus_alpha").status, "active", "the failed one is simply still wrong, not corrupted");
});

// ===========================================================================
// (e) A LEGACY NON-DODO RECORD IS NOT REVOKED ON A 404
// ===========================================================================

test("(e) a Stripe-tagged record is never probed and never revoked", async () => {
  const dodo = fakeDodo({ subs: [], present: new Set() });
  const store = fakeStore({
    cus_stripe: localRec({ provider: "stripe", customerId: "cus_stripe", subscriptionId: "sub_stripe_legacy" }),
  });

  const { plan, applied } = await runReconcile({ dodo, store }, opts({ mode: "repair" }));
  assert.equal(plan.complete, true);
  assert.deepEqual(dodo.calls.getSubscription, [], "a foreign record must not even be sent to Dodo");
  const f = findingsOfKind(plan, "skipped_foreign_provider")[0];
  assert.ok(f);
  assert.equal(f.applicable, false);
  assert.equal(applied.wrote, 0);
  assert.equal(store.data.get("cus_stripe").status, "active");
});

test("(e) an UNTAGGED legacy record that 404s is reported, never revoked (verifications#412)", async () => {
  // This is the exact row that was once misdiagnosed as an orphaned Dodo
  // subscription: no provider tag, living in the provider-agnostic
  // mira:sub:<customerId> key space, unknown to Dodo — and perfectly healthy.
  const dodo = fakeDodo({ subs: [], present: new Set() });
  const untagged = localRec({ customerId: "cus_legacy", subscriptionId: "sub_legacy" });
  delete untagged.provider;
  const store = fakeStore({ cus_legacy: untagged });

  const { plan, applied } = await runReconcile({ dodo, store }, opts({ mode: "repair" }));
  const f = findingsOfKind(plan, "orphan_review_untagged")[0];
  assert.ok(f, "an untagged 404 must surface as a REVIEW, not a revocation");
  assert.equal(f.applicable, false);
  assert.equal(f.from, "active");
  assert.equal(f.to, "active", "the reported record keeps the status it has");
  assert.match(f.note, /NOTHING was revoked/);
  assert.equal(applied.wrote, 0);
  assert.equal(store.data.get("cus_legacy").status, "active");
});

test("(e) even a DODO-TAGGED record that 404s is not revoked — absence is not an outcome", async () => {
  const dodo = fakeDodo({ subs: [], present: new Set() });
  const store = fakeStore({ cus_alpha: localRec({ provider: "dodo" }) });

  const { plan, applied } = await runReconcile({ dodo, store }, opts({ mode: "repair" }));
  const f = findingsOfKind(plan, "orphan_review")[0];
  assert.ok(f);
  assert.equal(f.applicable, false);
  assert.equal(applied.wrote, 0);
  assert.equal(store.data.get("cus_alpha").status, "active");
  assert.equal(
    plan.findings.some((x) => x.entitlementLoss),
    false,
    "no 404, for any provenance, may cost anyone their access",
  );
});

test("(e) a record present at Dodo but missing from the listing is a LISTING GAP, not an orphan", async () => {
  const dodo = fakeDodo({ subs: [], present: new Set(["sub_alpha"]) });
  const store = fakeStore({ cus_alpha: localRec() });
  const { plan } = await runReconcile({ dodo, store }, opts({ mode: "repair" }));
  const f = findingsOfKind(plan, "listing_gap")[0];
  assert.ok(f, "a paged-past row must never masquerade as a vanished subscription");
  assert.equal(f.applicable, false);
});

test("(e) an untagged record IS repairable when Dodo itself names its connect token", async () => {
  // Provenance by evidence, not by inference: Dodo's own metadata identifies
  // the row as Dodo's, so a cancellation on it may be applied.
  const untagged = localRec({ status: "active" });
  delete untagged.provider;
  const dodo = fakeDodo({ subs: [dodoSub({ status: "cancelled" })] });
  const store = fakeStore({ cus_alpha: untagged });

  const { plan, applied } = await runReconcile({ dodo, store }, opts({ mode: "repair" }));
  const f = plan.findings.find((x) => x.phase === "subscriptions");
  assert.equal(f.verdict, "dodo_by_token");
  assert.equal(applied.wrote, 1);
  assert.equal(store.data.get("cus_alpha").status, "cancelled");
});

test("(e) an untagged record with NO Dodo-side evidence is skipped, not guessed at", async () => {
  const untagged = localRec({ status: "active", token: "tok_something_else", subscriptionId: "sub_something_else" });
  delete untagged.provider;
  const dodo = fakeDodo({ subs: [dodoSub({ status: "cancelled", metadata: {} })] });
  const store = fakeStore({ cus_alpha: untagged });

  const { plan, applied } = await runReconcile({ dodo, store }, opts({ mode: "repair" }));
  const f = findingsOfKind(plan, "skipped_unprovable_provenance")[0];
  assert.ok(f);
  assert.equal(applied.wrote, 0);
  assert.equal(store.data.get("cus_alpha").status, "active");
});

test("(e) providerVerdict never turns an absent tag into a provider", () => {
  const bare = { token: "t", subscriptionId: "s" };
  assert.equal(providerVerdict(bare, {}), "unprovable");
  assert.equal(providerVerdict({ ...bare, provider: "stripe" }, { connectToken: "t" }), "foreign");
  assert.equal(providerVerdict({ ...bare, provider: "paddle" }, { connectToken: "t" }), "foreign");
  assert.equal(providerVerdict({ ...bare, provider: "dodo" }, {}), "dodo");
  assert.equal(providerVerdict(bare, { connectToken: "t" }), "dodo_by_token");
  assert.equal(providerVerdict(bare, { subscriptionId: "s" }), "dodo_by_subscription");
  assert.equal(providerVerdict(null, { connectToken: "t" }), "no_record");
  assert.equal(isRepairable("unprovable"), false);
  assert.equal(isRepairable("foreign"), false);
  assert.equal(isRepairable("no_record"), false);
});

// ===========================================================================
// (f) DRY RUN WRITES NOTHING AT ALL
// ===========================================================================

test("(f) dry run is the default and writes nothing, for every kind of finding at once", async () => {
  const dodo = fakeDodo({
    subs: [
      dodoSub({ status: "cancelled" }),
      dodoSub({ subscription_id: "sub_beta", status: "on_hold", customer: { customer_id: "cus_beta" }, metadata: { connect_token: "tok_beta" } }),
    ],
    payments: [dodoPayment({ payment_id: "pay_g", customer: { customer_id: "cus_gamma" }, subscription_id: "sub_gamma", metadata: { connect_token: "tok_gamma" }, refund_status: "succeeded" })],
  });
  const store = fakeStore({
    cus_alpha: localRec(),
    cus_beta: localRec({ customerId: "cus_beta", subscriptionId: "sub_beta", token: "tok_beta" }),
    cus_gamma: localRec({ customerId: "cus_gamma", subscriptionId: "sub_gamma", token: "tok_gamma" }),
  });
  const before = JSON.stringify([...store.data.entries()]);

  const { plan, applied } = await runReconcile({ dodo, store }, opts()); // NO mode passed
  assert.equal(applied.mode, "dry-run");
  assert.ok(applied.wouldWrite >= 3, "the dry run must still say what it WOULD do");
  assert.equal(applied.wrote, 0);
  assert.equal(store.writes.length, 0, "not one putSubscription call");
  assert.equal(store.connectWrites.length, 0, "not one putConnect call either");
  assert.equal(JSON.stringify([...store.data.entries()]), before, "the store is byte-identical after a dry run");
  assert.match(formatReport(plan, applied), /DRY RUN — nothing was written/);
});

test("(f) only the literal string \"repair\" writes; anything else is a dry run", async () => {
  for (const mode of [undefined, null, "", "REPAIR", "repair!", "yes", true, 1, "dry-run"]) {
    const dodo = fakeDodo({ subs: [dodoSub({ status: "cancelled" })] });
    const store = fakeStore({ cus_alpha: localRec() });
    const { applied } = await runReconcile({ dodo, store }, opts({ mode }));
    assert.equal(store.writes.length, 0, `mode=${JSON.stringify(mode)} must not write`);
    assert.equal(applied.mode, "dry-run");
  }
});

test("(f) planSweep alone never writes, whatever the plan says", async () => {
  const dodo = fakeDodo({ subs: [dodoSub({ status: "cancelled" })] });
  const store = fakeStore({ cus_alpha: localRec() });
  const plan = await planSweep({ dodo, store }, opts());
  assert.equal(plan.repairs.length, 1);
  assert.equal(store.writes.length, 0);
});

// ===========================================================================
// IDEMPOTENCE AND CONVERGENCE
// ===========================================================================

test("running the sweep twice changes nothing the second time", async () => {
  const subs = [
    dodoSub({ status: "cancelled" }),
    dodoSub({ subscription_id: "sub_beta", status: "on_hold", customer: { customer_id: "cus_beta" }, metadata: { connect_token: "tok_beta" } }),
  ];
  const payments = [dodoPayment({ dispute_status: "dispute_lost" })];
  const store = fakeStore({
    cus_alpha: localRec(),
    cus_beta: localRec({ customerId: "cus_beta", subscriptionId: "sub_beta", token: "tok_beta" }),
  });

  const first = await runReconcile({ dodo: fakeDodo({ subs, payments }), store }, opts({ mode: "repair" }));
  assert.ok(first.applied.wrote > 0);
  const afterFirst = JSON.stringify([...store.data.entries()]);
  const writesAfterFirst = store.writes.length;

  const second = await runReconcile({ dodo: fakeDodo({ subs, payments }), store }, opts({ mode: "repair" }));
  assert.equal(second.applied.wrote, 0, "the second run must be a no-op");
  assert.equal(second.plan.stats.applicable, 0);
  assert.equal(store.writes.length, writesAfterFirst, "no further writes at all");
  assert.equal(JSON.stringify([...store.data.entries()]), afterFirst, "the store is unchanged");

  const third = await runReconcile({ dodo: fakeDodo({ subs, payments }), store }, opts({ mode: "repair" }));
  assert.equal(third.applied.wrote, 0);
});

test("two revocations from one snapshot do not relabel each other, run after run", async () => {
  // The failure this guards against: Dodo says the subscription is `cancelled`
  // AND the last payment says `dispute_lost`. Applied naively, the two phases
  // overwrite each other's status and every future run reports a change and
  // rewrites the record — churn forever, on a tool meant to run on a schedule.
  const subs = [dodoSub({ status: "cancelled" })];
  const payments = [dodoPayment({ dispute_status: "dispute_lost" })];
  const store = fakeStore({ cus_alpha: localRec({ status: "active" }) });

  await runReconcile({ dodo: fakeDodo({ subs, payments }), store }, opts({ mode: "repair" }));
  const settled = store.data.get("cus_alpha").status;
  assert.equal(LIVE_DODO_STATUS.has(settled), false, "whichever revocation won, access is gone");
  assert.equal(store.data.get("cus_alpha").disputed, true, "and the dispute is still recorded for the operator");

  for (let i = 0; i < 3; i++) {
    const { applied } = await runReconcile({ dodo: fakeDodo({ subs, payments }), store }, opts({ mode: "repair" }));
    assert.equal(applied.wrote, 0, `run ${i + 2} wrote again — the sweep is not convergent`);
    assert.equal(store.data.get("cus_alpha").status, settled);
  }
});

test("the already-revoked guard never blocks the active -> revoked transition it exists beside", async () => {
  // The guard only ever declines to move a record that ALREADY denies access,
  // so it cannot mask the leak this whole file exists to close.
  for (const status of ["cancelled", "on_hold", "paused", "expired"]) {
    const store = fakeStore({ cus_alpha: localRec({ status: "active" }) });
    await runReconcile({ dodo: fakeDodo({ subs: [dodoSub({ status })] }), store }, opts({ mode: "repair" }));
    assert.equal(
      LIVE_DODO_STATUS.has(store.data.get("cus_alpha").status),
      false,
      `provider status "${status}" failed to revoke a live local record`,
    );
  }
});

test("a record that already denies access keeps its label but still records new evidence", async () => {
  const store = fakeStore({ cus_alpha: localRec({ status: "cancelled" }) });
  const { plan } = await runReconcile(
    {
      dodo: fakeDodo({ subs: [], payments: [dodoPayment({ dispute_status: "dispute_lost" })] }),
      store,
    },
    opts({ mode: "repair" }),
  );
  const f = plan.findings.find((x) => x.phase === "payments");
  assert.equal(f.kind, "already_revoked");
  assert.equal(f.from, "cancelled");
  assert.equal(f.to, "cancelled", "the entitlement-bearing status is pinned");
  assert.equal(f.entitlementLoss, false, "nothing was lost that was not already gone");
  assert.equal(store.data.get("cus_alpha").status, "cancelled");
  assert.equal(store.data.get("cus_alpha").disputed, true, "but the dispute bookkeeping still lands");
  assert.equal(store.data.get("cus_alpha").disputeStatus, "lost");
});

test("an already-correct record reports as already_correct, not as a change", async () => {
  const dodo = fakeDodo({ subs: [dodoSub({ status: "cancelled" })], present: new Set(["sub_alpha"]) });
  const store = fakeStore({
    cus_alpha: localRec({
      status: "cancelled",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: "2026-09-01T00:00:00.000Z",
    }),
  });
  const { plan, applied } = await runReconcile({ dodo, store }, opts({ mode: "repair" }));
  const f = plan.findings.find((x) => x.phase === "subscriptions");
  assert.equal(f.kind, "already_correct");
  assert.equal(f.applicable, false);
  assert.match(f.note, /replay-safe/);
  assert.equal(applied.wrote, 0);
});

// ===========================================================================
// RULE A — THE SWEEP NEVER MINTS ENTITLEMENT
// ===========================================================================

test("Dodo active + local revoked is a REVIEW, never an automatic grant", async () => {
  const dodo = fakeDodo({ subs: [dodoSub({ status: "active" })] });
  const store = fakeStore({ cus_alpha: localRec({ status: "cancelled" }) });

  const { plan, applied } = await runReconcile({ dodo, store }, opts({ mode: "repair" }));
  const f = findingsOfKind(plan, "review_grant")[0];
  assert.ok(f, "a locked-out possibly-paying customer must be surfaced");
  assert.equal(f.applicable, false);
  assert.equal(applied.wrote, 0);
  assert.equal(store.data.get("cus_alpha").status, "cancelled", "the sweep does not grant access");
  assert.ok(plan.stats.reviews > 0, "and it counts as needing a human");
});

test("a subscription Dodo knows and we do not is reported, never created", async () => {
  const dodo = fakeDodo({ subs: [dodoSub({ status: "active" })] });
  const store = fakeStore({});
  const { plan, applied } = await runReconcile({ dodo, store }, opts({ mode: "repair" }));
  assert.ok(findingsOfKind(plan, "missing_local_record")[0]);
  assert.equal(applied.wrote, 0);
  assert.equal(store.data.size, 0, "the sweep must not invent a record, and therefore not an entitlement");
});

test("no applied finding ever moves a record INTO an entitling status except a table-authorised restore", async () => {
  const cases = [
    ["cancelled", "subscriptions"],
    ["on_hold", "subscriptions"],
    ["paused", "subscriptions"],
    ["expired", "subscriptions"],
    ["failed", "subscriptions"],
  ];
  for (const [status] of cases) {
    const dodo = fakeDodo({ subs: [dodoSub({ status })] });
    const store = fakeStore({ cus_alpha: localRec({ status: "active" }) });
    const { plan } = await runReconcile({ dodo, store }, opts({ mode: "repair" }));
    for (const f of plan.applicable) {
      if (f.to && LIVE_DODO_STATUS.has(f.to) && f.from && !LIVE_DODO_STATUS.has(f.from)) {
        assert.equal(f.kind, "restore", `status ${status} produced an unauthorised grant`);
      }
    }
  }
});

// ===========================================================================
// ANTI-DRIFT — THERE IS ONLY ONE TABLE OF MEANINGS
// ===========================================================================

test("every subscription.* row in DODO_EVENT_EFFECTS round-trips through subscriptionEventType", () => {
  const rows = Object.keys(DODO_EVENT_EFFECTS).filter((k) => k.startsWith("subscription."));
  assert.ok(rows.length >= 8, "sanity: the effects table still has subscription rows");
  for (const type of rows) {
    const status = type.slice("subscription.".length);
    // update_payment_method / plan_changed / renewed are EVENT names, not
    // provider statuses, so they simply never appear as one. The property being
    // asserted is the direction that matters: whatever a status resolves to
    // must be a row in the table, and must be THAT row.
    assert.equal(subscriptionEventType(status), type);
  }
});

test("a provider status with no row in the effects table gets no meaning invented for it", () => {
  for (const status of ["pending", "processing", "some_future_state", "", "  ", null, undefined, 7]) {
    assert.equal(subscriptionEventType(status), null, `status ${JSON.stringify(status)} must resolve to nothing`);
  }
});

test("dispute and refund statuses resolve only to rows that exist in the effects table", () => {
  for (const [given, want] of [
    ["dispute_won", "dispute.won"],
    ["dispute_lost", "dispute.lost"],
    ["dispute_accepted", "dispute.accepted"],
    ["dispute_expired", "dispute.expired"],
    ["dispute_opened", "dispute.opened"],
    ["dispute_challenged", "dispute.challenged"],
    ["dispute_cancelled", "dispute.cancelled"],
    ["won", "dispute.won"],
  ]) {
    assert.equal(disputeEventType(given), want);
    assert.ok(dodoEventEffect(want), "the resolved type must be a real row");
  }
  for (const bad of ["dispute_unheard_of", "", null, 5, "dispute_"]) {
    assert.equal(disputeEventType(bad), null);
  }
  assert.equal(refundEventType("succeeded"), "refund.succeeded");
  assert.equal(refundEventType("SUCCEEDED"), "refund.succeeded");
  for (const bad of ["pending", "failed", "review", "", null, 1]) assert.equal(refundEventType(bad), null);
});

test("reconcile-core holds no second table of lifecycle meanings", () => {
  const src = readFileSync(new URL("../src/lib/reconcile-core.mjs", import.meta.url), "utf8");
  // The literal revoking statuses are the ones a divergent table would have to
  // spell out. They may appear in prose, but never as a code-level mapping —
  // and the only way this module can produce one is through the effects table.
  assert.match(src, /from "\.\/dodo-webhook-core\.mjs"/, "it must import the one table it defers to");
  assert.equal(
    /status:\s*"(refunded|chargeback|on_hold|paused|cancelled)"/.test(src),
    false,
    "reconcile-core must never assign a lifecycle status of its own",
  );
  assert.equal(PERIOD_ONLY_EFFECT.status, undefined, "the period pseudo-effect must carry no status");
  assert.equal(PERIOD_ONLY_EFFECT.from, undefined, "…and no restore authority");
  assert.equal(PERIOD_ONLY_EFFECT.pastDue, undefined);
  assert.equal(PERIOD_ONLY_EFFECT.disputed, undefined);
});

test("the entitlement verdict is read from the one gate, not re-spelled", async () => {
  // If someone widened LIVE_DODO_STATUS, entitlementLoss must follow it rather
  // than a copy. Proven by construction: a status inside the set is never
  // reported as a loss.
  const dodo = fakeDodo({ subs: [dodoSub({ status: "paused" })] });
  const store = fakeStore({ cus_alpha: localRec({ status: "active" }) });
  const { plan } = await runReconcile({ dodo, store }, opts());
  const f = plan.findings.find((x) => x.phase === "subscriptions");
  assert.equal(f.entitlementLoss, LIVE_DODO_STATUS.has("active") && !LIVE_DODO_STATUS.has("paused"));
});

// ===========================================================================
// BOUNDS, PAGINATION AND REDACTION
// ===========================================================================

test("pagination walks every page and stops at the first short one", async () => {
  const subs = Array.from({ length: 5 }, (_, i) =>
    dodoSub({ subscription_id: `sub_${i}`, customer: { customer_id: `cus_${i}` }, metadata: { connect_token: `tok_${i}` } }),
  );
  const dodo = fakeDodo({ subs });
  const store = fakeStore({});
  const plan = await planSweep({ dodo, store }, opts({ limits: { pageSize: 2 } }));
  assert.equal(plan.stats.subscriptionsSeen, 5);
  assert.equal(dodo.calls.listSubscriptions, 3, "three pages: 2 + 2 + 1(short, stop)");
  assert.equal(plan.complete, true);
});

test("the orphan probe is capped and never asks about a customer the listing already covered", async () => {
  const dodo = fakeDodo({ subs: [dodoSub()], present: new Set() });
  const store = fakeStore({
    cus_alpha: localRec(),
    cus_beta: localRec({ customerId: "cus_beta", subscriptionId: "sub_beta" }),
  });
  await planSweep({ dodo, store }, opts());
  assert.deepEqual(dodo.calls.getSubscription, ["sub_beta"], "cus_alpha was in the listing; do not ask twice");
});

test("SWEEP_LIMITS bounds every axis of the work", () => {
  for (const k of [
    "pageSize",
    "maxSubscriptionPages",
    "maxPaymentPages",
    "maxOrphanChecks",
    "maxRepairs",
    "requestTimeoutMs",
    "totalTimeoutMs",
  ]) {
    assert.equal(typeof SWEEP_LIMITS[k], "number", `${k} must be bounded`);
    assert.ok(SWEEP_LIMITS[k] > 0);
  }
  assert.equal(Object.isFrozen(SWEEP_LIMITS), true);
});

test("no report line ever contains a full email, customer id, subscription id or payment id", async () => {
  const dodo = fakeDodo({
    subs: [dodoSub({ status: "cancelled" })],
    payments: [dodoPayment({ refund_status: "succeeded" })],
  });
  const store = fakeStore({
    cus_alpha: localRec(),
    cus_legacy: (() => {
      const r = localRec({ customerId: "cus_legacy", subscriptionId: "sub_legacy_secret" });
      delete r.provider;
      return r;
    })(),
  });
  const { plan, applied } = await runReconcile({ dodo, store }, opts({ mode: "repair" }));
  const report = formatReport(plan, applied);
  for (const secret of [
    "ada.lovelace@example.co.uk",
    "ada.lovelace",
    "cus_alpha",
    "sub_alpha",
    "pay_alpha_0001",
    "cus_legacy",
    "sub_legacy_secret",
  ]) {
    assert.equal(report.includes(secret), false, `the report leaked "${secret}"`);
  }
  assert.ok(report.length > 0);
});

test("redactFinding strips every identifier and the effects-table row", async () => {
  const dodo = fakeDodo({
    subs: [dodoSub({ status: "cancelled" })],
    payments: [dodoPayment({ refund_status: "succeeded" })],
  });
  const store = fakeStore({ cus_alpha: localRec() });
  const { plan } = await runReconcile({ dodo, store }, opts());

  const dumped = JSON.stringify(plan.findings.map(redactFinding));
  for (const secret of ["cus_alpha", "sub_alpha", "pay_alpha_0001", "ada.lovelace"]) {
    assert.equal(dumped.includes(secret), false, `redactFinding leaked "${secret}"`);
  }
  for (const f of plan.findings.map(redactFinding)) {
    assert.equal("effect" in f, false, "the effects-table row must not be dumped");
    if (f.customerId !== undefined) assert.match(f.customerId, /^…/);
  }
  // The un-redacted findings DO keep raw ids, because the repair needs them.
  assert.equal(
    plan.findings.some((f) => f.customerId === "cus_alpha"),
    true,
  );
});

test("redaction helpers keep a usable suffix and nothing more", () => {
  assert.equal(redactEmail("ada.lovelace@example.co.uk"), "a…e@….uk");
  assert.equal(redactEmail("a@b.com"), "a…@….com");
  assert.equal(redactEmail("not-an-email"), "(none)");
  assert.equal(redactEmail(undefined), "(none)");
  assert.equal(redactId("sub_abc123456"), "…123456");
  assert.equal(redactId("abc"), "…abc");
  assert.equal(redactId(null), "(none)");
});

test("an unparseable or empty local record is skipped, never revoked", async () => {
  const dodo = fakeDodo({ subs: [dodoSub({ status: "cancelled" })] });
  const store = fakeStore({});
  store.getSubscription = async () => null; // what a corrupt row looks like to the sweep
  const { plan, applied } = await runReconcile({ dodo, store }, opts({ mode: "repair" }));
  assert.ok(findingsOfKind(plan, "missing_local_record")[0]);
  assert.equal(applied.wrote, 0);
});

test("a subscription that names no customer is reported and skipped", async () => {
  const dodo = fakeDodo({ subs: [dodoSub({ customer: {}, customer_id: undefined })] });
  const store = fakeStore({});
  const { plan, applied } = await runReconcile({ dodo, store }, opts({ mode: "repair" }));
  assert.ok(findingsOfKind(plan, "unidentifiable")[0]);
  assert.equal(applied.wrote, 0);
});

test("a store adapter that cannot enumerate keys degrades to report-only for that direction", async () => {
  const dodo = fakeDodo({ subs: [dodoSub({ status: "cancelled" })] });
  const store = fakeStore({ cus_alpha: localRec() });
  delete store.listSubscriptionCustomerIds;
  const { plan, applied } = await runReconcile({ dodo, store }, opts({ mode: "repair" }));
  assert.ok(findingsOfKind(plan, "phase_unavailable")[0]);
  assert.equal(plan.complete, true, "a missing capability is not a read failure");
  assert.equal(applied.wrote, 1, "the Dodo->local direction still works");
});

test("the connect record is mirrored only when the record carries a token", async () => {
  const withToken = fakeStore({ cus_alpha: localRec({ token: "tok_alpha" }) });
  await runReconcile({ dodo: fakeDodo({ subs: [dodoSub({ status: "cancelled" })] }), store: withToken }, opts({ mode: "repair" }));
  assert.equal(withToken.connectWrites.length, 1);
  assert.equal(withToken.connectWrites[0].status, "cancelled");

  const noToken = localRec({ status: "active" });
  delete noToken.token;
  const without = fakeStore({ cus_alpha: noToken });
  await runReconcile(
    { dodo: fakeDodo({ subs: [dodoSub({ status: "cancelled", metadata: {} })] }), store: without },
    opts({ mode: "repair" }),
  );
  assert.equal(without.connectWrites.length, 0);
});

// ===========================================================================
// FIXTURE FIDELITY — the fixtures must match the shape actually observed live
// ===========================================================================

test("fixtures carry exactly the fields verifications#413 observed on the live API", () => {
  // The reconciliation contract rests on these field names. If a fixture and
  // the recorded live shape ever disagree, every test in this file is proving
  // something about a payload that does not exist.
  const VERIFIED_SUB = [
    "subscription_id", "status", "product_id", "product_name", "customer", "metadata",
    "trial_period_days", "next_billing_date", "cancelled_at", "cancel_at_next_billing_date",
    "scheduled_change",
  ];
  const VERIFIED_PAY = [
    "payment_id", "status", "total_amount", "currency", "subscription_id", "customer",
    "metadata", "refund_status", "dispute_status", "invoice_id", "invoice_url",
  ];
  for (const f of VERIFIED_SUB) assert.ok(f in dodoSub(), `subscription fixture is missing ${f}`);
  for (const f of VERIFIED_PAY) assert.ok(f in dodoPayment(), `payment fixture is missing ${f}`);
  for (const f of ["customer_id", "email", "name"]) {
    assert.ok(f in dodoSub().customer, `subscription customer is missing ${f}`);
  }
  // The one field carried beyond the verified list, named so it stays honest.
  const extra = Object.keys(dodoPayment()).filter((k) => !VERIFIED_PAY.includes(k));
  assert.deepEqual(extra, ["created_at"], "an unverified field crept into the payment fixture");
});

test("a payment shaped EXACTLY as verifications#413 recorded it (no created_at) behaves identically", async () => {
  const bare = dodoPayment({ refund_status: "succeeded" });
  delete bare.created_at;
  const withIt = dodoPayment({ refund_status: "succeeded" });

  const run = async (payment) => {
    const store = fakeStore({ cus_alpha: localRec() });
    const { plan } = await runReconcile(
      { dodo: fakeDodo({ subs: [dodoSub()], payments: [payment] }), store },
      opts({ mode: "repair" }),
    );
    return { status: store.data.get("cus_alpha").status, kind: plan.findings.find((f) => f.phase === "payments").kind };
  };
  const a = await run(bare);
  const b = await run(withIt);
  assert.equal(a.status, "refunded");
  assert.deepEqual(a, b, "an unverified field must never be load-bearing");
});

// ===========================================================================
// CONDITION 2 — TRUNCATION IS VISIBLE, AND NEVER EXITS CLEAN
// ===========================================================================

test("exitCodeFor never returns 0 for a run that left work undone", () => {
  const clean = { errors: [], truncated: {}, stats: { reviews: 0 } };
  assert.equal(exitCodeFor(clean, { mode: "repair", wrote: 2, refused: [] }), 0);

  // truncated walk
  assert.equal(exitCodeFor({ ...clean, truncated: { subscriptions: true } }, { mode: "repair", refused: [] }), 3);
  // repairs refused as a whole (blast radius / incomplete)
  assert.equal(exitCodeFor(clean, { mode: "repair", refused: ["BLAST-RADIUS STOP — …"] }), 3);
  // a read errored
  assert.equal(exitCodeFor({ ...clean, errors: [{ phase: "payments", message: "503" }] }, { mode: "repair" }), 1);
  // nothing wrong, something to look at
  assert.equal(exitCodeFor({ ...clean, stats: { reviews: 2 } }, { mode: "repair", refused: [] }), 2);
  // dry run with pending changes is a decision waiting on a human
  assert.equal(exitCodeFor(clean, { mode: "dry-run", wouldWrite: 3, refused: [] }), 2);
  assert.equal(exitCodeFor(clean, { mode: "dry-run", wouldWrite: 0, refused: [] }), 0);
  assert.equal(exitCodeFor(null, {}), 1);

  for (const c of [0, 1, 2, 3]) assert.equal(typeof EXIT_MEANING[c], "string");
});

test("a blast-radius refusal exits 3, not 0 — the green-run-that-did-nothing bug", async () => {
  const n = 5;
  const subs = Array.from({ length: n }, (_, i) =>
    dodoSub({ subscription_id: `sub_${i}`, status: "cancelled", customer: { customer_id: `cus_${i}` } }),
  );
  const records = Object.fromEntries(
    subs.map((_, i) => [`cus_${i}`, localRec({ customerId: `cus_${i}`, subscriptionId: `sub_${i}`, token: `tok_${i}` })]),
  );
  const store = fakeStore(records);
  const plan = await planSweep({ dodo: fakeDodo({ subs }), store }, opts());
  const applied = await applySweep(plan, { store }, { mode: "repair", maxRepairs: 3 });

  assert.equal(applied.wrote, 0);
  assert.equal(plan.complete, true, "the SWEEP was complete; it is the REPAIR that was refused");
  assert.equal(exitCodeFor(plan, applied), 3, "a refused repair phase must not look like a clean run");
});

test("a truncated run says so, loudly, in the report", async () => {
  const subs = Array.from({ length: 6 }, (_, i) =>
    dodoSub({ subscription_id: `sub_${i}`, status: "cancelled", customer: { customer_id: `cus_${i}` } }),
  );
  const store = fakeStore({});
  const plan = await planSweep(
    { dodo: fakeDodo({ subs }), store },
    opts({ limits: { pageSize: 2, maxSubscriptionPages: 2 } }),
  );
  const applied = await applySweep(plan, { store }, { mode: "repair" });
  const report = formatReport(plan, applied);

  assert.match(report, /!! TRUNCATED/);
  assert.match(report, /MORE REMAINS/);
  assert.match(report, /VERDICT: INCOMPLETE/);
  assert.equal(exitCodeFor(plan, applied), 3);
});

test("every report ends with a verdict line naming its exit code", async () => {
  const store = fakeStore({ cus_alpha: localRec() });
  const { plan, applied } = await runReconcile(
    { dodo: fakeDodo({ subs: [dodoSub({ status: "cancelled" })], present: new Set(["sub_alpha"]) }), store },
    opts(),
  );
  const report = formatReport(plan, applied);
  const code = exitCodeFor(plan, applied);
  assert.match(report, new RegExp(`VERDICT: .+ \\(exit ${code}\\)$`));
});

// ===========================================================================
// CONDITION 1 — THE CLOBBER GUARD (real files, real fingerprints)
// ===========================================================================

function tempStore() {
  const dir = mkdtempSync(path.join(tmpdir(), "reconcile-guard-"));
  const file = path.join(dir, "store.json");
  writeFileSync(file, JSON.stringify({ "mira:sub:cus_alpha": { v: JSON.stringify(localRec()) } }));
  return { dir, file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("GUARD: a file-store repair REFUSES to start without --writer-down (fail closed)", () => {
  const { file, cleanup } = tempStore();
  try {
    const guard = fileWriterGuard(file, { writerDown: false });
    const got = guard.acquire();
    assert.equal(got.ok, false, "the dangerous combination must refuse by default");
    assert.match(got.reason, /REFUSING TO REPAIR/);
    assert.match(got.reason, /--writer-down/);
    assert.equal(existsSync(guard.lockPath), false, "a refusal must not leave a lock behind");
  } finally {
    cleanup();
  }
});

test("GUARD: --writer-down is a real override — the same run then proceeds", () => {
  const { file, cleanup } = tempStore();
  try {
    const guard = fileWriterGuard(file, { writerDown: true });
    assert.equal(guard.acquire().ok, true, "the operator escape hatch must actually work");
    assert.equal(existsSync(guard.lockPath), true);
    assert.doesNotThrow(() => guard.beforeWrite(), "an untouched file must not trip layer 2");
    guard.release();
    assert.equal(existsSync(guard.lockPath), false, "release must clean up");
  } finally {
    cleanup();
  }
});

test("GUARD: no flag overrides EVIDENCE — a file that changes under us aborts the run", () => {
  const { file, cleanup } = tempStore();
  try {
    const guard = fileWriterGuard(file, { writerDown: true }); // operator asserted "it's down"
    assert.equal(guard.acquire().ok, true);

    // …and they were wrong: something else writes to the store.
    writeFileSync(file, JSON.stringify({ "mira:sub:cus_alpha": { v: JSON.stringify(localRec({ plan: "studio" })) } }));

    assert.throws(() => guard.beforeWrite(), /ABORTED: the store file changed underneath this run/);
    assert.throws(() => guard.beforeWrite(), /no flag overrides direct evidence/);
    guard.release();
  } finally {
    cleanup();
  }
});

test("GUARD: our own writes are adopted as the new baseline, so we do not trip on ourselves", () => {
  const { file, cleanup } = tempStore();
  try {
    const guard = fileWriterGuard(file, { writerDown: true });
    guard.acquire();
    for (let i = 0; i < 3; i++) {
      guard.beforeWrite();
      writeFileSync(file, JSON.stringify({ round: i }));
      guard.afterWrite();
    }
    assert.equal(guard.assertIntact().ok, true);
    guard.release();
  } finally {
    cleanup();
  }
});

test("GUARD: assertIntact catches a writer that clobbers us AFTER the last write", () => {
  const { file, cleanup } = tempStore();
  try {
    const guard = fileWriterGuard(file, { writerDown: true });
    guard.acquire();
    guard.beforeWrite();
    writeFileSync(file, JSON.stringify({ ours: true }));
    guard.afterWrite();

    writeFileSync(file, JSON.stringify({ theirs: true })); // the web process wakes up
    const verdict = guard.assertIntact();
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /already overwritten some or all of these repairs/);
    guard.release();
  } finally {
    cleanup();
  }
});

test("GUARD: two concurrent reconcile runs cannot both hold the same store", () => {
  const { file, cleanup } = tempStore();
  try {
    const first = fileWriterGuard(file, { writerDown: true, pid: 111 });
    assert.equal(first.acquire().ok, true);

    const second = fileWriterGuard(file, { writerDown: true, pid: 222 });
    const got = second.acquire();
    assert.equal(got.ok, false);
    assert.match(got.reason, /another reconcile run \(pid 111\)/);

    first.release();
    assert.equal(fileWriterGuard(file, { writerDown: true, pid: 333 }).acquire().ok, true, "released means available");
  } finally {
    cleanup();
  }
});

test("GUARD: a stale lock is reclaimed, so a crashed run cannot wedge the tool shut", () => {
  const { file, cleanup } = tempStore();
  try {
    const t0 = 1_000_000;
    const dead = fileWriterGuard(file, { writerDown: true, pid: 111, clock: () => t0 });
    assert.equal(dead.acquire().ok, true); // …and then the process dies without releasing

    const tooSoon = fileWriterGuard(file, { writerDown: true, pid: 222, clock: () => t0 + 60_000 });
    assert.equal(tooSoon.acquire().ok, false, "a lock one minute old is a live sibling, not debris");

    const notes = [];
    const later = fileWriterGuard(file, {
      writerDown: true,
      pid: 333,
      clock: () => t0 + 30 * 60_000,
      log: (m) => notes.push(m),
    });
    assert.equal(later.acquire().ok, true, "a 30-minute-old lock is debris and must be reclaimable");
    assert.match(notes.join(" "), /reclaiming a stale lock/);
    later.release();
  } finally {
    cleanup();
  }
});

test("GUARD: the lock lives beside the store, never inside it", () => {
  const { file, cleanup } = tempStore();
  try {
    const guard = fileWriterGuard(file, { writerDown: true });
    assert.equal(guard.lockPath, `${file}.reconcile.lock`);
    guard.acquire();
    const store = JSON.parse(readFileSync(file, "utf8"));
    assert.ok("mira:sub:cus_alpha" in store, "taking the lock must not touch the store contents");
    guard.release();
  } finally {
    cleanup();
  }
});

// ===========================================================================
// [decisions#344] THE RULE — RECONCILIATION MAY NEVER GRANT ACCESS.
//
// The restore exception is REVOKED. `restore` rows from DODO_EVENT_EFFECTS
// (dispute.won, dispute.cancelled, dunning.recovered, subscription.unpaused)
// used to be applied, on the argument that their `from` list made them safe.
// The owner ruled otherwise: a from-guarded restore is still a write that
// INCREASES access, executed by the component with the broadest visibility and
// the weakest identity guarantees. The `from` list narrows the exposure; it
// does not remove it.
// ===========================================================================

test("[#344] a dispute.won at the provider produces a REVIEW and writes NOTHING", async () => {
  // THE CENTREPIECE. Before decisions#344 this test failed: the sweep applied
  // the restore and wrote status "active" — it GRANTED access.
  const store = fakeStore({ cus_alpha: localRec({ status: "chargeback", disputed: true }) });
  const { plan, applied } = await runReconcile(
    {
      dodo: fakeDodo({ subs: [dodoSub()], payments: [dodoPayment({ dispute_status: "dispute_won" })] }),
      store,
    },
    opts({ mode: "repair" }),
  );

  const f = plan.findings.find((x) => x.phase === "payments");
  assert.equal(f.kind, "review_restore", "a restore must surface as a review, not an action");
  assert.equal(f.applicable, false, "and must never be applicable");
  assert.equal(f.eventType, "dispute.won");

  assert.equal(store.writes.length, 0, "NOT ONE WRITE may follow a restore");
  assert.equal(store.connectWrites.length, 0);
  assert.equal(store.data.get("cus_alpha").status, "chargeback", "the sweep did not grant access");
  assert.equal(applied.wrote, 0);
  assert.ok(plan.stats.reviews > 0, "and it must count as needing a human");
});

test("[#344] review_restore is distinct from review_grant — different human responses", async () => {
  // "We may be wrongly withholding from someone who WON A DISPUTE" and "we may
  // be wrongly withholding from someone who PAID" need different handling, so
  // an operator must be able to tell them apart without reading prose.
  const restoreStore = fakeStore({ cus_alpha: localRec({ status: "chargeback" }) });
  const r = await runReconcile(
    {
      dodo: fakeDodo({ subs: [dodoSub()], payments: [dodoPayment({ dispute_status: "dispute_won" })] }),
      store: restoreStore,
    },
    opts({ mode: "repair" }),
  );
  const grantStore = fakeStore({ cus_alpha: localRec({ status: "cancelled" }) });
  const g = await runReconcile(
    { dodo: fakeDodo({ subs: [dodoSub({ status: "active" })] }), store: grantStore },
    opts({ mode: "repair" }),
  );

  // The dispute outcome is a PAYMENT-phase fact; the subscription phase may
  // independently and correctly raise review_grant for the same customer
  // (Dodo says the subscription is live, local says chargeback). Both are real
  // and they are different incidents — which is the point of separating them.
  const restoreFinding = r.plan.findings.find((f) => f.phase === "payments");
  const grantFinding = g.plan.findings.find((f) => f.phase === "subscriptions");
  assert.equal(restoreFinding.kind, "review_restore", "a dispute we won is a restore review");
  assert.equal(grantFinding.kind, "review_grant", "a live-at-provider subscription is a grant review");
  assert.notEqual(restoreFinding.kind, grantFinding.kind, "the two must be tellable apart");
  assert.match(restoreFinding.note, /PAYING CUSTOMER WHO IS\s+CURRENTLY LOCKED OUT/);

  assert.equal(restoreStore.writes.length, 0);
  assert.equal(grantStore.writes.length, 0);
});

test("[#344] every restore row in the effects table is reported, never applied", async () => {
  // Driven from the TABLE, not from a list here, so a restore row added later
  // is covered without anyone remembering to extend this test.
  const restoreTypes = Object.entries(DODO_EVENT_EFFECTS)
    .filter(([, e]) => e.kind === "restore")
    .map(([t]) => t);
  assert.ok(restoreTypes.length >= 4, "sanity: the table still has restore rows");

  for (const type of restoreTypes.filter((t) => t.startsWith("dispute."))) {
    const bare = type.slice("dispute.".length);
    for (const localStatus of ["chargeback", "on_hold", "paused", "refunded", "cancelled"]) {
      const store = fakeStore({ cus_alpha: localRec({ status: localStatus }) });
      await runReconcile(
        {
          dodo: fakeDodo({
            subs: [dodoSub()],
            payments: [dodoPayment({ dispute_status: `dispute_${bare}` })],
          }),
          store,
        },
        opts({ mode: "repair" }),
      );
      assert.equal(
        store.data.get("cus_alpha").status,
        localStatus,
        `${type} against local "${localStatus}" changed the status`,
      );
      assert.equal(store.writes.length, 0, `${type} against local "${localStatus}" wrote something`);
    }
  }
});

test("[#344] STRUCTURAL: write authority is an allowlist that excludes activate and restore", () => {
  // Stronger than an example: whatever effect kinds exist now or later, only
  // these may be applied. A new kind added to the effects table defaults to
  // NOT being applied rather than to being applied.
  assert.deepEqual([...SWEEP_APPLIES].sort(), ["flag", "period", "revoke"]);
  assert.equal(SWEEP_APPLIES.has("activate"), false);
  assert.equal(SWEEP_APPLIES.has("restore"), false);

  // Every kind the table actually uses is a deliberate yes or no.
  const kinds = new Set(Object.values(DODO_EVENT_EFFECTS).map((e) => e.kind));
  for (const k of kinds) {
    if (k === "activate" || k === "restore") assert.equal(SWEEP_APPLIES.has(k), false);
  }
});

test("[#344] STRUCTURAL: no cleared effect can move a record from non-granting to granting", () => {
  // Exhaustive over the effects table x every non-granting status the
  // ConnectRecord union allows. This is the rule itself, checked directly,
  // rather than an example that happens to demonstrate it.
  const NON_GRANTING = ["pending", "bound", "cancelled", "refunded", "chargeback", "on_hold", "paused"];
  for (const status of NON_GRANTING) {
    assert.equal(LIVE_DODO_STATUS.has(status), false, `fixture error: "${status}" grants access`);
    for (const [type, effect] of Object.entries(DODO_EVENT_EFFECTS)) {
      const clearance = revocationClearance({ rec: localRec({ status }), effect, verdict: "dodo" });
      if (!clearance.ok) continue; // refused outright — cannot write at all
      const after = applyDodoOutcome(localRec({ status }), effect, { now: NOW }).rec.status;
      assert.equal(
        LIVE_DODO_STATUS.has(after),
        false,
        `${type} was cleared and moved "${status}" -> "${after}", which GRANTS access`,
      );
    }
  }
});

test("[#344] the four-way match is checkable clause by clause", () => {
  const rec = localRec({ status: "active", subscriptionId: "sub_alpha" });
  const revoke = dodoEventEffect("subscription.cancelled");

  // All four clauses satisfied.
  assert.equal(revocationClearance({ rec, effect: revoke, verdict: "dodo" }).ok, true);

  // 1. PROVIDER IDENTITY
  for (const verdict of ["foreign", "unprovable", "no_record"]) {
    const c = revocationClearance({ rec, effect: revoke, verdict });
    assert.equal(c.ok, false);
    assert.equal(c.clause, "provider identity", `verdict "${verdict}" must fail on clause 1`);
  }
  // The owner's explicit ruling: provider-asserted linkage IS unambiguous identity.
  for (const verdict of ["dodo", "dodo_by_token", "dodo_by_subscription"]) {
    assert.equal(revocationClearance({ rec, effect: revoke, verdict }).ok, true, verdict);
  }

  // 2. LOCAL IDENTITY
  for (const bad of [null, undefined, "not-a-record", 42]) {
    const c = revocationClearance({ rec: bad, effect: revoke, verdict: "dodo" });
    assert.equal(c.ok, false);
    assert.equal(c.clause, "local identity");
  }

  // 3. SUBSCRIPTION IDENTITY
  const mismatch = revocationClearance({
    rec,
    effect: revoke,
    verdict: "dodo",
    providerSubscriptionId: "sub_a_different_one",
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.clause, "subscription identity");
  assert.equal(
    revocationClearance({ rec, effect: revoke, verdict: "dodo", providerSubscriptionId: "sub_alpha" }).ok,
    true,
    "a MATCHING subscription id must satisfy clause 3",
  );
  const noLocalSub = localRec({ status: "active" });
  delete noLocalSub.subscriptionId;
  assert.equal(
    revocationClearance({ rec: noLocalSub, effect: revoke, verdict: "dodo", providerSubscriptionId: "sub_x" }).ok,
    true,
    "a record that names no subscription cannot contradict one",
  );

  // 4. REVOCATION CONDITION
  const grant = revocationClearance({ rec, effect: dodoEventEffect("subscription.active"), verdict: "dodo" });
  assert.equal(grant.ok, false);
  assert.equal(grant.clause, "revocation condition");
  assert.equal(grant.kind, "review_grant");

  const restore = revocationClearance({ rec, effect: dodoEventEffect("dispute.won"), verdict: "dodo" });
  assert.equal(restore.ok, false);
  assert.equal(restore.clause, "revocation condition");
  assert.equal(restore.kind, "review_restore");

  const none = revocationClearance({ rec, effect: null, verdict: "dodo" });
  assert.equal(none.ok, false);
  assert.equal(none.clause, "revocation condition");
});

test("[#344] the governing rule is quoted verbatim in the module header", () => {
  const src = readFileSync(new URL("../src/lib/reconcile-core.mjs", import.meta.url), "utf8");
  const header = src.slice(0, src.indexOf("import "));
  assert.match(header, /decisions#344/, "the ruling must be cited");
  for (const clause of [
    "Reconciliation may remove access only when the provider identity, local",
    "identity, subscription identity, and revocation condition all match",
    "unambiguously. It may never grant access. Ambiguous or contradictory states",
    "become incidents for the normal entitlement pipeline to resolve.",
  ]) {
    assert.ok(header.includes(clause), `the rule text is missing: "${clause}"`);
  }
});

test("[#344] the accepted cost is written down, not hidden", () => {
  const src = readFileSync(new URL("../src/lib/reconcile-core.mjs", import.meta.url), "utf8");
  assert.match(src, /paying customer/i, "the cost of never restoring must be stated in the code");
  assert.match(src, /dispute\.won/, "…and named concretely");
});
