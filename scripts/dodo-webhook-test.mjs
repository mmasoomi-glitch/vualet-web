import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  verifyDodoWebhook,
  activationRecordFromDodo,
  activateDodo,
  secretKeyBytes,
  droppedFields,
  resolveDodoPlan,
  productIdFromDodoPayload,
  dodoEventIsMiraOwned,
  LOWEST_PAID_PLAN,
  // Writer K — the Dodo lifecycle event handlers (decisions#341 Q1 / #342).
  DODO_EVENT_EFFECTS,
  KNOWN_DODO_EVENTS,
  STRIPE_ONLY_EVENT_NAMES,
  dodoEventEffect,
  applyDodoLifecycle,
  periodFieldsFromDodo,
  trialFieldsFromDodo,
} from "../src/lib/dodo-webhook-core.mjs";
import { PAID_PLANS } from "../src/lib/plan-core.mjs";
// THE REAL ENTITLEMENT GATE, imported rather than restated. Every "does this
// revoke?" assertion below is made against the same set the account page reads,
// so a change to what grants access cannot pass this suite unnoticed.
import { LIVE_DODO_STATUS } from "../src/lib/entitlement-core.mjs";
import { loadRoute, env, netCalls, resetNet, scriptFetch, readJson } from "./route-harness/index.mjs";

const dodo = await loadRoute("src/lib/dodo.ts");

function safeEqual(a, b) {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
const cryptoDeps = { createHmac: crypto.createHmac, Buffer, safeEqual };

// A real Standard-Webhooks secret is whsec_<base64>; sign the canonical content.
const SECRET = "whsec_" + Buffer.from("mira-dodo-test-secret-key").toString("base64");
function sign(id, ts, body) {
  const key = secretKeyBytes(Buffer, SECRET);
  const sig = crypto.createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return `v1,${sig}`;
}

// The REAL webhook route, loaded once. Tests that go through this exercise the
// actual switch, the actual signature check, the actual store and the actual
// dependency wiring — which is the only way to prove that a dependency the
// route forgot to inject (see planForProductId) is genuinely injected now.
const dodoRoute = await loadRoute("src/app/api/webhooks/dodo/route.ts");

/** POST a correctly signed Dodo event at the real route. */
async function postEvent(id, type, data) {
  const body = JSON.stringify({ type, data });
  const ts = String(Math.floor(Date.now() / 1000));
  const req = new Request("https://mira.vualet.com/api/webhooks/dodo", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": ts,
      "webhook-signature": sign(id, ts, body),
    },
    body,
  });
  return readJson(await dodoRoute.POST(req));
}

test("valid Standard-Webhooks signature verifies", () => {
  const id = "evt_1", ts = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ type: "subscription.active", data: {} });
  const v = verifyDodoWebhook(
    { id, timestamp: ts, signatureHeader: sign(id, ts, body), rawBody: body, secret: SECRET },
    cryptoDeps,
  );
  assert.equal(v.ok, true);
});

test("tampered body is rejected (bad_signature)", () => {
  const id = "evt_2", ts = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ type: "subscription.active", data: {} });
  const header = sign(id, ts, body);
  const v = verifyDodoWebhook(
    { id, timestamp: ts, signatureHeader: header, rawBody: body + "X", secret: SECRET },
    cryptoDeps,
  );
  assert.equal(v.ok, false);
  assert.equal(v.reason, "bad_signature");
});

test("stale timestamp is rejected (replay guard)", () => {
  const id = "evt_3", ts = String(Math.floor(Date.now() / 1000) - 10000);
  const body = "{}";
  const v = verifyDodoWebhook(
    { id, timestamp: ts, signatureHeader: sign(id, ts, body), rawBody: body, secret: SECRET },
    cryptoDeps,
  );
  assert.equal(v.ok, false);
  assert.equal(v.reason, "timestamp_out_of_tolerance");
});

test("missing headers rejected", () => {
  const v = verifyDodoWebhook(
    { id: "", timestamp: "", signatureHeader: "", rawBody: "{}", secret: SECRET },
    cryptoDeps,
  );
  assert.equal(v.ok, false);
  assert.equal(v.reason, "missing_headers");
});

test("activation reads plan from metadata (never a guessed default)", () => {
  const rec = activationRecordFromDodo(
    { metadata: { connect_token: "tok_abc", plan: "studio" }, subscription_id: "sub_1", customer: { customer_id: "cus_1", email: "a@b.co" } },
    null,
    "2026-07-30T00:00:00.000Z",
  );
  assert.equal(rec.plan, "studio");
  assert.equal(rec.token, "tok_abc");
  assert.equal(rec.status, "active");
  assert.equal(rec.customerId, "cus_1");
});

test("activation prefers an existing base plan over payload (upgrade-safe)", () => {
  const rec = activationRecordFromDodo(
    { metadata: { connect_token: "tok", plan: "companion" }, subscription_id: "sub_2" },
    { token: "tok", plan: "assistant", status: "pending", createdAt: "2026-07-01T00:00:00Z" },
    "2026-07-30T00:00:00.000Z",
  );
  assert.equal(rec.plan, "assistant");
});

test("activateDodo writes connect + subscription records via injected store", async () => {
  const connects = new Map(), subs = new Map();
  const rec = await activateDodo(
    { metadata: { connect_token: "tok_x", plan: "companion" }, subscription_id: "sub_x", customer: { customer_id: "cus_x" } },
    {
      getConnect: async (t) => connects.get(t) ?? null,
      putConnect: async (r) => { connects.set(r.token, r); },
      putSubscription: async (c, r) => { subs.set(c, r); },
      now: "2026-07-30T00:00:00.000Z",
    },
  );
  assert.equal(rec.plan, "companion");
  assert.equal(connects.get("tok_x").status, "active");
  assert.equal(subs.get("cus_x").status, "active");
});

// ── gotchas#257: activation must not DELETE the binding fields ─────────────
// The paid connect record was bindable right up until the customer paid, and
// unbindable the moment they did: activationRecordFromDodo rebuilt the record
// from a list of fields, and phone / channel / consent were not on that list.
// Nothing failed — the write succeeded and the fields simply ceased to exist —
// so these assert the ROUND TRIP through the real activateDodo, not that the
// builder happens to set them.

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

test("activation carries phone, channel and consent off the base record", () => {
  const base = pendingWhatsAppRecord();
  const rec = activationRecordFromDodo(
    { metadata: { connect_token: "tok_wa", plan: "companion" }, subscription_id: "sub_wa", customer: { customer_id: "cus_wa" } },
    base,
    "2026-08-20T10:05:00.000Z",
  );
  assert.equal(rec.status, "active");
  assert.equal(rec.phone, "+971501234567");
  assert.equal(rec.channel, "whatsapp");
  assert.deepEqual(rec.consent, base.consent);
});

test("activateDodo round trip: the PAID connect record is still bindable", async () => {
  const connects = new Map(), subs = new Map();
  const before = pendingWhatsAppRecord();
  connects.set(before.token, before);

  // Sanity: the record IS bindable before the money arrives.
  assert.equal(connects.get("tok_wa").phone, "+971501234567");

  await activateDodo(
    { metadata: { connect_token: "tok_wa", plan: "companion" }, subscription_id: "sub_wa", customer: { customer_id: "cus_wa" } },
    {
      getConnect: async (t) => connects.get(t) ?? null,
      putConnect: async (r) => { connects.set(r.token, r); },
      putSubscription: async (c, r) => { subs.set(c, r); },
      now: "2026-08-20T10:05:00.000Z",
    },
  );

  const after = connects.get("tok_wa");
  assert.equal(after.status, "active", "payment must mark it active");
  assert.equal(after.phone, "+971501234567", "phone survived the payment");
  assert.equal(after.channel, "whatsapp", "channel survived the payment");
  assert.deepEqual(after.consent, before.consent, "gate-C1 consent survived the payment");

  // The durable subscription record is the one support and entitlement read;
  // writer G proved it carried none of the fields either.
  const sub = subs.get("cus_wa");
  assert.equal(sub.phone, "+971501234567", "phone reached the subscription record");
  assert.equal(sub.channel, "whatsapp", "channel reached the subscription record");
  assert.deepEqual(sub.consent, before.consent, "consent reached the subscription record");
});

test("activation drops NO field of the base record (structural, not per-field)", () => {
  const base = pendingWhatsAppRecord();
  // A field this test does not know about — stands in for the next field some
  // future writer adds to the record. A per-field list cannot protect it.
  base.futureBindingField = "must survive";
  const rec = activationRecordFromDodo(
    { metadata: { connect_token: "tok_wa" }, subscription_id: "sub_wa", customer: { customer_id: "cus_wa" } },
    base,
    "2026-08-20T10:05:00.000Z",
  );
  assert.deepEqual(droppedFields(base, rec), []);
});

test("a stale base can never override the payment outcome (counterfactual)", () => {
  // The spread must not let an old record decide whether the customer paid.
  const rec = activationRecordFromDodo(
    { metadata: { connect_token: "tok_wa" }, subscription_id: "sub_new", customer: { customer_id: "cus_new" } },
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

// ── Payment identity: the event wins, the base only fills an ABSENCE ───────
// Adopted from writer I's webhook-core.mjs so the two cores stay one shape.

test("the base fills an ABSENT payment identity but never contradicts a present one", () => {
  const base = { token: "tok_wa", plan: "companion", status: "active",
    customerId: "cus_held", subscriptionId: "sub_held", createdAt: "2026-08-20T09:59:00.000Z" };

  // Event names NO identity -> the held ids survive instead of being nulled.
  const quiet = activationRecordFromDodo({ metadata: { connect_token: "tok_wa" } }, base, "2026-09-20T10:00:00.000Z");
  assert.equal(quiet.customerId, "cus_held", "a held customerId is not overwritten with undefined");
  assert.equal(quiet.subscriptionId, "sub_held", "a held subscriptionId is not overwritten with undefined");
  assert.deepEqual(droppedFields(base, quiet), [], "the invariant stays universal, with no exception");

  // Event NAMES an identity -> the payment wins outright. The base may only
  // supply what the payment left out; it may never contradict it.
  const loud = activationRecordFromDodo(
    { metadata: { connect_token: "tok_wa" }, subscription_id: "sub_new", customer: { customer_id: "cus_new" } },
    base, "2026-09-20T10:00:00.000Z");
  assert.equal(loud.customerId, "cus_new", "the payment names the customer, not the base");
  assert.equal(loud.subscriptionId, "sub_new", "the payment names the subscription, not the base");
});

// ── gotchas#258: the RENEWAL path, on the ARMED provider ───────────────────
// webhooks/dodo/route.ts routes subscription.renewed and payment.succeeded into
// activateDodo too. The gotchas#257 fix alone does NOT save the renewal, because
// there the failure is not the rebuild — it is that there is NO BASE TO REBUILD
// FROM: the connect record is stored with a 7-DAY TTL (store.ts:169) and a
// monthly subscription renews on day ~30, so getConnect returns null and the
// binding fields are written away over both records a month after purchase.

test("RENEWAL round trip: connect record already expired (7-day TTL, day-30 renewal)", async () => {
  const connects = new Map(); // expired — this is the NORMAL case at renewal
  const subs = new Map([["cus_wa", { ...pendingWhatsAppRecord(), status: "active",
    customerId: "cus_wa", subscriptionId: "sub_wa" }]]);
  const before = subs.get("cus_wa");

  await activateDodo(
    { metadata: { connect_token: "tok_wa" }, subscription_id: "sub_wa", customer: { customer_id: "cus_wa" } },
    {
      getConnect: async (t) => connects.get(t) ?? null,
      getSubscription: async (c) => subs.get(c) ?? null,
      putConnect: async (r) => { connects.set(r.token, r); },
      putSubscription: async (c, r) => { subs.set(c, r); },
      now: "2026-09-20T10:00:00.000Z",
    },
  );

  const sub = subs.get("cus_wa");
  assert.equal(sub.status, "active");
  assert.equal(sub.phone, "+971501234567", "renewal did not wipe the phone");
  assert.equal(sub.channel, "whatsapp", "renewal did not wipe the channel");
  assert.deepEqual(sub.consent, before.consent, "renewal did not wipe the consent");
  assert.deepEqual(droppedFields(before, sub), [], "renewal dropped no field at all");

  // The connect record is rewritten from the recovered base, so the renewal
  // RESTORES a bindable record rather than resurrecting a stripped one.
  const con = connects.get("tok_wa");
  assert.equal(con.phone, "+971501234567", "the restored connect record is bindable");
  assert.deepEqual(con.consent, before.consent);
});

test("RENEWAL round trip: payload echoes no connect_token at all", async () => {
  const kept = { ...pendingWhatsAppRecord(), status: "active", customerId: "cus_wa" };
  const connects = new Map([["tok_wa", kept]]);
  const subs = new Map([["cus_wa", kept]]);

  await activateDodo(
    { subscription_id: "sub_wa", customer: { customer_id: "cus_wa" } },
    {
      getConnect: async (t) => connects.get(t) ?? null,
      getSubscription: async (c) => subs.get(c) ?? null,
      putConnect: async (r) => { connects.set(r.token, r); },
      putSubscription: async (c, r) => { subs.set(c, r); },
      now: "2026-09-20T10:00:00.000Z",
    },
  );

  const sub = subs.get("cus_wa");
  assert.equal(sub.phone, "+971501234567", "renewal without a token did not wipe the phone");
  assert.deepEqual(sub.consent, kept.consent, "renewal without a token did not wipe the consent");
  // Without the base?.token backfill this becomes "sub_wa" — the subscription
  // record would be orphaned from the connect token the customer binds through.
  assert.equal(sub.token, "tok_wa", "the record's token is not rewritten to the subscription id");
});

test("activateDodo still works when no getSubscription dep is supplied (back-compat)", async () => {
  const connects = new Map([["tok_wa", pendingWhatsAppRecord()]]);
  const subs = new Map();
  const rec = await activateDodo(
    { metadata: { connect_token: "tok_wa" }, subscription_id: "sub_wa", customer: { customer_id: "cus_wa" } },
    {
      getConnect: async (t) => connects.get(t) ?? null,
      putConnect: async (r) => { connects.set(r.token, r); },
      putSubscription: async (c, r) => { subs.set(c, r); },
      now: "2026-09-20T10:00:00.000Z",
    },
  );
  assert.equal(rec.status, "active");
  assert.equal(rec.phone, "+971501234567");
  assert.equal(subs.get("cus_wa").phone, "+971501234567");
});


// ── decisions#341 Q3: the tier comes from the PRODUCT ACTUALLY PAID FOR ──
//
// THE DEFECT. The tier used to be `base?.plan ?? meta.plan ?? "companion"`, a
// chain ending in a guess, and `planForProductId()` — the one function that
// can say what the customer actually bought — was never called from anywhere
// in the repo. So a payment event carrying a customer id but no connect token
// and no metadata MINTED AN ACTIVE COMPANION SUBSCRIPTION: a real, paid-looking
// record for a tier nobody necessarily bought. The Stripe path was explicitly
// hardened against this exact shape; this path never was.
//
// COUNTERFACTUAL VALUE. Every assertion in this section fails against the
// pre-fix core, and not by accident of wording:
//   • the "resolves from the product id" tests fail because the pre-fix code
//     returns the metadata/base plan and ignores the product entirely;
//   • the alert tests fail because the pre-fix code has no alert at all — it
//     is silent by construction, which is the whole complaint;
//   • the fallback tests fail because the pre-fix fallback is a HARDCODED
//     "companion" rather than a tier derived from PAID_PLANS.
// Verified by running these expectations against `git show HEAD:` copies of
// both modules; see the writer's report.

/** The env-backed mapping, faked. Same signature as dodo.ts planForProductId. */
const PRODUCTS = {
  prod_companion_live: "companion",
  prod_assistant_live: "assistant",
  prod_studio_live: "studio",
};
const fakePlanForProductId = (id) => PRODUCTS[id] ?? null;

/** Capture the alert instead of watching a console. */
function alertSpy() {
  const lines = [];
  return { lines, alert: (...a) => lines.push(a.map(String).join(" ")) };
}

test("LOWEST_PAID_PLAN is DERIVED from the plan list, not typed out", () => {
  // The fallback tier must not be a second hardcoded guess. plan-core.mjs
  // documents PAID_PLANS as being in ASCENDING tier order, so the cheapest paid
  // tier is its first element, by definition and forever.
  assert.equal(LOWEST_PAID_PLAN, PAID_PLANS[0]);
  assert.ok(PAID_PLANS.includes(LOWEST_PAID_PLAN));
});

test("the granted tier is the PRODUCT ACTUALLY PAID FOR, not the metadata plan", () => {
  const spy = alertSpy();
  const rec = activationRecordFromDodo(
    {
      // Dodo charged for the STUDIO product; the metadata we sent says companion.
      product_id: "prod_studio_live",
      metadata: { connect_token: "tok_p", plan: "companion" },
      subscription_id: "sub_p",
      customer: { customer_id: "cus_p" },
    },
    null,
    "2026-08-21T00:00:00.000Z",
    { planForProductId: fakePlanForProductId, alert: spy.alert },
  );
  // Pre-fix this is "companion" — the tier is read off metadata and the
  // product is never looked at.
  assert.equal(rec.plan, "studio", "the product paid for decides the tier");
  assert.equal(rec.status, "active");
  assert.ok(
    spy.lines.some((l) => l.includes("plan mismatch") && l.includes("prod_studio_live")),
    "a product/metadata disagreement is surfaced, not swallowed",
  );
});

test("the product outranks a STALE stored plan (counterfactual)", () => {
  const spy = alertSpy();
  const rec = activationRecordFromDodo(
    { product_id: "prod_companion_live", metadata: { connect_token: "tok_s" }, customer: { customer_id: "cus_s" } },
    { token: "tok_s", plan: "studio", status: "pending", createdAt: "2026-08-01T00:00:00.000Z" },
    "2026-08-21T00:00:00.000Z",
    { planForProductId: fakePlanForProductId, alert: spy.alert },
  );
  // Pre-fix this is "studio": base.plan won unconditionally, so a record left
  // over from an abandoned higher-tier attempt granted a tier the customer
  // never paid for. The payment is the authority on what was bought.
  assert.equal(rec.plan, "companion", "the record cannot out-vote the payment");
});

test("an UNRESOLVABLE product grants the LOWEST PAID tier and ALERTS loudly", () => {
  const spy = alertSpy();
  const out = resolveDodoPlan(
    { product_id: "prod_not_in_env_mapping", customer: { customer_id: "cus_u" } },
    null,
    { planForProductId: fakePlanForProductId, alert: spy.alert },
  );
  // Ruled fallback: safe and generous, never a refusal.
  assert.equal(out.plan, LOWEST_PAID_PLAN, "grant the cheapest paid tier, never nothing");
  assert.equal(out.source, "fallback_lowest_paid");
  assert.equal(spy.lines.length, 1, "exactly one alert, not a silent grant and not a storm");
  assert.ok(spy.lines[0].includes("prod_not_in_env_mapping"), "the alert NAMES the unresolved product id");
  assert.ok(spy.lines[0].includes("ALERT"), "the alert is clearly marked");
  assert.ok(/URGENT/i.test(spy.lines[0]), "the alert says the mapping must be fixed urgently");
});

test("an unresolvable product still ALERTS but does not DOWNGRADE a known customer", () => {
  const spy = alertSpy();
  const out = resolveDodoPlan(
    { product_id: "prod_not_in_env_mapping", metadata: { connect_token: "tok_d" } },
    { token: "tok_d", plan: "studio", status: "pending" },
    { planForProductId: fakePlanForProductId, alert: spy.alert },
  );
  // "Safe and generous" cuts both ways: dropping a studio customer to the
  // cheapest tier because OUR env mapping is wrong is not generous, it is a
  // support ticket. We hold the tier we sold them, and we still scream.
  assert.equal(out.plan, "studio");
  assert.equal(out.source, "fallback_declared");
  assert.equal(spy.lines.length, 1);
  assert.ok(spy.lines[0].includes("prod_not_in_env_mapping"));
});

test("the ORIGINAL DEFECT: a payment with a customer id and nothing else no longer mints a silent companion", () => {
  const spy = alertSpy();
  const rec = activationRecordFromDodo(
    // No connect token, no metadata plan, no product id. Exactly the shape that
    // used to fabricate an active companion subscription out of thin air.
    { customer: { customer_id: "cus_ghost" }, subscription_id: "sub_ghost" },
    null,
    "2026-08-21T00:00:00.000Z",
    { planForProductId: fakePlanForProductId, alert: spy.alert },
  );
  // The VALUE is still the lowest paid tier — the judge forbade refusing a
  // paying customer — but it is now DERIVED and, decisively, it is NOT SILENT.
  // Pre-fix there was no alert here at all: that silence is the defect.
  assert.equal(rec.plan, LOWEST_PAID_PLAN);
  assert.equal(spy.lines.length, 1, "the fabricated tier is now audible");
  assert.ok(spy.lines[0].includes("no plan signal"), "the alert says why it had to guess");
  assert.ok(/URGENT/i.test(spy.lines[0]));
});

test("a resolvable product that AGREES with the record activates quietly", () => {
  const spy = alertSpy();
  const out = resolveDodoPlan(
    { product_id: "prod_assistant_live", metadata: { plan: "assistant" } },
    { plan: "assistant" },
    { planForProductId: fakePlanForProductId, alert: spy.alert },
  );
  assert.equal(out.plan, "assistant");
  assert.equal(out.source, "product");
  assert.deepEqual(spy.lines, [], "no alert when there is nothing wrong");
});

test("productIdFromDodoPayload reads the shapes Dodo actually sends", () => {
  assert.equal(productIdFromDodoPayload({ product_id: "p1" }), "p1");
  assert.equal(productIdFromDodoPayload({ product_cart: [{ product_id: "p2", quantity: 1 }] }), "p2");
  assert.equal(productIdFromDodoPayload({ subscription: { product_id: "p3" } }), "p3");
  assert.equal(productIdFromDodoPayload({ items: [{ product: { product_id: "p4" } }] }), "p4");
  assert.equal(productIdFromDodoPayload({ customer: { customer_id: "c" } }), undefined);
  // Strict about WHAT counts as an id: a number would never match an env string
  // and would send the customer to the fallback for an invisible reason.
  assert.equal(productIdFromDodoPayload({ product_id: 12345 }), undefined);
  assert.equal(productIdFromDodoPayload({ product_id: "" }), undefined);
  assert.equal(productIdFromDodoPayload(null), undefined);
});

test("activateDodo end to end: the SUBSCRIPTION record carries the product-derived tier", async () => {
  const spy = alertSpy();
  const connects = new Map([["tok_e2e", { token: "tok_e2e", plan: "companion", status: "pending", phone: "+971501234567", createdAt: "2026-08-01T00:00:00.000Z" }]]);
  const subs = new Map();
  const rec = await activateDodo(
    {
      product_id: "prod_studio_live",
      metadata: { connect_token: "tok_e2e", plan: "companion" },
      subscription_id: "sub_e2e",
      customer: { customer_id: "cus_e2e" },
    },
    {
      getConnect: async (t) => connects.get(t) ?? null,
      putConnect: async (r) => { connects.set(r.token, r); },
      putSubscription: async (c, r) => { subs.set(c, r); },
      now: "2026-08-21T00:00:00.000Z",
      planForProductId: fakePlanForProductId,
      alert: spy.alert,
    },
  );
  assert.equal(rec.plan, "studio");
  assert.equal(subs.get("cus_e2e").plan, "studio", "entitlement reads this record");
  assert.equal(connects.get("tok_e2e").plan, "studio");
  assert.equal(connects.get("tok_e2e").phone, "+971501234567", "gotchas#257 invariant still holds");
});

test("activateDodo without a planForProductId dep behaves exactly as before (back-compat)", async () => {
  // The route has not been rewired yet (that one line lives in a file this
  // writer does not own). Until it is, the ladder must degrade to the OLD
  // behaviour for events that carry a plan — no downgrade, no noise.
  const connects = new Map(), subs = new Map();
  const rec = await activateDodo(
    { metadata: { connect_token: "tok_bc", plan: "assistant" }, subscription_id: "sub_bc", customer: { customer_id: "cus_bc" } },
    {
      getConnect: async (t) => connects.get(t) ?? null,
      putConnect: async (r) => { connects.set(r.token, r); },
      putSubscription: async (c, r) => { subs.set(c, r); },
      now: "2026-08-21T00:00:00.000Z",
    },
  );
  assert.equal(rec.plan, "assistant");
  assert.equal(subs.get("cus_bc").status, "active");
});

// ── TAX JURISDICTION: billing.country is an input to the amount charged ──
//
// Dodo is MERCHANT OF RECORD and computes VAT/sales tax from billing.country.
// That field used to flow out of the request body into the Dodo call with no
// allowlist, no ISO validation and no length cap, so a direct API caller could
// name their own tax jurisdiction. It was invisible because the checkout page
// never sends the field — which is exactly why the ABSENT case is pinned here
// as carefully as the invalid one.
//
// These run against the REAL createDodoCheckout with the harness network kill
// switch, so "no charge was attempted" is evidence (netCalls) rather than a
// claim. Every credential below is a dummy.

const DODO_ARMED_J = {
  DODO_API_KEY: "dummy_dodo_key_not_real",
  DODO_MODE: "test",
  DODO_PAYMENTS_LIVE: "1",
  DODO_PRODUCT_COMPANION: "prod_dummy_companion",
  DODO_PRODUCT_ASSISTANT: "prod_dummy_assistant",
  DODO_PRODUCT_STUDIO: "prod_dummy_studio",
};

/** Run createDodoCheckout with a scripted Dodo reply; return the POSTed body. */
async function checkoutBody(input) {
  env(DODO_ARMED_J);
  resetNet();
  scriptFetch(async () => new Response(JSON.stringify({ payment_link: "https://checkout.example/pay", subscription_id: "sub_x" }), { status: 200, headers: { "content-type": "application/json" } }));
  const out = await dodo.createDodoCheckout({ plan: "companion", email: "buyer@example.com", connectToken: "tok_c", ...input });
  assert.equal(out.url, "https://checkout.example/pay");
  assert.equal(netCalls.length, 1, "exactly one call to Dodo");
  return JSON.parse(netCalls[0].body);
}

test("tax: an ABSENT country behaves EXACTLY as before (the live path today)", async () => {
  const body = await checkoutBody({});
  assert.equal(body.billing.country, dodo.DEFAULT_BILLING_COUNTRY);
  assert.equal(body.billing.country, "AE", "the historical default is unchanged");
  // "" was falsy under the old `input.country || "AE"` and must stay absent-shaped.
  const empty = await checkoutBody({ country: "" });
  assert.equal(empty.billing.country, "AE");
});

test("tax: a VALID country is passed through (and only case-normalised)", async () => {
  const de = await checkoutBody({ country: "DE" });
  assert.equal(de.billing.country, "DE");
  const lower = await checkoutBody({ country: " de " });
  assert.equal(lower.billing.country, "DE", "same jurisdiction the caller named");
});

test("tax: an INVALID country is REFUSED, not coerced, and no charge is attempted", async () => {
  env(DODO_ARMED_J);
  resetNet();
  scriptFetch(async () => new Response("{}", { status: 200 }));
  // "ZZ" is correctly SHAPED but is not an assigned ISO-3166-1 alpha-2 code —
  // a regex would wave it through. Pre-fix it reached Dodo as billing.country.
  await assert.rejects(
    () => dodo.createDodoCheckout({ plan: "companion", email: "b@e.co", connectToken: "t", country: "ZZ" }),
    /invalid billing country/i,
  );
  assert.equal(netCalls.length, 0, "refused BEFORE the provider was called — nothing was charged");

  // The refusal must not be a quiet coercion to our own jurisdiction.
  assert.throws(() => dodo.normalizeBillingCountry("XX"), /invalid billing country/i);
  assert.throws(() => dodo.normalizeBillingCountry("UAE"), /invalid billing country/i);
  assert.throws(() => dodo.normalizeBillingCountry("A"), /invalid billing country/i);
  assert.throws(() => dodo.normalizeBillingCountry("   "), /invalid billing country/i);
  assert.throws(() => dodo.normalizeBillingCountry("DE; DROP"), /invalid billing country/i);
  // The declared TypeScript type is a promise the network never made.
  assert.throws(() => dodo.normalizeBillingCountry(971), /invalid billing country/i);
  assert.throws(() => dodo.normalizeBillingCountry({ toString: () => "DE" }), /invalid billing country/i);
});

test("tax: the allowlist is the real ISO-3166-1 alpha-2 set", () => {
  assert.equal(dodo.ISO_3166_1_ALPHA2.size, 249, "the officially assigned codes");
  for (const c of ["AE", "US", "GB", "DE", "IN", "SA", "JP", "BR", "ZA", "NZ"]) {
    assert.ok(dodo.ISO_3166_1_ALPHA2.has(c), `${c} must be accepted`);
  }
  for (const c of ["ZZ", "XX", "QQ", "UK", "EU", "AA"]) {
    assert.ok(!dodo.ISO_3166_1_ALPHA2.has(c), `${c} must not be accepted`);
  }
});

test("tax: name is bounded before it reaches the provider", async () => {
  const long = await checkoutBody({ name: "N".repeat(5000) });
  assert.equal(long.customer.name.length, 100, "capped, not sent unbounded");
  const dirty = await checkoutBody({ name: "Ada\u0000\nLovelace   \t X" });
  assert.equal(dirty.customer.name, "Ada Lovelace X", "control characters stripped, whitespace collapsed");
  const blank = await checkoutBody({ name: "   " });
  assert.equal(blank.customer.name, "buyer", "an empty name falls back to the email local-part, never blank");
  assert.equal(dodo.boundedCustomerName("", "x".repeat(400)).length, 100, "the fallback is bounded too");
});

// ═══════════════════════════════════════════════════════════════════════════
// WRITER K — DODO LIFECYCLE EVENT HANDLERS
// decisions#341 Q1 + decisions#342, gotchas#261/#262, verifications#412/#413
//
// The thing these tests are really guarding is a policy, not a function: WHEN
// does a webhook take a paying customer's access away? Every assertion below
// is written so it fails if that policy changes, including the ones that look
// like plumbing.
// ═══════════════════════════════════════════════════════════════════════════

// A store pair that records what was written, so a test can assert "nothing
// was written" as positively as it asserts a value.
function fakeStores(seed = {}) {
  const subs = new Map(Object.entries(seed));
  const connects = new Map();
  const writes = [];
  return {
    subs,
    connects,
    writes,
    getSubscription: async (c) => (subs.has(c) ? { ...subs.get(c) } : null),
    putSubscription: async (c, r) => {
      writes.push({ store: "sub", key: c, rec: r });
      subs.set(c, r);
    },
    putConnect: async (r) => {
      writes.push({ store: "connect", key: r.token, rec: r });
      connects.set(r.token, r);
    },
  };
}

function alerts() {
  const seen = [];
  const fn = (...a) => seen.push(a.map(String).join(" "));
  fn.seen = seen;
  fn.text = () => seen.join("\n");
  return fn;
}

const quiet = () => {};

// A realistic ACTIVE paying customer, carrying the binding fields gotchas#257
// cost us once already.
const ACTIVE = Object.freeze({
  token: "tok_live",
  plan: "assistant",
  status: "active",
  email: "paid@example.com",
  customerId: "cus_K1",
  subscriptionId: "sub_K1",
  phone: "+971501234567",
  channel: "whatsapp",
  consent: { whatsappMessages: true },
  createdAt: "2026-01-01T00:00:00.000Z",
});

// ── Event-name integrity ──────────────────────────────────────────────────

test("K: every event in the effect table is a REAL Dodo event name", () => {
  for (const type of Object.keys(DODO_EVENT_EFFECTS)) {
    assert.ok(
      KNOWN_DODO_EVENTS.has(type),
      `"${type}" is routed but is not in the verified Dodo catalogue (gotchas#261)`,
    );
  }
  assert.equal(KNOWN_DODO_EVENTS.size, 26, "the 26 verified money-path event names");
});

test("K: every verified Dodo money-path event has a decided effect", () => {
  const missing = [...KNOWN_DODO_EVENTS].filter((t) => !dodoEventEffect(t));
  assert.deepEqual(missing, [], "an event with no effect row is an unhandled event");
});

test("K: no Stripe event name leaks into the Dodo routing", async () => {
  // Dodo has NO invoice.paid and NO invoice.payment_failed — those are Stripe
  // names, and this repo runs both providers, so reaching for the familiar one
  // produces a handler that compiles and never fires.
  for (const name of STRIPE_ONLY_EVENT_NAMES) {
    assert.equal(dodoEventEffect(name), null, `${name} must not be routed as a Dodo event`);
    assert.ok(!KNOWN_DODO_EVENTS.has(name), `${name} is not a Dodo event`);
  }

  // subscription.canceled — American spelling, one L — sat in the route switch
  // looking exactly like coverage. Assert it is gone from the source, because
  // the harm was that a reader BELIEVED it, not that it executed.
  const routeSrc = await readFile(new URL("../src/app/api/webhooks/dodo/route.ts", import.meta.url), "utf8");
  assert.ok(
    !/"subscription\.canceled"/.test(routeSrc),
    "the dead one-L case must not be reinstated: it is not a Dodo event and it disguises the gap",
  );
  assert.ok(!/"invoice\.paid"/.test(routeSrc), "invoice.paid is a Stripe name");
});

// ── The revocation policy itself ──────────────────────────────────────────

test("K: revoke ONLY on a final outcome — dispute.opened must not cost access", () => {
  // The judge, verbatim: "A dispute opened is not final; many merchants win.
  // Revoking on dispute.opened punishes a customer who may be entirely in the
  // right. Revoke only on dispute lost."
  for (const type of ["dispute.opened", "dispute.challenged"]) {
    const e = dodoEventEffect(type);
    assert.equal(e.kind, "flag", `${type} must only flag`);
    assert.equal(e.status, undefined, `${type} must not name a status to write`);
  }
  for (const type of ["dispute.lost", "dispute.accepted", "dispute.expired"]) {
    const e = dodoEventEffect(type);
    assert.equal(e.kind, "revoke", `${type} is a final adverse outcome`);
    assert.equal(e.status, "chargeback");
  }
  assert.equal(dodoEventEffect("refund.succeeded").status, "refunded", "a refund is final");
  assert.equal(dodoEventEffect("refund.failed").kind, "log", "a refund that did NOT happen revokes nothing");
});

test("K: one failed charge does not revoke; dunning EXHAUSTED does", () => {
  assert.equal(dodoEventEffect("payment.failed").kind, "flag", "a single decline is a bank event");
  assert.equal(dodoEventEffect("payment.failed").pastDue, true);
  assert.equal(dodoEventEffect("dunning.started").kind, "flag");
  assert.equal(dodoEventEffect("subscription.on_hold").kind, "revoke", "this is the real lapse signal");
  assert.equal(dodoEventEffect("subscription.on_hold").status, "on_hold");
});

test("K: the policy is stated against the REAL entitlement gate, not a copy", () => {
  // This is the assertion that makes every "revoke"/"flag" label mean
  // something. LIVE_DODO_STATUS is imported from the module the account page
  // actually consults, so if someone widened that set to include "on_hold",
  // this test — not a customer — finds out.
  for (const [type, e] of Object.entries(DODO_EVENT_EFFECTS)) {
    if (e.kind === "revoke") {
      assert.ok(
        !LIVE_DODO_STATUS.has(e.status),
        `${type} claims to revoke but writes "${e.status}", which still grants access`,
      );
    }
    if (e.kind === "flag") {
      assert.ok(e.status === undefined, `${type} claims not to revoke but names a status`);
    }
  }
  assert.ok(LIVE_DODO_STATUS.has("active"), "restore targets the one status that grants access");
  assert.equal(LIVE_DODO_STATUS.size, 1, "exactly one status grants access; every other value revokes");
});

// ── Behaviour, through the real orchestrator with fake I/O ────────────────

async function run(type, payload, { seed = ACTIVE, deps = {} } = {}) {
  const s = fakeStores({ [seed.customerId]: { ...seed } });
  const a = alerts();
  const out = await applyDodoLifecycle(payload, type, {
    getSubscription: s.getSubscription,
    putSubscription: s.putSubscription,
    putConnect: s.putConnect,
    now: "2026-08-21T00:00:00.000Z",
    alert: a,
    log: quiet,
    ...deps,
  });
  return { out, stores: s, alert: a, rec: s.subs.get(seed.customerId) };
}

test("K: dispute.opened flags the record and the customer KEEPS access", async () => {
  const { out, rec } = await run("dispute.opened", {
    dispute_id: "dis_1",
    payment_id: "pay_1",
    amount: 3900,
    customer: { customer_id: "cus_K1" },
  });
  assert.equal(out.ok, true);
  assert.equal(rec.status, "active", "an open dispute is not an outcome");
  assert.ok(LIVE_DODO_STATUS.has(rec.status), "still entitled — this is the whole ruling");
  assert.equal(rec.disputed, true, "but an operator can see it");
  assert.equal(rec.disputeStatus, "opened");
});

test("K: dispute.lost revokes, and dispute.won afterwards gives it back", async () => {
  const lost = await run("dispute.lost", {
    dispute_id: "dis_2",
    payment_id: "pay_2",
    is_resolved_by_rdr: true, // Visa RDR auto-refund arrives exactly like this
    customer: { customer_id: "cus_K1" },
  });
  assert.equal(lost.rec.status, "chargeback");
  assert.ok(!LIVE_DODO_STATUS.has(lost.rec.status), "the money was clawed back");

  // Webhook delivery is not ordered. A late win must be able to put right a
  // revocation we should not be holding.
  const won = await run(
    "dispute.won",
    { dispute_id: "dis_2", payment_id: "pay_2", customer: { customer_id: "cus_K1" } },
    { seed: { ...ACTIVE, status: "chargeback", disputed: true, disputeStatus: "lost" } },
  );
  assert.equal(won.rec.status, "active", "a won dispute must not leave a wrongly-revoked customer");
  assert.equal(won.rec.disputed, false);
  assert.equal(won.rec.disputeStatus, "won");
});

test("K: a refund resolves its customer through payment_id, never a guessed field", async () => {
  // gotchas#262: refund payload shape is UNVERIFIED (Dodo's intent doc is an
  // empty stub, the live /refunds list is empty). So the handler goes through
  // the payment hop, which IS verified, instead of inventing a customer field.
  const asked = [];
  const { out, rec } = await run(
    "refund.succeeded",
    { refund_id: "ref_1", payment_id: "pay_9", amount: 3900 },
    {
      deps: {
        resolvePaymentIdentity: async (id) => {
          asked.push(id);
          return { customerId: "cus_K1", subscriptionId: "sub_K1" };
        },
      },
    },
  );
  assert.deepEqual(asked, ["pay_9"], "GET /payments/{payment_id} is the hop that finds the human");
  assert.equal(out.ok, true);
  assert.equal(rec.status, "refunded", "a refund is final; the money is back with the customer");
  assert.ok(!LIVE_DODO_STATUS.has(rec.status));
});

test("K: the payment hop is skipped when the event already names the customer", async () => {
  let called = 0;
  await run(
    "subscription.on_hold",
    { customer: { customer_id: "cus_K1" }, subscription_id: "sub_K1" },
    { deps: { resolvePaymentIdentity: async () => (called++, null) } },
  );
  assert.equal(called, 0, "no API call for an event that identifies the customer itself");
});

test("K: an unidentifiable refund alerts LOUDLY and revokes NOBODY", async () => {
  // The honest failure. A wrong revocation is a locked-out paying customer;
  // doing nothing and screaming is the cheaper of the two mistakes.
  const { out, stores, alert, rec } = await run("refund.succeeded", { refund_id: "ref_x", amount: 100 });
  assert.equal(out.ok, false);
  assert.equal(out.action, "unresolved_customer");
  assert.equal(rec.status, "active", "the customer was NOT revoked on a guess");
  assert.deepEqual(stores.writes, [], "nothing was written at all");
  assert.match(alert.text(), /ALERT/, "it fails loudly rather than silently");
  assert.match(alert.text(), /NO access was revoked/);
});

test("K: payment.failed flags past_due WITHOUT revoking", async () => {
  const { rec } = await run("payment.failed", { customer: { customer_id: "cus_K1" }, payment_id: "pay_f" });
  assert.equal(rec.status, "active", "one decline is the bank's behaviour, not the customer's decision");
  assert.ok(LIVE_DODO_STATUS.has(rec.status));
  assert.equal(rec.pastDue, true);
  assert.equal(rec.pastDueSince, "2026-08-21T00:00:00.000Z");
});

test("K: dunning runs its full course — started, exhausted, recovered", async () => {
  const started = await run("dunning.started", { customer: { customer_id: "cus_K1" } });
  assert.equal(started.rec.status, "active", "retries are in flight; access stands");
  assert.equal(started.rec.pastDue, true);

  const held = await run("subscription.on_hold", { customer: { customer_id: "cus_K1" } }, {
    seed: { ...ACTIVE, pastDue: true, pastDueSince: "2026-08-01T00:00:00.000Z" },
  });
  assert.equal(held.rec.status, "on_hold", "dunning exhausted IS the lapse");
  assert.ok(!LIVE_DODO_STATUS.has(held.rec.status));

  const back = await run("dunning.recovered", { customer: { customer_id: "cus_K1" } }, {
    seed: { ...ACTIVE, status: "on_hold", pastDue: true, pastDueSince: "2026-08-01T00:00:00.000Z" },
  });
  assert.equal(back.rec.status, "active", "a recovered payment restores the subscription");
  assert.equal(back.rec.pastDue, false);
  assert.equal(back.rec.pastDueSince, undefined);
});

test("K: past_due remembers the FIRST failure, not the latest retry", async () => {
  const { rec } = await run("payment.failed", { customer: { customer_id: "cus_K1" } }, {
    seed: { ...ACTIVE, pastDue: true, pastDueSince: "2026-08-01T00:00:00.000Z" },
  });
  assert.equal(
    rec.pastDueSince,
    "2026-08-01T00:00:00.000Z",
    "overwriting this on every retry erases how long it has been going on",
  );
});

test("K: pause revokes and unpause restores", async () => {
  const paused = await run("subscription.paused", { customer: { customer_id: "cus_K1" } });
  assert.equal(paused.rec.status, "paused");
  assert.ok(!LIVE_DODO_STATUS.has(paused.rec.status));

  const resumed = await run("subscription.unpaused", { customer: { customer_id: "cus_K1" } }, {
    seed: { ...ACTIVE, status: "paused" },
  });
  assert.equal(resumed.rec.status, "active");
});

test("K: a restore may lift ONLY the revocation it is about", async () => {
  // The dangerous edge, and the reason every restore row carries `from`.
  // Without it, a stray dunning.recovered hands a REFUNDED customer their
  // subscription back — an unpaid grant caused by a reversal event that had no
  // authority over that status at all.
  for (const [type, badStatus] of [
    ["dunning.recovered", "refunded"],
    ["dunning.recovered", "cancelled"],
    ["subscription.unpaused", "chargeback"],
    ["dispute.won", "cancelled"],
    ["dispute.cancelled", "refunded"],
  ]) {
    const { out, rec } = await run(type, { customer: { customer_id: "cus_K1" } }, {
      seed: { ...ACTIVE, status: badStatus },
    });
    assert.equal(rec.status, badStatus, `${type} must NOT resurrect a "${badStatus}" record`);
    assert.ok(!LIVE_DODO_STATUS.has(rec.status), `${type} must not grant unpaid access`);
    assert.match(out.note, /REFUSED to restore/);
  }
});

test("K: replayed events are no-ops — Dodo retries must not corrupt state", async () => {
  const first = await run("refund.succeeded", {
    refund_id: "ref_r",
    customer: { customer_id: "cus_K1" },
  });
  assert.equal(first.rec.status, "refunded");

  const replay = await run("refund.succeeded", { refund_id: "ref_r", customer: { customer_id: "cus_K1" } }, {
    seed: first.rec,
  });
  assert.equal(replay.out.changed, false, "a redelivery is not a second revocation");
  assert.deepEqual(replay.stores.writes, [], "and it writes nothing at all");
  assert.deepEqual(replay.rec, first.rec, "the record is byte-identical after a replay");
});

test("K: no lifecycle transition DROPS a field of the record (structural)", async () => {
  // gotchas#257 the other way round. Activation once destroyed phone/channel/
  // consent by rebuilding the record from a list; a dispute handler written the
  // same way would do it again, a month later, on a customer in trouble.
  for (const type of Object.keys(DODO_EVENT_EFFECTS)) {
    const e = dodoEventEffect(type);
    if (e.kind === "activate" || e.kind === "log") continue;
    const { rec } = await run(type, { customer: { customer_id: "cus_K1" }, payment_id: "p" });
    assert.deepEqual(
      droppedFields(ACTIVE, rec),
      [],
      `${type} destroyed a field of the record`,
    );
    assert.equal(rec.phone, ACTIVE.phone, `${type} must keep the customer bindable`);
    assert.equal(rec.consent.whatsappMessages, true, `${type} must keep the consent proof`);
  }
});

test("K: a handler NEVER throws — a throw is a Dodo retry into a paying customer", async () => {
  const a = alerts();
  const out = await applyDodoLifecycle(
    { customer: { customer_id: "cus_K1" } },
    "refund.succeeded",
    {
      getSubscription: async () => {
        throw new Error("store is down");
      },
      putSubscription: async () => {},
      alert: a,
      log: quiet,
    },
  );
  assert.equal(out.ok, false);
  assert.equal(out.action, "error");
  assert.match(a.text(), /ALERT/);
});

test("K: an event for a customer we hold no record for changes nothing, loudly", async () => {
  const s = fakeStores();
  const a = alerts();
  const out = await applyDodoLifecycle({ customer: { customer_id: "cus_ghost" } }, "dispute.lost", {
    getSubscription: s.getSubscription,
    putSubscription: s.putSubscription,
    alert: a,
    log: quiet,
  });
  assert.equal(out.action, "no_record");
  assert.deepEqual(s.writes, []);
  assert.match(a.text(), /ALERT/);
});

test("K: plan_changed re-resolves the tier from the product ACTUALLY paid for", async () => {
  const { rec, out } = await run(
    "subscription.plan_changed",
    { customer: { customer_id: "cus_K1" }, product_id: "prod_studio" },
    { deps: { planForProductId: (id) => (id === "prod_studio" ? "studio" : null) } },
  );
  assert.equal(rec.plan, "studio", "the product Dodo charged for decides the tier");
  assert.equal(rec.status, "active", "a plan change is not an entitlement change");
  assert.match(out.note, /assistant -> studio/);
});

test("K: an unresolvable plan_changed never downgrades a customer we already sold", async () => {
  const { rec } = await run(
    "subscription.plan_changed",
    { customer: { customer_id: "cus_K1" }, product_id: "prod_unknown" },
    { deps: { planForProductId: () => null } },
  );
  assert.equal(rec.plan, "assistant", "rung 2 of writer J's ladder: the plan we recorded holds");
});

// ── The record shape other writers depend on ──────────────────────────────

test("K: every Dodo activation tags its provider (verifications#412)", () => {
  const rec = activationRecordFromDodo(
    { metadata: { connect_token: "tok_p" }, customer: { customer_id: "cus_p" }, subscription_id: "sub_p" },
    null,
    "2026-08-21T00:00:00.000Z",
    { planForProductId: () => "companion" },
  );
  assert.equal(
    rec.provider,
    "dodo",
    "the Stripe and Dodo paths share the mira:sub:<customerId> namespace; without this " +
      "a legacy Stripe row is probed against Dodo and misdiagnosed as an orphan",
  );
});

test("K: billing-period fields are read from the payload, never invented", () => {
  assert.deepEqual(
    periodFieldsFromDodo({ cancel_at_next_billing_date: true, next_billing_date: "2026-09-15T00:00:00Z" }),
    { cancelAtPeriodEnd: true, currentPeriodEnd: "2026-09-15T00:00:00Z" },
  );
  // An event that says nothing about the period must not erase what we hold.
  assert.deepEqual(periodFieldsFromDodo({ customer: { customer_id: "c" } }), {});
  // A truthy string is not a boolean. "false" must never become true.
  assert.deepEqual(periodFieldsFromDodo({ cancel_at_next_billing_date: "false" }), {});
  assert.equal(periodFieldsFromDodo({ cancel_at_next_billing_date: false }).cancelAtPeriodEnd, false);
});

test("K: activation records the period the customer paid for (decisions#342 Q_C)", () => {
  const rec = activationRecordFromDodo(
    {
      metadata: { connect_token: "tok_c" },
      customer: { customer_id: "cus_c" },
      cancel_at_next_billing_date: true,
      next_billing_date: "2026-09-15T00:00:00Z",
    },
    null,
    "2026-08-21T00:00:00.000Z",
    { planForProductId: () => "companion" },
  );
  // These two fields are what lets the cancel route stop confiscating a month
  // the customer already paid for: "still entitled, and it ends on this date".
  assert.equal(rec.cancelAtPeriodEnd, true);
  assert.equal(rec.currentPeriodEnd, "2026-09-15T00:00:00Z");
  assert.equal(rec.status, "active", "billing stopping at period end is not access ending now");
  assert.ok(LIVE_DODO_STATUS.has(rec.status));
});

test("K: a lifecycle event carrying no period leaves a recorded one intact", async () => {
  const { rec } = await run("dispute.opened", { customer: { customer_id: "cus_K1" }, payment_id: "p" }, {
    seed: { ...ACTIVE, cancelAtPeriodEnd: true, currentPeriodEnd: "2026-09-15T00:00:00Z" },
  });
  assert.equal(rec.currentPeriodEnd, "2026-09-15T00:00:00Z");
  assert.equal(rec.cancelAtPeriodEnd, true);
});

// ── The tier ladder is actually WIRED (judge condition 1) ─────────────────

test("K: the REAL route grants the tier of the product Dodo charged for", async () => {
  // This is the end-to-end proof that planForProductId reaches activateDodo.
  // Until it did, writer J's ladder degraded to rung 2 in production and the
  // "FIX THE PRODUCT MAPPING URGENTLY" alert the ruling exists to produce could
  // never fire. The payload deliberately carries NO connect token and NO
  // metadata plan, so the product id is the ONLY tier signal there is: if the
  // resolver is not wired, nothing can answer "studio".
  env({
    DODO_API_KEY: "dodo_test_key",
    DODO_MODE: "test",
    DODO_PRODUCT_COMPANION: "prod_c",
    DODO_PRODUCT_ASSISTANT: "prod_a",
    DODO_PRODUCT_STUDIO: "prod_s",
  });
  process.env.DODO_WEBHOOK_SECRET = SECRET;
  resetNet();

  const store = await loadRoute("src/lib/store.ts");
  const { status } = await postEvent("evt_wire_1", "subscription.active", {
    customer: { customer_id: "cus_wire", email: "wire@example.com" },
    subscription_id: "sub_wire",
    product_id: "prod_s",
  });
  assert.equal(status, 200);
  const rec = await store.getSubscription("cus_wire");
  assert.equal(rec.plan, "studio", "resolver NOT WIRED would have granted the lowest paid tier instead");
  assert.equal(rec.provider, "dodo");
  assert.equal(netCalls.length, 0, "activation needs no API call");
});

test("K: the REAL route holds access through an open dispute and drops it on a loss", async () => {
  env({ DODO_API_KEY: "dodo_test_key", DODO_MODE: "test", DODO_PRODUCT_STUDIO: "prod_s" });
  process.env.DODO_WEBHOOK_SECRET = SECRET;
  resetNet();
  const store = await loadRoute("src/lib/store.ts");

  await postEvent("evt_d0", "subscription.active", {
    customer: { customer_id: "cus_d", email: "d@example.com" },
    subscription_id: "sub_d",
    product_id: "prod_s",
  });

  // Script the payment hop BEFORE the dispute lands. Without this the fetch is
  // blocked, identity comes back unresolved, and the record stays active for
  // the WRONG reason — a vacuous pass. The `disputed` assertion below is the
  // one that can only be true if the hop genuinely succeeded.
  resetNet();
  scriptFetch(async () =>
    new Response(JSON.stringify({ customer: { customer_id: "cus_d" }, subscription_id: "sub_d" }), { status: 200 }),
  );
  const opened = await postEvent("evt_d1", "dispute.opened", {
    dispute_id: "dis_r",
    payment_id: "pay_r",
    amount: 7900,
  });
  assert.equal(opened.status, 200);
  assert.deepEqual(opened.body, { received: true }, "answered received, never retried");
  // The dispute payload named NO customer, so the route had to take the
  // payment hop — and it did, against the real GET /payments/{id}.
  assert.equal(netCalls.length, 1);
  assert.match(netCalls[0].url, /\/payments\/pay_r$/);
  let rec = await store.getSubscription("cus_d");
  assert.equal(rec.status, "active", "an open dispute must not cost a paying customer their access");
  assert.equal(rec.disputed, true);

  resetNet();
  scriptFetch(async () => new Response(JSON.stringify({ customer: { customer_id: "cus_d" } }), { status: 200 }));
  const lost = await postEvent("evt_d2", "dispute.lost", { dispute_id: "dis_r", payment_id: "pay_r" });
  assert.equal(lost.status, 200);
  rec = await store.getSubscription("cus_d");
  assert.equal(rec.status, "chargeback", "a LOST dispute is a final outcome");
});

test("K: an unhandled event type is still answered received:true, not retried", async () => {
  env({});
  process.env.DODO_WEBHOOK_SECRET = SECRET;
  resetNet();
  const r = await postEvent("evt_unknown", "license_key.created", { license_key_id: "lk_1" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { received: true });
});

// ── Judge condition 2: PAID_PLANS ordering is asserted, not asserted-by-comment ──

test("K: PAID_PLANS really is in ascending price order (LOWEST_PAID_PLAN is safe)", async () => {
  // LOWEST_PAID_PLAN = PAID_PLANS[0] trusts a COMMENT in plan-core.mjs that
  // says "ascending tier order". If an unrelated edit ever violated that, the
  // ruled safe-and-generous fallback would silently start granting the WRONG
  // tier, and nothing would go red.
  //
  // Checking the array against a list typed here would just re-encode the same
  // assumption in a second place, so this reads the repo's declared PRICE
  // AUTHORITY instead: src/app/mira/_components/tiers.ts, which calls itself
  // the single source of truth for pricing and which system-knowledge.mjs
  // cross-checks against veridian-kb.ts. Reorder PAID_PLANS, or make a cheaper
  // plan anything other than first, and this fails.
  const tiers = await loadRoute("src/app/mira/_components/tiers.ts");
  const priceOf = (slug) => {
    const t = tiers.TIERS.find((x) => x.id === slug);
    assert.ok(t, `the price authority names no tier "${slug}" — PAID_PLANS and pricing have diverged`);
    const n = Number(String(t.price).replace(/[^0-9.]/g, ""));
    assert.ok(Number.isFinite(n) && n > 0, `tier "${slug}" has no usable paid price ("${t.price}")`);
    return n;
  };

  const prices = PAID_PLANS.map(priceOf);
  for (let i = 1; i < prices.length; i++) {
    assert.ok(
      prices[i] > prices[i - 1],
      `PAID_PLANS is not ascending: ${PAID_PLANS[i - 1]} ($${prices[i - 1]}) is not cheaper than ` +
        `${PAID_PLANS[i]} ($${prices[i]}). LOWEST_PAID_PLAN would grant the wrong tier.`,
    );
  }
  assert.equal(
    LOWEST_PAID_PLAN,
    PAID_PLANS[prices.indexOf(Math.min(...prices))],
    "LOWEST_PAID_PLAN must be the genuinely cheapest paid tier, by price and not by position",
  );
});

// ── The free-trial phase (judge condition, writer L handoff) ──────────────

test("K: the trial end is computed from the VERIFIED trial_period_days", () => {
  const rec = activationRecordFromDodo(
    {
      metadata: { connect_token: "tok_t" },
      customer: { customer_id: "cus_t" },
      trial_period_days: 14,
    },
    null,
    "2026-08-01T00:00:00.000Z",
    { planForProductId: () => "companion" },
  );
  assert.equal(rec.trialEndsAt, "2026-08-15T00:00:00.000Z", "14 days from the subscription start");
  assert.equal(rec.status, "active", "A TRIAL IS ENTITLEMENT — status must NOT become 'trialing' here");
  assert.ok(LIVE_DODO_STATUS.has(rec.status), "writing 'trialing' into the record would lock every trialing customer out");
});

test("K: a renewal never re-issues the free trial", () => {
  // THE TRAP. trial_period_days describes the PLAN, so it rides along on later
  // events too. Recomputing from "now" would tell a customer in month nine that
  // their free trial is active — and would keep doing it forever.
  const base = {
    token: "tok_t",
    plan: "companion",
    status: "active",
    customerId: "cus_t",
    // DELIBERATELY NOT the 14-days-after-createdAt value. If the stored date
    // and the recomputed one agree, this assertion passes whether or not the
    // "existing value always wins" rule exists — a vacuous test that proves
    // nothing. Dodo granted this customer an extended trial; that fact must
    // survive, and only a stored value that CONTRADICTS the recompute can show
    // that it does.
    trialEndsAt: "2026-08-28T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
  };
  const rec = activationRecordFromDodo(
    { customer: { customer_id: "cus_t" }, trial_period_days: 14 },
    base,
    "2027-05-01T00:00:00.000Z",
    { planForProductId: () => "companion" },
  );
  assert.equal(rec.trialEndsAt, "2026-08-28T00:00:00.000Z", "set once at signup, never recomputed");

  // Even with no stored value, the window is anchored to the SIGNUP, so a late
  // event lands in the past and reads as "not trialing" rather than as a new trial.
  const noStored = trialFieldsFromDodo({ trial_period_days: 14 }, { createdAt: "2026-08-01T00:00:00.000Z" }, "2027-05-01T00:00:00.000Z");
  assert.equal(noStored.trialEndsAt, "2026-08-15T00:00:00.000Z");
});

test("K: no trial is invented when the event says nothing usable", () => {
  assert.deepEqual(trialFieldsFromDodo({}, null, "2026-08-01T00:00:00.000Z"), {});
  assert.deepEqual(trialFieldsFromDodo({ trial_period_days: 0 }, null, "2026-08-01T00:00:00.000Z"), {});
  assert.deepEqual(trialFieldsFromDodo({ trial_period_days: "14" }, null, "2026-08-01T00:00:00.000Z"), {}, "a string is not a day count");
  // An explicit provider date always beats one we compute.
  assert.equal(
    trialFieldsFromDodo({ trial_period_days: 14, trial_end: "2026-09-09T00:00:00Z" }, null, "2026-08-01T00:00:00.000Z").trialEndsAt,
    "2026-09-09T00:00:00Z",
  );
});

// ══════════════════════════════════════════════════════════════════════════
// WRITER P — THE ENGINE PUSH (gotchas#262, decisions#342 Q_B)
//
// What these prove, and why the shape is what it is. Every handler above this
// line only ever rewrote a record in OUR store. The assistant the customer
// actually talks to is a separate deployment that, at revocation time, never
// read it — so a refund flipped a KV blob and the customer kept their paid
// tier and their token credits indefinitely. The push is the wire that closes
// that, and it is the OPTIMISATION half of the ruling: the engine's
// per-message re-resolve and its reconciliation sweep are the correctness
// half. That is why the tests below care as much about what happens when the
// push FAILS as about what happens when it works — a push that can take the
// webhook down with it would be a worse bug than the one being fixed.
// ══════════════════════════════════════════════════════════════════════════

const enginePush = await loadRoute("src/lib/engine-push.ts");
const PUSH_URL = "http://127.0.0.1:8790/internal/billing/entitlement";
const PUSH_SECRET = "test-engine-push-secret";

/** Capture console.error for the duration of fn; returns everything logged. */
async function captureErrors(fn) {
  const lines = [];
  const real = console.error;
  console.error = (...a) => lines.push(a.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.error = real;
  }
  return lines.join("\n");
}

/** The push env, set explicitly: env() only clears its own MANAGED list. */
function pushEnv({ secret = PUSH_SECRET, base = null } = {}) {
  // Passing null means UNSET. Not undefined -- a destructuring default fires on
  // undefined, so an "unset the secret" call written that way would silently
  // hand back the configured secret and turn every unconfigured-push test into
  // a vacuous pass. It did exactly that once; hence null, and hence this note.
  if (!secret) delete process.env.MIRA_BILLING_PUSH_SECRET;
  else process.env.MIRA_BILLING_PUSH_SECRET = secret;
  if (!base) delete process.env.MIRA_ENGINE_URL;
  else process.env.MIRA_ENGINE_URL = base;
}

/** Every outbound call the harness recorded that was aimed at the engine. */
function pushCalls() {
  return netCalls.filter((c) => c.url.includes("/internal/billing/entitlement"));
}

// ── The table, not a parallel mapping ─────────────────────────────────────

test("P: every REVOKE row in the effect table has an engine wire name", () => {
  const revokeRows = Object.entries(DODO_EVENT_EFFECTS).filter(([, e]) => e.kind === "revoke");
  assert.ok(revokeRows.length >= 9, "sanity: the revoke rows are still here");
  for (const [type, effect] of revokeRows) {
    const wire = enginePush.engineEventForEffect(effect);
    assert.equal(
      typeof wire,
      "string",
      `${type} revokes access but has NO engine event name — it would revoke the web record and ` +
        "leave the assistant serving a customer who no longer pays",
    );
    assert.ok(wire.length > 0);
  }
});

test("P: the wire table is keyed on the effect table's OWN statuses, with no dead rows", () => {
  const statuses = new Set(
    Object.values(DODO_EVENT_EFFECTS)
      .filter((e) => e.kind === "revoke")
      .map((e) => e.status),
  );
  // Every status the policy can produce has a wire name...
  for (const s of statuses) {
    assert.ok(
      enginePush.ENGINE_REVOKE_EVENT_FOR_STATUS[s],
      `revoke status "${s}" has no engine event name`,
    );
  }
  // ...and no wire name exists for a status the policy never produces, which is
  // what stops this becoming a second, drifting policy table.
  for (const s of Object.keys(enginePush.ENGINE_REVOKE_EVENT_FOR_STATUS)) {
    assert.ok(statuses.has(s), `wire row "${s}" matches no revoke row in DODO_EVENT_EFFECTS`);
  }
});

test("P: restorations push too — a one-way revoke would be a new defect", () => {
  for (const type of ["dispute.won", "dunning.recovered", "subscription.unpaused", "dispute.cancelled"]) {
    assert.equal(
      enginePush.engineEventForEffect(dodoEventEffect(type)),
      enginePush.ENGINE_RESTORE_EVENT,
      `${type} means access comes BACK and must reach the engine`,
    );
  }
});

test("P: events that change nothing the customer can feel push NOTHING", () => {
  for (const type of [
    "dispute.opened",
    "dispute.challenged",
    "payment.failed",
    "dunning.started",
    "payment.processing",
    "payment.cancelled",
    "refund.failed",
    "subscription.update_payment_method",
    "subscription.active",
    "subscription.renewed",
    "payment.succeeded",
  ]) {
    assert.equal(
      enginePush.engineEventForEffect(dodoEventEffect(type)),
      null,
      `${type} must not push an access change`,
    );
  }
  assert.equal(enginePush.engineEventForEffect(null), null);
  assert.equal(enginePush.engineEventForEffect(undefined), null);
});

test("P: plan changes push the TIER-SHAPED verb, never an access change", () => {
  // Finding 1c: before ENGINE_REPRICE_EVENT existed, a paid upgrade never
  // reached the engine at all. It now pushes entitlement.repriced, which the
  // engine applies to tier/credits only - the access gate is untouched, so
  // this push can never re-open a cancelled record.
  for (const type of ["subscription.plan_changed", "subscription.updated"]) {
    assert.equal(
      enginePush.engineEventForEffect(dodoEventEffect(type)),
      enginePush.ENGINE_REPRICE_EVENT,
      `${type} must push the reprice verb`,
    );
  }
});

// ── eventAt: the provider's clock, never ours ─────────────────────────────

test("P: eventAt is the PROVIDER's emission time, as ISO — never Date.now()", () => {
  // The Standard-Webhooks header is UNIX SECONDS. Passed through as a number it
  // would be read as MILLISECONDS by the engine, dating every push to 1970 and
  // making the very next real event look stale forever.
  const seconds = 1787000000;
  const iso = enginePush.engineEventAtIso(undefined, String(seconds));
  assert.equal(iso, new Date(seconds * 1000).toISOString());
  assert.ok(new Date(iso).getUTCFullYear() > 2020, "seconds must not be read as milliseconds");
  // Nowhere near our own clock, which is the whole point.
  assert.ok(Math.abs(Date.parse(iso) - Date.now()) > 1000, "eventAt must not be now");
});

test("P: the event envelope's own timestamp wins over the header", () => {
  const envelope = "2026-08-20T10:00:00.000Z";
  assert.equal(
    enginePush.engineEventAtIso(envelope, String(Math.floor(Date.now() / 1000))),
    envelope,
  );
  // Milliseconds are recognised as milliseconds.
  assert.equal(enginePush.engineEventAtIso(1787000000000, null), new Date(1787000000000).toISOString());
  // And nonsense yields NOTHING rather than a fabricated stamp.
  assert.equal(enginePush.engineEventAtIso({}, "not-a-time"), undefined);
  assert.equal(enginePush.engineEventAtIso(undefined, undefined), undefined);
});

// ── The client: unconfigured, unreachable, slow, rejected ─────────────────

test("P: with no MIRA_BILLING_PUSH_SECRET nothing is sent, and it says so LOUDLY", async () => {
  pushEnv({ secret: null });
  // Fresh module so the once-a-minute throttle cannot swallow the line.
  const fresh = await loadRoute("src/lib/engine-push.ts", { fresh: true });
  let called = 0;
  const log = await captureErrors(async () => {
    const r = await fresh.pushEntitlementToEngine(
      { telegramId: 42, event: "refund.succeeded", context: "refund.succeeded" },
      { fetchImpl: async () => { called++; return new Response("{}", { status: 200 }); } },
    );
    assert.equal(r.pushed, false);
    assert.equal(r.reason, "disabled_no_secret");
  });
  assert.equal(called, 0, "an unconfigured push must not even open a connection");
  assert.match(log, /PUSH LAYER DISABLED/);
  assert.match(log, /MIRA_BILLING_PUSH_SECRET/);
  // The operator must be told the consequence, not just the fact: revocation is
  // SLOWER, not absent. Silence here is what created gotchas#262.
  assert.match(log, /re-resolve/i);
  assert.match(log, /reconciliation/i);
});

test("P: a configured push sends the engine's contract, with the secret in the HEADER only", async () => {
  pushEnv();
  let seen = null;
  const r = await enginePush.pushEntitlementToEngine(
    {
      telegramId: 987654,
      event: "refund.succeeded",
      eventId: "evt_abc",
      eventAt: "2026-08-20T10:00:00.000Z",
      context: "refund.succeeded",
    },
    {
      fetchImpl: async (url, init) => {
        seen = { url, init };
        return new Response(JSON.stringify({ ok: true, applied: true }), { status: 200 });
      },
    },
  );
  assert.equal(r.pushed, true);
  assert.equal(seen.url, PUSH_URL, "loopback default, the engine's documented bind");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers.Authorization, `Bearer ${PUSH_SECRET}`);
  const body = JSON.parse(seen.init.body);
  assert.deepEqual(body, {
    event: "refund.succeeded",
    telegramId: 987654,
    eventId: "evt_abc",
    eventAt: "2026-08-20T10:00:00.000Z",
  });
  // The secret is in the header and NOWHERE else — not the URL, not the body.
  assert.ok(!seen.url.includes(PUSH_SECRET));
  assert.ok(!seen.init.body.includes(PUSH_SECRET));
  // And the call carries a deadline rather than hanging inside a webhook.
  assert.ok(seen.init.signal, "an unbounded network call in the request path is the other bug");
});

test("P: MIRA_ENGINE_URL overrides the loopback default (the two halves are not one host)", async () => {
  pushEnv({ base: "http://127.0.0.1:18790/" });
  let url = null;
  await enginePush.pushEntitlementToEngine(
    { telegramId: 1, event: "refund.succeeded" },
    { fetchImpl: async (u) => { url = u; return new Response("{}", { status: 200 }); } },
  );
  assert.equal(url, "http://127.0.0.1:18790/internal/billing/entitlement");
  // A pasted full endpoint is tolerated rather than doubled into a 404.
  pushEnv({ base: PUSH_URL });
  await enginePush.pushEntitlementToEngine(
    { telegramId: 1, event: "refund.succeeded" },
    { fetchImpl: async (u) => { url = u; return new Response("{}", { status: 200 }); } },
  );
  assert.equal(url, PUSH_URL);
  pushEnv();
});

test("P: an unreachable engine NEVER throws — a throw is a Dodo retry into a paying customer", async () => {
  pushEnv();
  const log = await captureErrors(async () => {
    const r = await enginePush.pushEntitlementToEngine(
      { telegramId: 5, event: "refund.succeeded", context: "refund.succeeded" },
      { fetchImpl: async () => { throw new Error("ECONNREFUSED 127.0.0.1:8790"); } },
    );
    assert.equal(r.pushed, false);
    assert.equal(r.reason, "unreachable");
  });
  // The log has to tell whoever reads it that access still converges.
  assert.match(log, /re-resolve/i);
  assert.match(log, /DELAY/);
});

test("P: a push that hangs is abandoned on a deadline, and still never throws", async () => {
  pushEnv();
  const r = await captureErrors(async () => {
    const out = await enginePush.pushEntitlementToEngine(
      { telegramId: 6, event: "refund.succeeded" },
      {
        timeoutMs: 5,
        fetchImpl: (url, init) =>
          new Promise((_, reject) => {
            init.signal.addEventListener("abort", () => reject(new Error("The operation was aborted")));
          }),
      },
    );
    assert.equal(out.pushed, false);
    assert.equal(out.reason, "timeout");
  });
  assert.match(r, /no answer within 5ms/);
});

test("P: a 401 from the engine is reported, not thrown, and names the cause", async () => {
  pushEnv();
  const log = await captureErrors(async () => {
    const r = await enginePush.pushEntitlementToEngine(
      { telegramId: 7, event: "refund.succeeded" },
      { fetchImpl: async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }) },
    );
    assert.equal(r.pushed, false);
    assert.equal(r.reason, "http_error");
    assert.equal(r.status, 401);
  });
  assert.match(log, /different MIRA_BILLING_PUSH_SECRET values/);
});

test("P: with no identity NOTHING is sent and no identifier is invented", async () => {
  pushEnv();
  let called = 0;
  const log = await captureErrors(async () => {
    const r = await enginePush.pushEntitlementToEngine(
      { event: "refund.succeeded", context: "refund.succeeded" },
      { fetchImpl: async () => { called++; return new Response("{}", { status: 200 }); } },
    );
    assert.equal(r.pushed, false);
    assert.equal(r.reason, "no_identity");
  });
  assert.equal(called, 0);
  assert.match(log, /no tenantId and no telegramId/);
});

// ── THE REAL ROUTE: the counterfactual that matters ───────────────────────

/** Sign and POST a real Dodo event, at a chosen provider timestamp. */
async function postEventAt(id, type, data, tsSeconds) {
  const body = JSON.stringify({ type, data });
  const ts = String(tsSeconds);
  const req = new Request("https://mira.vualet.com/api/webhooks/dodo", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": ts,
      "webhook-signature": sign(id, ts, body),
    },
    body,
  });
  return readJson(await dodoRoute.POST(req));
}

/** A bound, paying customer in the REAL store. */
async function seedBound(store, customerId, { telegramId = 5551234, token, plan = "studio" } = {}) {
  const rec = {
    token: token ?? `tok_${customerId}`,
    plan,
    status: "active",
    provider: "dodo",
    customerId,
    subscriptionId: `sub_${customerId}`,
    createdAt: "2026-08-01T00:00:00.000Z",
  };
  if (telegramId != null) rec.telegramId = telegramId;
  await store.putSubscription(customerId, rec);
  return rec;
}

test("P: COUNTERFACTUAL — refund.succeeded PUSHES the revocation to the engine", async () => {
  env({});
  process.env.DODO_WEBHOOK_SECRET = SECRET;
  pushEnv();
  resetNet();
  const store = await loadRoute("src/lib/store.ts");
  await seedBound(store, "cus_P_refund", { telegramId: 777001 });

  // A provider stamp two minutes old: inside the signature tolerance, and far
  // enough from our own clock that "eventAt is the provider's time" is a claim
  // this test can actually check.
  const emitted = Math.floor(Date.now() / 1000) - 120;

  // The push fetch is NOT scripted, so the harness blocks it and the client
  // sees a network failure. That is deliberate: this test proves the push is
  // ATTEMPTED, and the next one proves the failure is survivable.
  const res = await captureErrors(() =>
    postEventAt("evt_P_refund", "refund.succeeded", {
      refund_id: "ref_P1",
      payment_id: "pay_P1",
      customer: { customer_id: "cus_P_refund" },
    }, emitted),
  );

  const calls = pushCalls();
  assert.equal(calls.length, 1, "BEFORE THIS FIX THERE WERE ZERO: the refund never reached the engine");
  assert.equal(calls[0].url, PUSH_URL);
  assert.equal(calls[0].method, "POST");
  const sent = JSON.parse(calls[0].body);
  assert.equal(sent.event, "refund.succeeded");
  assert.equal(sent.telegramId, 777001, "the identity came from the store, not from a guess");
  assert.equal(sent.eventId, "evt_P_refund", "convergence: a replay must be recognisable");
  assert.equal(sent.eventAt, new Date(emitted * 1000).toISOString(), "ordering: the PROVIDER's clock");
  assert.ok(!("tenantId" in sent), "this app holds no tenantId and must not invent one");
  assert.ok(!JSON.stringify(sent).includes(PUSH_SECRET), "the secret never travels in the body");
  // And the local record is revoked regardless of what the engine did.
  const rec = await store.getSubscription("cus_P_refund");
  assert.equal(rec.status, "refunded");
  assert.ok(!LIVE_DODO_STATUS.has(rec.status));
  assert.ok(res.length >= 0);
});

test("P: a push FAILURE does not fail the webhook — Dodo is still answered received:true", async () => {
  env({});
  process.env.DODO_WEBHOOK_SECRET = SECRET;
  pushEnv();
  resetNet();
  const store = await loadRoute("src/lib/store.ts");
  await seedBound(store, "cus_P_fail", { telegramId: 777002 });

  // The engine is DOWN: every outbound call explodes.
  scriptFetch(async () => { throw new Error("ECONNREFUSED 127.0.0.1:8790"); });
  let out;
  const log = await captureErrors(async () => {
    out = await postEventAt("evt_P_fail", "refund.succeeded", {
      refund_id: "ref_P2",
      payment_id: "pay_P2",
      customer: { customer_id: "cus_P_fail" },
    }, Math.floor(Date.now() / 1000));
  });

  assert.equal(out.status, 200, "a 500 here is a redelivery loop aimed at a customer, forever");
  assert.deepEqual(out.body, { received: true });
  assert.equal(pushCalls().length, 1, "it was attempted");
  // The customer is still revoked locally, so the engine's own re-resolve and
  // reconciliation sweep will converge on the same answer.
  const rec = await store.getSubscription("cus_P_fail");
  assert.equal(rec.status, "refunded");
  assert.match(log, /could not reach the engine/);
  assert.match(log, /reconciliation sweep/);
});

test("P: a replayed refund is pushed AGAIN — that is the repair path, not a double revoke", async () => {
  env({});
  process.env.DODO_WEBHOOK_SECRET = SECRET;
  pushEnv();
  resetNet();
  const store = await loadRoute("src/lib/store.ts");
  await seedBound(store, "cus_P_replay", { telegramId: 777003 });
  const ts = Math.floor(Date.now() / 1000);

  await captureErrors(() =>
    postEventAt("evt_P_replay_a", "refund.succeeded", {
      refund_id: "ref_P3", payment_id: "pay_P3", customer: { customer_id: "cus_P_replay" },
    }, ts),
  );
  // A different webhook-id (Dodo re-emitting the same fact) with the record
  // already refunded: the local write is a no-op, but the push must still go,
  // because the FIRST push may well be the one that failed.
  resetNet();
  await captureErrors(() =>
    postEventAt("evt_P_replay_b", "refund.succeeded", {
      refund_id: "ref_P3", payment_id: "pay_P3", customer: { customer_id: "cus_P_replay" },
    }, ts + 1),
  );
  assert.equal(pushCalls().length, 1, "an already-refunded record still re-pushes; the engine is convergent");
});

test("P: dispute.won pushes the RESTORE, carrying the plan, so access really comes back", async () => {
  env({});
  process.env.DODO_WEBHOOK_SECRET = SECRET;
  pushEnv();
  resetNet();
  const store = await loadRoute("src/lib/store.ts");
  await seedBound(store, "cus_P_won", { telegramId: 777004, plan: "assistant" });

  // Lose it first, so there is a chargeback for the win to lift.
  await captureErrors(() =>
    postEventAt("evt_P_lost", "dispute.lost", {
      dispute_id: "dis_P", payment_id: "pay_P4", customer: { customer_id: "cus_P_won" },
    }, Math.floor(Date.now() / 1000)),
  );
  let sent = JSON.parse(pushCalls()[0].body);
  assert.equal(sent.event, "chargeback", "a lost dispute revokes in the engine's own vocabulary");

  resetNet();
  await captureErrors(() =>
    postEventAt("evt_P_won", "dispute.won", {
      dispute_id: "dis_P", payment_id: "pay_P4", customer: { customer_id: "cus_P_won" },
    }, Math.floor(Date.now() / 1000)),
  );
  assert.equal(pushCalls().length, 1, "a one-way revoke would leave a customer who WON locked out");
  sent = JSON.parse(pushCalls()[0].body);
  assert.equal(sent.event, enginePush.ENGINE_RESTORE_EVENT);
  assert.equal(sent.plan, "assistant", "without the plan the engine restores status but not the tier");
  const rec = await store.getSubscription("cus_P_won");
  assert.equal(rec.status, "active");
});

test("P: a restore the core REFUSED is never pushed", async () => {
  env({});
  process.env.DODO_WEBHOOK_SECRET = SECRET;
  pushEnv();
  resetNet();
  const store = await loadRoute("src/lib/store.ts");
  await seedBound(store, "cus_P_refused", { telegramId: 777005 });
  await captureErrors(() =>
    postEventAt("evt_P_ref1", "refund.succeeded", {
      refund_id: "ref_P5", payment_id: "pay_P5", customer: { customer_id: "cus_P_refused" },
    }, Math.floor(Date.now() / 1000)),
  );
  resetNet();
  // dunning.recovered may lift "on_hold" and NOTHING else. Against a refunded
  // record the core refuses — and pushing anyway would hand a refunded customer
  // their assistant back, which is this whole bug in reverse.
  await captureErrors(() =>
    postEventAt("evt_P_ref2", "dunning.recovered", {
      subscription_id: "sub_cus_P_refused", customer: { customer_id: "cus_P_refused" },
    }, Math.floor(Date.now() / 1000)),
  );
  assert.equal(pushCalls().length, 0, "the push must never contradict our own refusal");
  const rec = await store.getSubscription("cus_P_refused");
  assert.equal(rec.status, "refunded");
});

test("P: an OPEN dispute pushes nothing — access was never interrupted", async () => {
  env({});
  process.env.DODO_WEBHOOK_SECRET = SECRET;
  pushEnv();
  resetNet();
  const store = await loadRoute("src/lib/store.ts");
  await seedBound(store, "cus_P_open", { telegramId: 777006 });
  await captureErrors(() =>
    postEventAt("evt_P_open", "dispute.opened", {
      dispute_id: "dis_open", payment_id: "pay_P6", customer: { customer_id: "cus_P_open" },
    }, Math.floor(Date.now() / 1000)),
  );
  assert.equal(pushCalls().length, 0, "a flag is not an access change");
  const rec = await store.getSubscription("cus_P_open");
  assert.equal(rec.status, "active");
  assert.equal(rec.disputed, true);
});

test("P: the connect record supplies the telegramId when the subscription record has none", async () => {
  env({});
  process.env.DODO_WEBHOOK_SECRET = SECRET;
  pushEnv();
  resetNet();
  const store = await loadRoute("src/lib/store.ts");
  // claimConnect writes the bind onto the CONNECT record only, so a customer
  // who paid first and bound afterwards has a subscription record with no
  // telegramId on it at all. Falling straight to "skip" here would silently
  // exempt exactly the customers who did things in the normal order.
  const rec = await seedBound(store, "cus_P_connect", { telegramId: null, token: "tok_P_connect" });
  await store.putConnect({ ...rec, telegramId: 777007 });

  await captureErrors(() =>
    postEventAt("evt_P_connect", "refund.succeeded", {
      refund_id: "ref_P7", payment_id: "pay_P7", customer: { customer_id: "cus_P_connect" },
    }, Math.floor(Date.now() / 1000)),
  );
  assert.equal(pushCalls().length, 1);
  assert.equal(JSON.parse(pushCalls()[0].body).telegramId, 777007);
});

test("P: an UNBOUND customer is skipped loudly — never pushed with a fabricated id", async () => {
  env({});
  process.env.DODO_WEBHOOK_SECRET = SECRET;
  pushEnv();
  resetNet();
  const store = await loadRoute("src/lib/store.ts");
  await seedBound(store, "cus_P_unbound", { telegramId: null, token: "tok_P_unbound_missing" });

  let out;
  const log = await captureErrors(async () => {
    out = await postEventAt("evt_P_unbound", "refund.succeeded", {
      refund_id: "ref_P8", payment_id: "pay_P8", customer: { customer_id: "cus_P_unbound" },
    }, Math.floor(Date.now() / 1000));
  });
  assert.equal(out.status, 200);
  assert.equal(pushCalls().length, 0, "no identity means no push, never an invented one");
  assert.match(log, /NO telegramId/);
  // Still revoked locally, so the reconciliation sweep remains able to fix it.
  assert.equal((await store.getSubscription("cus_P_unbound")).status, "refunded");
});

test("P: with the push layer unconfigured the webhook still works, and says why", async () => {
  env({});
  process.env.DODO_WEBHOOK_SECRET = SECRET;
  pushEnv({ secret: null });
  resetNet();
  const store = await loadRoute("src/lib/store.ts");
  await seedBound(store, "cus_P_nosecret", { telegramId: 777009 });
  let out;
  await captureErrors(async () => {
    out = await postEventAt("evt_P_nosecret", "refund.succeeded", {
      refund_id: "ref_P9", payment_id: "pay_P9", customer: { customer_id: "cus_P_nosecret" },
    }, Math.floor(Date.now() / 1000));
  });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { received: true });
  assert.equal(pushCalls().length, 0, "the engine 401s every caller until the secret is set on both sides");
  assert.equal((await store.getSubscription("cus_P_nosecret")).status, "refunded");
  pushEnv();
});

// ── UNIT 1: DODO FAN-OUT OWNERSHIP GUARD ────────────────────────────────────
// A second product (FileHub) now shares this Dodo merchant account. Dodo fans
// every event out to every endpoint and signs each with THAT endpoint's own
// secret, so a FileHub event reaches this endpoint with a VALID signature. A
// valid signature proves the sender is Dodo; it does NOT prove the event is
// ours. These tests pin that distinction.

test("OWNERSHIP: a MIRA product event still grants, exactly once", async () => {
  env({
    DODO_API_KEY: "dodo_test_key",
    DODO_MODE: "test",
    DODO_PRODUCT_COMPANION: "prod_c",
    DODO_PRODUCT_ASSISTANT: "prod_a",
    DODO_PRODUCT_STUDIO: "prod_s",
  });
  process.env.DODO_WEBHOOK_SECRET = SECRET;
  resetNet();
  const store = await loadRoute("src/lib/store.ts");

  const res = await postEvent("evt_own_mira_grant", "subscription.active", {
    customer: { customer_id: "cus_own_mira", email: "mira@example.com" },
    subscription_id: "sub_own_mira",
    product_id: "prod_s",
  });
  assert.equal(res.status, 200, "webhook should answer 200");

  const record = await store.getSubscription("cus_own_mira");
  assert.equal(record.plan, "studio", "mira event should grant the studio plan");
  assert.equal(record.provider, "dodo", "grant should be recorded against dodo");
});

test("OWNERSHIP: a FILEHUB event grants NOTHING even though its signature is valid", async () => {
  env({
    DODO_API_KEY: "dodo_test_key",
    DODO_MODE: "test",
    DODO_PRODUCT_COMPANION: "prod_c",
    DODO_PRODUCT_ASSISTANT: "prod_a",
    DODO_PRODUCT_STUDIO: "prod_s",
  });
  process.env.DODO_WEBHOOK_SECRET = SECRET;
  resetNet();
  const store = await loadRoute("src/lib/store.ts");

  const res = await postEvent("evt_own_foreign_grant", "subscription.active", {
    customer: { customer_id: "cus_own_foreign", email: "foreign@example.com" },
    subscription_id: "sub_own_foreign",
    product_id: "prod_filehub_pro",
  });
  // 200 is correct and deliberate: the event was genuinely received and must
  // not be retried forever - the point is that it granted nothing.
  assert.equal(res.status, 200, "foreign event should still answer 200");

  const record = await store.getSubscription("cus_own_foreign");
  assert.ok(!record, "a FileHub sale must never mint a Mira subscription");
});

test("OWNERSHIP: a FILEHUB event on a COLLIDING customer cannot touch an existing Mira subscription", async () => {
  env({
    DODO_API_KEY: "dodo_test_key",
    DODO_MODE: "test",
    DODO_PRODUCT_COMPANION: "prod_c",
    DODO_PRODUCT_ASSISTANT: "prod_a",
    DODO_PRODUCT_STUDIO: "prod_s",
  });
  process.env.DODO_WEBHOOK_SECRET = SECRET;
  resetNet();
  const store = await loadRoute("src/lib/store.ts");

  const grant = await postEvent("evt_own_collide_mira", "subscription.active", {
    customer: { customer_id: "cus_collide", email: "collide@example.com" },
    subscription_id: "sub_collide",
    product_id: "prod_c",
  });
  assert.equal(grant.status, 200, "mira grant should answer 200");

  const before = await store.getSubscription("cus_collide");
  assert.equal(before.plan, "companion", "mira event should grant the companion plan");

  const foreign = await postEvent("evt_own_collide_filehub", "subscription.active", {
    customer: { customer_id: "cus_collide", email: "collide@example.com" },
    subscription_id: "sub_filehub",
    product_id: "prod_filehub_pro",
  });
  assert.equal(foreign.status, 200, "foreign event should still answer 200");

  // Without the guard this foreign event would have rewritten this real
  // customer's subscription record.
  const after = await store.getSubscription("cus_collide");
  assert.equal(after.plan, "companion", "foreign event must not change the plan");
  // deepEqual against the record captured before the foreign event also proves
  // the stored subscription id was not overwritten by "sub_filehub".
  assert.deepEqual(after, before, "foreign event must not overwrite the stored record");
});

test("OWNERSHIP: replaying the same MIRA event does not grant twice", async () => {
  env({
    DODO_API_KEY: "dodo_test_key",
    DODO_MODE: "test",
    DODO_PRODUCT_COMPANION: "prod_c",
    DODO_PRODUCT_ASSISTANT: "prod_a",
    DODO_PRODUCT_STUDIO: "prod_s",
  });
  process.env.DODO_WEBHOOK_SECRET = SECRET;
  resetNet();
  const store = await loadRoute("src/lib/store.ts");

  const data = {
    customer: { customer_id: "cus_own_replay", email: "replay@example.com" },
    subscription_id: "sub_own_replay",
    product_id: "prod_s",
  };

  const first = await postEvent("evt_own_replay", "subscription.active", data);
  assert.equal(first.status, 200, "first delivery should answer 200");
  const afterFirst = await store.getSubscription("cus_own_replay");
  assert.equal(afterFirst.plan, "studio", "first delivery should grant studio");

  // The guard must not have disturbed the existing idempotency behaviour.
  const second = await postEvent("evt_own_replay", "subscription.active", data);
  assert.equal(second.status, 200, "replayed delivery should still answer 200");
  const afterSecond = await store.getSubscription("cus_own_replay");
  assert.equal(afterSecond.plan, "studio", "replayed delivery should keep the studio plan");
  assert.deepEqual(afterSecond, afterFirst, "replay must not change the stored record");
});

test("OWNERSHIP: the predicate FAILS CLOSED on every unproven shape", () => {
  const planForProductId = (id) => (id === "prod_s" ? "studio" : null);

  const owned = dodoEventIsMiraOwned({ product_id: "prod_s" }, { planForProductId });
  assert.equal(owned.owned, true, "allowlisted product should be owned");
  assert.equal(owned.reason, "owned", "allowlisted product should report owned");
  assert.equal(owned.productId, "prod_s", "product id should be carried back");

  const foreign = dodoEventIsMiraOwned({ product_id: "prod_filehub_pro" }, { planForProductId });
  assert.equal(foreign.owned, false, "unlisted product must not be owned");
  assert.equal(foreign.reason, "foreign_product", "unlisted product should report foreign_product");
  assert.equal(foreign.productId, "prod_filehub_pro", "product id should be carried back");

  const noProduct = dodoEventIsMiraOwned({ customer: { customer_id: "cus_noprod" } }, { planForProductId });
  assert.equal(noProduct.owned, false, "payload without a product must not be owned");
  assert.equal(noProduct.reason, "no_product_id", "missing product should report no_product_id");
  assert.equal(noProduct.productId, undefined, "no product id should be carried back");

  const noResolver = dodoEventIsMiraOwned({ product_id: "prod_s" }, {});
  assert.equal(noResolver.owned, false, "missing resolver must not be owned");
  assert.equal(noResolver.reason, "no_resolver", "missing resolver should report no_resolver");
  assert.equal(noResolver.productId, "prod_s", "product id should be carried back");
});

test("OWNERSHIP: a throwing resolver is not owned and does not throw", () => {
  // A throw here would become a webhook Dodo retries forever.
  const deps = {
    planForProductId: () => {
      throw new Error("boom");
    },
  };
  let result;
  assert.doesNotThrow(() => {
    result = dodoEventIsMiraOwned({ product_id: "prod_s" }, deps);
  }, "guard must not throw");
  assert.equal(result.owned, false, "throwing resolver must not be owned");
});
