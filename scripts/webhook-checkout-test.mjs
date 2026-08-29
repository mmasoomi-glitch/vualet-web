/**
 * ZERO-DOLLAR WEBHOOK ACTIVATION TEST (jury #68b).
 *
 * Proves that a $0 / 100%-off checkout.session.completed activates the CORRECT
 * purchased tier through OUR webhook code, and is idempotent — using the SAME
 * pure core the production route (src/app/api/webhooks/stripe/route.ts) runs:
 * src/lib/webhook-core.mjs. Fakes are INJECTED exactly the way promo/tier tests
 * inject fakes — no env, no Upstash, no live Stripe, no network.
 *
 * Proves:
 *   1. amount_total=0, metadata.plan='studio'  -> tier 'studio' (NOT default).
 *   2. same for 'companion' and 'assistant' ($0 each).
 *   3. a subscription/entitlement record is written (connect + sub stores).
 *   4. idempotency: the same event.id delivered twice activates EXACTLY once,
 *      via the shared `mira:evt:` dedupe — no double-grant.
 *   5. a $0 order is treated the SAME as a paid one (activation never gated on
 *      amount) — proven behaviourally AND by scanning the sources for any
 *      amount_total / payment_status gate.
 *
 * Run: npm run test:zero   (or: node --test scripts/webhook-checkout-test.mjs)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  activateCheckout,
  activationRecordFromSession,
  renewalRecordFromInvoice,
  droppedFields,
  wasEventProcessed,
  markEventProcessed,
  eventKey,
} from "../src/lib/webhook-core.mjs";

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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---- injected fakes (mirror the real kv + store contracts) ----------------

// Fake kv — same shape as src/lib/store.ts kvGet/kvSet (JSON value, optional TTL).
function fakeKv() {
  const map = new Map();
  return {
    map,
    async kvGet(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async kvSet(key, value /*, ttlSeconds */) {
      map.set(key, value);
    },
  };
}

// Fake connect/subscription store — same shape the route injects into the core.
function fakeStore() {
  const connects = new Map(); // token -> rec
  const subs = new Map(); // customerId -> rec
  return {
    connects,
    subs,
    async getConnect(token) {
      return connects.get(token) ?? null;
    },
    async putConnect(rec) {
      connects.set(rec.token, rec);
    },
    async putSubscription(customerId, rec) {
      subs.set(customerId, rec);
    },
    async getSubscription(customerId) {
      return subs.get(customerId) ?? null;
    },
  };
}

const SUBTOTAL = { companion: 1499, assistant: 3900, studio: 7900 };

// A REAL-shaped $0 checkout.session.completed: 100%-off coupon → amount_total 0,
// full discount, payment_status 'no_payment_required', 14-day trial. metadata.plan
// is what the /api/checkout route sets server-side.
function zeroDollarSession(plan, { token, customerId, subscriptionId, email } = {}) {
  return {
    id: `cs_test_${plan}`,
    object: "checkout.session",
    mode: "subscription",
    status: "complete",
    payment_status: "no_payment_required",
    amount_subtotal: SUBTOTAL[plan],
    amount_total: 0, // <-- the $0 / 100%-off case
    total_details: { amount_discount: SUBTOTAL[plan], amount_tax: 0 },
    currency: "usd",
    customer: customerId ?? `cus_${plan}`,
    subscription: subscriptionId ?? `sub_${plan}`,
    customer_details: { email: email ?? `${plan}@example.com` },
    // The server sets these at checkout (see src/app/api/checkout/route.ts).
    metadata: { plan, persona: "", ...(token ? { connect_token: token } : {}) },
  };
}

const checkoutEvent = (id, session) => ({
  id,
  type: "checkout.session.completed",
  data: { object: session },
});

// Faithful re-play of the route's POST ordering for the checkout branch, using
// ONLY the shared core primitives (dedupe check -> activate -> mark) so what we
// assert is exactly what production runs. Returns { duplicate, rec, activations }.
async function deliver(event, kv, store, counter) {
  if (await wasEventProcessed(kv.kvGet, event.id)) {
    return { duplicate: true, rec: null };
  }
  let rec = null;
  if (event.type === "checkout.session.completed") {
    rec = await activateCheckout(event.data.object, store);
    counter.activations++;
  }
  await markEventProcessed(kv.kvSet, event.id);
  return { duplicate: false, rec };
}

// ---- 1-3: correct tier + record written, for each plan at $0 ---------------

for (const plan of ["studio", "companion", "assistant"]) {
  test(`$0 / 100%-off checkout activates the correct tier: ${plan}`, async () => {
    const kv = fakeKv();
    const store = fakeStore();
    const counter = { activations: 0 };

    // The checkout route pre-stores a 'pending' connect record carrying the plan.
    const token = `tok_${plan}`;
    await store.putConnect({
      token,
      plan, // server-set plan on the pending record
      email: `${plan}@example.com`,
      status: "pending",
      persona: "calm",
      createdAt: "2026-07-20T00:00:00.000Z",
    });

    const session = zeroDollarSession(plan, { token });
    const { rec } = await deliver(checkoutEvent(`evt_${plan}`, session), kv, store, counter);

    // correct tier — NOT the "companion" default
    assert.equal(rec.plan, plan, `expected tier ${plan}`);
    if (plan !== "companion") {
      assert.notEqual(rec.plan, "companion", "must not fall back to default tier");
    }
    // activated, not pending
    assert.equal(rec.status, "active");
    // a subscription/entitlement record is written to BOTH stores
    const sub = await store.getSubscription(`cus_${plan}`);
    assert.ok(sub, "subscription record must be written");
    assert.equal(sub.plan, plan);
    assert.equal(sub.status, "active");
    const conn = await store.getConnect(token);
    assert.equal(conn.status, "active");
    assert.equal(conn.plan, plan);
    assert.equal(conn.subscriptionId, `sub_${plan}`);
    assert.equal(conn.customerId, `cus_${plan}`);
    assert.equal(counter.activations, 1);
  });
}

// Tier is correct even with NO pre-stored connect record: metadata.plan drives it.
test("$0 checkout with no pre-stored connect record still activates the tier from metadata.plan", async () => {
  const kv = fakeKv();
  const store = fakeStore();
  const counter = { activations: 0 };
  const session = zeroDollarSession("studio", { token: "tok_meta" }); // no putConnect first
  const { rec } = await deliver(checkoutEvent("evt_meta", session), kv, store, counter);
  assert.equal(rec.plan, "studio"); // from session.metadata.plan, not defaulted
  assert.equal(rec.status, "active");
});

// ---- 4: idempotency — same event.id twice activates EXACTLY once -----------

test("idempotency: the same $0 event.id delivered twice activates exactly once (no double-grant)", async () => {
  const kv = fakeKv();
  const store = fakeStore();
  const counter = { activations: 0 };

  const token = "tok_idem";
  await store.putConnect({
    token,
    plan: "assistant",
    status: "pending",
    createdAt: "2026-07-20T00:00:00.000Z",
  });
  const session = zeroDollarSession("assistant", { token });
  const event = checkoutEvent("evt_dupe_same_id", session);

  const first = await deliver(event, kv, store, counter);
  const second = await deliver(event, kv, store, counter); // SAME event.id

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true, "second delivery must be recognised as duplicate");
  assert.equal(counter.activations, 1, "exactly one activation — no double-grant");
  // dedupe marker is stored under the mira:evt: namespace
  assert.ok(kv.map.has(eventKey("evt_dupe_same_id")), "mira:evt: dedupe key must be set");
  // record still correct after the duplicate
  const sub = await store.getSubscription("cus_assistant");
  assert.equal(sub.plan, "assistant");
  assert.equal(sub.status, "active");
});

// ---- 5: $0 treated the SAME as paid (activation NOT gated on amount) --------

test("$0 order activates identically to a paid order (activation not gated on amount)", async () => {
  const store = fakeStore();

  // paid: amount_total = full price
  const paid = zeroDollarSession("studio", { token: "tok_paid", customerId: "cus_paid" });
  paid.amount_total = 7900;
  paid.payment_status = "paid";
  paid.total_details = { amount_discount: 0, amount_tax: 0 };
  await store.putConnect({ token: "tok_paid", plan: "studio", status: "pending", createdAt: "x" });
  const recPaid = await activateCheckout(paid, store);

  // free: identical session but amount_total = 0
  const free = zeroDollarSession("studio", { token: "tok_free", customerId: "cus_free" });
  await store.putConnect({ token: "tok_free", plan: "studio", status: "pending", createdAt: "x" });
  const recFree = await activateCheckout(free, store);

  // Same tier, same active status — the $0 path is NOT skipped or downgraded.
  assert.equal(recPaid.plan, recFree.plan, "same tier for paid and $0");
  assert.equal(recPaid.status, "active");
  assert.equal(recFree.status, "active");
});

test("no amount/payment gate exists in the webhook activation code (source scan)", () => {
  const core = readFileSync(join(ROOT, "src/lib/webhook-core.mjs"), "utf8");
  const route = readFileSync(join(ROOT, "src/app/api/webhooks/stripe/route.ts"), "utf8");
  // Strip line + block comments so prose mentioning these fields (like this file's
  // own docs) can't cause a false positive — we care about CODE that reads them.
  const stripComments = (s) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const coreCode = stripComments(core);
  const routeCode = stripComments(route);
  // Reading session.amount_total / session.payment_status would be the mechanism
  // by which a $0 order could be skipped. It must appear NOWHERE in the code.
  assert.ok(!/\bamount_total\b/.test(coreCode), "webhook-core code must not read amount_total");
  assert.ok(!/\bpayment_status\b/.test(coreCode), "webhook-core code must not read payment_status");
  assert.ok(!/\bamount_total\b/.test(routeCode), "route code must not read amount_total");
  assert.ok(!/\bpayment_status\b/.test(routeCode), "route code must not read payment_status");
});

// ── gotchas#257 (Stripe sibling): activation must not DELETE the binding fields ──
// Writer H fixed this in the Dodo core and found the IDENTICAL defect here.
// activationRecordFromSession rebuilt the record from a list of fields, and
// phone / channel / consent were not on that list — the list was a complete
// copy of ConnectRecord as it stood at 08353f9, which went stale as the record
// grew. Nothing failed: the write succeeded and the fields simply ceased to
// exist, on BOTH the connect record the customer binds through and the durable
// subscription record support and entitlement read.
//
// These assert the ROUND TRIP through the real activateCheckout — what is IN
// THE STORE afterwards — not that the builder happens to return the fields.
// NOTE: Stripe is disarmed in production (PAYMENTS_LIVE=0, verifications#404),
// so this was a latent landmine rather than a live outage. It is still the
// activation code that runs the moment Stripe is ever re-armed.

/** A pending WhatsApp record exactly as /api/checkout persists one (specs#160). */
function pendingWhatsAppRecord() {
  return {
    token: "tok_wa",
    plan: "companion",
    email: "buyer@example.com",
    status: "pending",
    phone: "+971501234567",
    channel: "whatsapp",
    consent: {
      unofficialAutomation: true,
      banRisk: true,
      ownAccountReplies: true,
      observationNumber: false,
      disclosure: "specs#160",
      acceptedAt: "2026-08-20T10:00:00.000Z",
    },
    persona: "warm",
    createdAt: "2026-08-20T09:59:00.000Z",
  };
}

/** A completed checkout session for that record. */
const waSession = (over = {}) => ({
  id: "cs_wa",
  object: "checkout.session",
  mode: "subscription",
  status: "complete",
  customer: "cus_wa",
  subscription: "sub_wa",
  customer_details: { email: "buyer@example.com" },
  metadata: { plan: "companion", connect_token: "tok_wa" },
  ...over,
});

test("activation carries phone, channel and consent off the base record", () => {
  const base = pendingWhatsAppRecord();
  const rec = activationRecordFromSession(waSession(), base, "2026-08-20T10:05:00.000Z");
  assert.equal(rec.status, "active");
  assert.equal(rec.phone, "+971501234567");
  assert.equal(rec.channel, "whatsapp");
  assert.deepEqual(rec.consent, base.consent);
});

test("activateCheckout round trip: the PAID connect record is still bindable", async () => {
  const store = fakeStore();
  const before = pendingWhatsAppRecord();
  await store.putConnect(before);

  // Sanity: the record IS bindable before the money arrives.
  assert.equal((await store.getConnect("tok_wa")).phone, "+971501234567");

  await activateCheckout(waSession(), { ...store, now: "2026-08-20T10:05:00.000Z" });

  const after = await store.getConnect("tok_wa");
  assert.equal(after.status, "active", "payment must mark it active");
  assert.equal(after.phone, "+971501234567", "phone survived the payment");
  assert.equal(after.channel, "whatsapp", "channel survived the payment");
  assert.deepEqual(after.consent, before.consent, "gate-C1 consent survived the payment");

  // The durable subscription record is the one support and entitlement read;
  // the probe proved it carried none of the fields either.
  const sub = await store.getSubscription("cus_wa");
  assert.equal(sub.phone, "+971501234567", "phone reached the subscription record");
  assert.equal(sub.channel, "whatsapp", "channel reached the subscription record");
  assert.deepEqual(sub.consent, before.consent, "consent reached the subscription record");
});

test("activation drops NO field of the base record (structural, not per-field)", () => {
  const base = pendingWhatsAppRecord();
  // A field this test does not know about — stands in for the next field some
  // future writer adds to the record. A per-field list cannot protect it.
  base.futureBindingField = "must survive";
  const rec = activationRecordFromSession(waSession(), base, "2026-08-20T10:05:00.000Z");
  assert.deepEqual(droppedFields(base, rec), []);
  assert.equal(rec.futureBindingField, "must survive");
});

test("a stale base can never override the payment outcome (counterfactual)", () => {
  // Guards MY OWN change: the spread must not let an old record decide whether
  // the customer paid, or who paid.
  const rec = activationRecordFromSession(
    waSession({ customer: "cus_new", subscription: "sub_new" }),
    {
      token: "tok_wa",
      plan: "companion",
      status: "cancelled",
      customerId: "cus_OLD",
      subscriptionId: "sub_OLD",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    "2026-08-20T10:05:00.000Z",
  );
  assert.equal(rec.status, "active", "a cancelled base must not survive activation");
  assert.equal(rec.customerId, "cus_new", "the payment names the customer, not the base");
  assert.equal(rec.subscriptionId, "sub_new", "the payment names the subscription, not the base");
  assert.equal(rec.createdAt, "2026-01-01T00:00:00.000Z", "original createdAt is still preserved");
});

test("the base only fills an ABSENT payment identity, it never contradicts one", () => {
  // Divergence from dodo-webhook-core.mjs, matching refreshFromInvoice
  // (webhooks/stripe/route.ts:124-125): when the session names no customer we
  // keep the one we already hold rather than overwriting it with undefined —
  // which is the same silent structural loss as phone/channel/consent.
  const base = { ...pendingWhatsAppRecord(), customerId: "cus_held", subscriptionId: "sub_held" };
  const rec = activationRecordFromSession(
    waSession({ customer: null, subscription: null }),
    base,
    "2026-08-20T10:05:00.000Z",
  );
  assert.equal(rec.customerId, "cus_held");
  assert.equal(rec.subscriptionId, "sub_held");
  assert.deepEqual(droppedFields(base, rec), [], "the invariant holds on this shape too");
});

test("droppedFields is empty for every activation shape this suite exercises", () => {
  const shapes = [
    pendingWhatsAppRecord(),
    { token: "t", plan: "studio", status: "pending", createdAt: "x" },
    { ...pendingWhatsAppRecord(), telegramId: 12345, role: "coach", assistantName: "Mira" },
    { ...pendingWhatsAppRecord(), customerId: "cus_held", subscriptionId: "sub_held" },
  ];
  for (const base of shapes) {
    const rec = activationRecordFromSession(
      waSession({ metadata: { plan: base.plan, connect_token: base.token } }),
      base,
      "2026-08-20T10:05:00.000Z",
    );
    assert.deepEqual(
      droppedFields(base, rec),
      [],
      `activation dropped fields from ${JSON.stringify(base)}`,
    );
  }
  // Vacuity guard: droppedFields must actually be able to REPORT a loss, or
  // the assertions above would pass against any implementation whatsoever.
  assert.deepEqual(droppedFields({ a: 1, b: 2 }, { a: 1 }), ["b"]);
});

// ── gotchas#257 scenario B: activation must not ORPHAN the connect token ────
// Writer H's extension of the backfill idea. Without `base?.token` ahead of the
// subscription/customer fallbacks, an event that echoes no connect token
// rewrites the record's token to the subscription id — tok_wa -> sub_wa — and
// the record silently stops being reachable by the token the customer binds
// through. Not a missing field; a changed identity. Same family of loss.

test("an event carrying no connect token must not rewrite the record's token", () => {
  const base = pendingWhatsAppRecord(); // token: "tok_wa"
  const rec = activationRecordFromSession(
    waSession({ metadata: { plan: "companion" } }), // NO connect_token echoed
    base,
    "2026-08-20T10:05:00.000Z",
  );
  assert.equal(rec.token, "tok_wa", "the customer's connect token must survive");
  assert.notEqual(rec.token, "sub_wa", "must not be orphaned onto the subscription id");
  assert.deepEqual(droppedFields(base, rec), []);
});

// ── gotchas#257 THIRD SITE: the RENEWAL path ───────────────────────────────
// refreshFromInvoice (webhooks/stripe/route.ts) carried a SECOND hand-written
// allow-list — token, plan, email, status, customerId, subscriptionId,
// telegramId, persona, role, assistantName, createdAt — so a customer whose
// binding survived activation lost phone/channel/consent on their FIRST
// RENEWAL instead. That literal is gone: the route now delegates to
// renewalRecordFromInvoice in the pure core, which is what these exercise.

const RENEWAL = { customerId: "cus_wa", subscriptionId: "sub_wa", token: "tok_wa" };

test("renewal carries phone, channel and consent off the recovered record", () => {
  const base = { ...pendingWhatsAppRecord(), status: "active", customerId: "cus_wa", subscriptionId: "sub_wa" };
  const rec = renewalRecordFromInvoice(RENEWAL, base, "2026-09-20T10:00:00.000Z");
  assert.equal(rec.status, "active");
  assert.equal(rec.phone, "+971501234567", "phone survived the renewal");
  assert.equal(rec.channel, "whatsapp", "channel survived the renewal");
  assert.deepEqual(rec.consent, base.consent, "gate-C1 consent survived the renewal");
  assert.deepEqual(droppedFields(base, rec), []);
});

test("renewal drops NO field of the recovered record (structural)", () => {
  const base = { ...pendingWhatsAppRecord(), status: "active", futureBindingField: "must survive" };
  const rec = renewalRecordFromInvoice(RENEWAL, base, "2026-09-20T10:00:00.000Z");
  assert.deepEqual(droppedFields(base, rec), []);
  assert.equal(rec.futureBindingField, "must survive");
});

test("a renewal that echoes no connect token must not orphan the record", () => {
  // The invoice→subscription link is recovered, but no connect token came with
  // it; the base was recovered from the DURABLE subscription store instead.
  const base = { ...pendingWhatsAppRecord(), status: "active", customerId: "cus_wa" };
  const rec = renewalRecordFromInvoice(
    { customerId: "cus_wa", subscriptionId: "sub_wa" }, // token absent
    base,
    "2026-09-20T10:00:00.000Z",
  );
  assert.equal(rec.token, "tok_wa", "the customer's connect token must survive the renewal");
  assert.notEqual(rec.token, "sub_wa", "must not be orphaned onto the subscription id");
});

test("a stale base can never override the RENEWAL outcome (counterfactual)", () => {
  // Guards my own change on the renewal side, mirroring the activation one.
  const rec = renewalRecordFromInvoice(
    { customerId: "cus_new", subscriptionId: "sub_new", token: "tok_wa" },
    {
      token: "tok_wa",
      plan: "studio",
      status: "cancelled",
      customerId: "cus_OLD",
      subscriptionId: "sub_OLD",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    "2026-09-20T10:00:00.000Z",
  );
  assert.equal(rec.status, "active", "a cancelled base must not survive a renewal");
  assert.equal(rec.customerId, "cus_new", "the invoice names the customer, not the base");
  assert.equal(rec.subscriptionId, "sub_new", "the invoice names the subscription, not the base");
  assert.equal(rec.plan, "studio", "the purchased tier is preserved, not reset to companion");
  assert.equal(rec.createdAt, "2026-01-01T00:00:00.000Z", "original createdAt is still preserved");
});

test("activation THEN renewal: the binding survives the whole customer lifetime", async () => {
  // The order that actually happens in production, and the reason the two fixes
  // are sequential rather than parallel: renewal can only preserve what
  // activation left in the durable subscription record.
  const store = fakeStore();
  await store.putConnect(pendingWhatsAppRecord());
  await activateCheckout(waSession(), { ...store, now: "2026-08-20T10:05:00.000Z" });

  // ~30 days later the connect record's 7-day TTL has expired (store.ts:169);
  // the renewal recovers its base from the DURABLE subscription record, which
  // has no TTL (store.ts:198). Model exactly that.
  store.connects.delete("tok_wa");
  const recovered = await store.getSubscription("cus_wa");
  assert.ok(recovered, "the durable subscription record outlives the connect TTL");

  const renewed = renewalRecordFromInvoice(RENEWAL, recovered, "2026-09-20T10:00:00.000Z");
  assert.equal(renewed.phone, "+971501234567", "phone survived activation AND renewal");
  assert.equal(renewed.channel, "whatsapp", "channel survived activation AND renewal");
  assert.deepEqual(renewed.consent, pendingWhatsAppRecord().consent, "consent survived both");
  assert.equal(renewed.token, "tok_wa", "still bindable through the original token");
  assert.deepEqual(droppedFields(recovered, renewed), []);
});

test("the renewal path has no SECOND record-shaping list to go stale (anti-drift)", () => {
  const route = readFileSync(join(ROOT, "src/app/api/webhooks/stripe/route.ts"), "utf8");
  const stripComments = (s) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const code = stripComments(route);
  // `assistantName:` / `persona:` as object keys is the fingerprint of a
  // hand-enumerated ConnectRecord rebuild. The route must shape records only
  // through the pure core now, so neither may reappear here.
  assert.ok(!/\bassistantName\s*:/.test(code), "route must not re-list record fields");
  assert.ok(!/\bpersona\s*:/.test(code), "route must not re-list record fields");
  assert.ok(
    /renewalRecordFromInvoice/.test(code),
    "the renewal must delegate to the pure core",
  );
  // Vacuity guard: the matcher must actually fire on the shape it targets, or
  // the assertions above would pass against a route that still re-lists.
  assert.ok(/\bassistantName\s*:/.test("  assistantName: base?.assistantName,"));
});

// ═══════════════════════════════════════════════════════════════════════════
// gotchas#267 — THE CHAT IDENTITY MUST OUTLIVE THE CONNECT RECORD
//
// A refund, a chargeback or dunning-exhausted revocation is pushed to the
// engine, and the engine accepts exactly ONE identity from this app: the
// telegramId (there is no tenantId anywhere in this repo). That id was written
// by claimConnect onto the CONNECT record only — and the connect record carries
// a 7-day TTL while the subscription record carries none. A customer who bound
// more than a week ago therefore could not be pushed at all: the webhook logged
// "NO telegramId" and only a reconciliation sweep would ever catch up.
//
// The repair is in claimConnect: it now mirrors the id onto the DURABLE
// subscription record too. These tests exercise both signup orders, the repeat
// claim, and the interaction with the connect-record mirror that
// applyDodoLifecycle performs — and the counterfactual block at the end re-runs
// the centrepiece against `git show HEAD:src/lib/store.ts` and REQUIRES it to
// fail there, so this suite cannot quietly stop detecting the fix.
// ═══════════════════════════════════════════════════════════════════════════

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadRoute } from "./route-harness/index.mjs";
import { activateDodo, applyDodoLifecycle } from "../src/lib/dodo-webhook-core.mjs";

const NOW = "2026-08-20T00:00:00.000Z";

/** A real-shaped Dodo subscription.active payload for the given token/customer. */
function dodoActive(token, customerId, plan = "companion") {
  return {
    metadata: { connect_token: token, plan },
    subscription_id: `sub_${customerId}`,
    customer: { customer_id: customerId, email: `${customerId}@example.com` },
  };
}

/** The pending connect record /api/checkout writes before the customer pays. */
function pendingConnect(token, plan = "companion") {
  return {
    token,
    plan,
    email: "buyer@example.com",
    status: "pending",
    phone: "+971501234567",
    channel: "whatsapp",
    createdAt: NOW,
  };
}

/** Activation exactly as the Dodo webhook runs it: ONE record, BOTH writes. */
function activationDeps(store) {
  return {
    getConnect: store.getConnect,
    getSubscription: store.getSubscription,
    putConnect: store.putConnect,
    putSubscription: store.putSubscription,
    now: NOW,
  };
}

/**
 * THE CENTREPIECE, factored out so the counterfactual block can run the exact
 * same assertions against the old store and require them to FAIL.
 *
 * Ordinary order of events: the customer pays, and only then runs /start.
 */
async function payThenStart(store, { customerId, token, telegramId }) {
  await store.putConnect(pendingConnect(token));
  await activateDodo(dodoActive(token, customerId), activationDeps(store));

  // Sanity: this is the state that made the defect invisible — the durable
  // record exists and is active, and it holds no identity at all.
  const beforeClaim = await store.getSubscription(customerId);
  assert.equal(beforeClaim.status, "active");
  assert.equal(beforeClaim.telegramId, undefined, "activation cannot know the chat id yet");

  const claim = await store.claimConnect(token, telegramId);
  assert.equal(claim.ok, true);
  return claim;
}

test("gotchas#267: pay THEN /start — the DURABLE subscription record carries the chat identity", async () => {
  const store = await loadRoute("src/lib/store.ts");
  await payThenStart(store, { customerId: "cus_S_pay_first", token: "tok_S_pay_first", telegramId: 424001 });

  const sub = await store.getSubscription("cus_S_pay_first");
  assert.equal(
    sub.telegramId,
    424001,
    "the record with NO TTL must hold the id a revocation months later has to push to",
  );
  // The mirror must copy an identity and nothing else: no status laundering.
  assert.equal(sub.status, "active");
  assert.equal(sub.customerId, "cus_S_pay_first");
  assert.equal(sub.phone, "+971501234567", "the binding fields are untouched");
  assert.equal(sub.channel, "whatsapp");
  // And the connect record is still bound, as it always was.
  assert.equal((await store.getConnect("tok_S_pay_first")).telegramId, 424001);
});

test("gotchas#267: /start THEN pay — activation still carries the id onto the durable record", async () => {
  // HONEST LABEL: this one PASSES against the unfixed store too, and it is in
  // the suite as a REGRESSION GUARD, not as evidence of the fix. In this order
  // the connect record is still `pending` with no customerId when the claim
  // lands, so there is no durable row to mirror onto; the id reaches the
  // subscription record because activation builds that record FROM the connect
  // record. What this proves is that the mirror did not disturb that path.
  const store = await loadRoute("src/lib/store.ts");
  await store.putConnect(pendingConnect("tok_S_start_first"));

  const claim = await store.claimConnect("tok_S_start_first", 424002);
  assert.equal(claim.ok, true);
  assert.equal(claim.rec.status, "bound", "pending -> bound on first claim");
  assert.equal(
    await store.getSubscription("cus_S_start_first"),
    null,
    "no subscription is invented for someone who has not paid",
  );

  await activateDodo(dodoActive("tok_S_start_first", "cus_S_start_first"), activationDeps(store));
  const sub = await store.getSubscription("cus_S_start_first");
  assert.equal(sub.telegramId, 424002);
  assert.equal(sub.status, "active");
});

test("gotchas#267: a second claim is a no-op — same id, byte-identical record", async () => {
  const store = await loadRoute("src/lib/store.ts");
  await payThenStart(store, { customerId: "cus_S_twice", token: "tok_S_twice", telegramId: 424003 });

  const afterFirst = JSON.stringify(await store.getSubscription("cus_S_twice"));
  const second = await store.claimConnect("tok_S_twice", 424003);
  assert.equal(second.ok, true);
  assert.equal(
    JSON.stringify(await store.getSubscription("cus_S_twice")),
    afterFirst,
    "claiming twice must not duplicate or reshape anything",
  );
  const third = await store.claimConnect("tok_S_twice", 424003);
  assert.equal(third.ok, true);
  assert.equal(JSON.stringify(await store.getSubscription("cus_S_twice")), afterFirst);

  // A different chat is still refused, and the durable record is untouched by
  // the refusal — a rejected claim must never re-point a live binding.
  const foreign = await store.claimConnect("tok_S_twice", 999999);
  assert.deepEqual(foreign, { ok: false, reason: "foreign" });
  assert.equal(JSON.stringify(await store.getSubscription("cus_S_twice")), afterFirst);
});

test("gotchas#267: an existing durable binding is never re-pointed by a claim", async () => {
  // Contrived but reachable: two connect tokens for one customer id, the
  // durable record already bound to the first chat. The mirror must decline —
  // aiming the next revocation at the wrong person is worse than not mirroring.
  const store = await loadRoute("src/lib/store.ts");
  await store.putSubscription("cus_S_conflict", {
    token: "tok_S_old", plan: "companion", email: "buyer@example.com", status: "active",
    provider: "dodo", customerId: "cus_S_conflict", telegramId: 424004, createdAt: NOW,
  });
  await store.putConnect({ ...pendingConnect("tok_S_new"), status: "active", customerId: "cus_S_conflict" });

  const claim = await store.claimConnect("tok_S_new", 424005);
  assert.equal(claim.ok, true, "the CONNECT record was unbound, so this claim is legitimate");
  assert.equal((await store.getConnect("tok_S_new")).telegramId, 424005);
  assert.equal(
    (await store.getSubscription("cus_S_conflict")).telegramId,
    424004,
    "the durable record keeps the identity it already had",
  );
});

/**
 * THE MIRRORING INTERACTION, PROVEN RATHER THAN REASONED ABOUT.
 *
 * applyDodoLifecycle writes the revoked subscription record and then MIRRORS it
 * over the connect key. Before this fix that mirror was destructive: the
 * subscription record held no id, so the flattened copy erased the only one
 * that existed, moments before the push tried to read it. This runs the real
 * core against the real store and checks the identity is still there
 * afterwards — on BOTH keys — which is exactly what the push reads first.
 */
async function refundAfterBinding(store, customerId, token, telegramId) {
  await payThenStart(store, { customerId, token, telegramId });
  const out = await applyDodoLifecycle(
    { refund_id: `ref_${customerId}`, customer: { customer_id: customerId } },
    "refund.succeeded",
    {
      getSubscription: store.getSubscription,
      putSubscription: store.putSubscription,
      putConnect: store.putConnect,
      alert: () => {},
      log: () => {},
    },
  );
  assert.equal(out.action, "revoke");
  assert.equal(out.changed, true);
  return out;
}

test("gotchas#267: the identity survives the lifecycle MIRROR — the push can find it", async () => {
  const store = await loadRoute("src/lib/store.ts");
  await refundAfterBinding(store, "cus_S_refund", "tok_S_refund", 424006);

  const sub = await store.getSubscription("cus_S_refund");
  assert.equal(sub.status, "refunded", "revocation still lands on the durable record");
  assert.equal(sub.telegramId, 424006, "and it still says WHO to revoke");
  // The mirror is no longer destructive: the flattened connect copy now carries
  // the id too, because the record it was flattened from carries it. This is
  // why the rescue wrapper in the Dodo route is now belt-and-braces rather than
  // the only thing standing between a refund and a customer who keeps their
  // tier forever.
  assert.equal((await store.getConnect("tok_S_refund")).telegramId, 424006);
});

// ── COUNTERFACTUAL: the same assertions against HEAD's store must FAIL ──────

test("gotchas#267 COUNTERFACTUAL: HEAD's store leaves the durable record identity-less", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mira-store-cf-"));
  const dest = join(dir, "store.ts");
  writeFileSync(
    dest,
    execFileSync("git", ["show", PRE_FIX_REV + ":src/lib/store.ts"], { cwd: ROOT, encoding: "utf8" }),
  );
  const old = await loadRoute(dest);

  // 1. The centrepiece must FAIL against the old code.
  let caught = null;
  try {
    await payThenStart(old, { customerId: "cus_CF_pay_first", token: "tok_CF_pay_first", telegramId: 424101 });
    const sub = await old.getSubscription("cus_CF_pay_first");
    assert.equal(sub.telegramId, 424101);
  } catch (err) {
    caught = err;
  }
  assert.ok(
    caught instanceof assert.AssertionError,
    "COUNTERFACTUAL BROKEN — the old store already mirrored the identity, so the " +
      "centrepiece test does not detect the fix and must be strengthened.",
  );

  // 2. And the old connect record really was the ONLY copy — which is what made
  //    the lifecycle mirror destructive.
  const oldSub = await old.getSubscription("cus_CF_pay_first");
  assert.equal(oldSub.telegramId, undefined);
  assert.equal((await old.getConnect("tok_CF_pay_first")).telegramId, 424101);

  // 3. The mirror interaction must FAIL against the old code too: after the
  //    refund flattens the subscription record over the connect key, NEITHER
  //    record names the customer and the push has nothing to send.
  await applyDodoLifecycle(
    { refund_id: "ref_CF", customer: { customer_id: "cus_CF_pay_first" } },
    "refund.succeeded",
    {
      getSubscription: old.getSubscription,
      putSubscription: old.putSubscription,
      putConnect: old.putConnect,
      alert: () => {},
      log: () => {},
    },
  );
  assert.equal((await old.getSubscription("cus_CF_pay_first")).status, "refunded");
  assert.equal(
    (await old.getConnect("tok_CF_pay_first")).telegramId,
    undefined,
    "this is gotchas#267 itself: the revocation lands and the identity is gone",
  );
});
