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
  wasEventProcessed,
  markEventProcessed,
  eventKey,
} from "../src/lib/webhook-core.mjs";

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
