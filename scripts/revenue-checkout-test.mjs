/**
 * /api/checkout — behavioural tests against the REAL route handler.
 *
 * Unlike the source-scanning style of scripts/checkout-email-test.mjs, these
 * import src/app/api/checkout/route.ts and call POST() with real Request
 * objects, so they exercise the actual control flow, the actual store writes,
 * and the actual promo pricing logic. The only faked things are the Stripe npm
 * SDK and global fetch (see scripts/route-harness/), both of which are asserted
 * on directly as evidence that no charge was attempted.
 *
 * Run: npm run test:checkout-route
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  loadRoute, jsonRequest, readJson, env, netCalls, resetNet, scriptFetch,
} from "./route-harness/index.mjs";
import * as stripeStub from "./route-harness/stubs/stripe-sdk.mjs";

const { POST } = await loadRoute("src/app/api/checkout/route.ts");
const store = await loadRoute("src/lib/store.ts");

/** Fully arm the Dodo money path with DUMMY values — never real credentials. */
const DODO_ARMED = {
  DODO_API_KEY: "dummy_dodo_key_not_real",
  DODO_PAYMENTS_LIVE: "1",
  DODO_PRODUCT_COMPANION: "prod_dummy_companion",
  DODO_PRODUCT_ASSISTANT: "prod_dummy_assistant",
  DODO_PRODUCT_STUDIO: "prod_dummy_studio",
};

/** Dummy Stripe config so promo.ts can construct a client + price a plan. */
const STRIPE_ARMED = {
  STRIPE_SECRET_KEY: "sk_test_dummy_not_real",
  STRIPE_PRICE_COMPANION: "price_dummy_companion",
  STRIPE_PRICE_ASSISTANT: "price_dummy_assistant",
  STRIPE_PRICE_STUDIO: "price_dummy_studio",
};

// ── The binding parameters every paid order now carries ────────────────────
// gotchas#256: /api/checkout used to take no phone, no channel and no consent,
// so a customer could pay and end up on a record that could never be bound to
// WhatsApp. It now requires all three on the (default) WhatsApp channel.
//
// WHY THE DEFAULT BODY CARRIES THEM — same reasoning writer B recorded in
// revenue-begin-ratelimit-test.mjs: a body of { plan, email } alone is now a
// 400, so every email/promo test above would stop testing email and promo and
// start testing the binding gate instead. BOUND is therefore the smallest body
// that SUCCEEDS, and the gate itself is tested explicitly in section (e).

// Deliberately NOT already E.164, so "is it stored normalised?" is a real
// question rather than a tautology.
const RAW_PHONE = "050 123 4567";
const RAW_PHONE_E164 = "+971501234567";

/** A LEGACY three-box form, exactly as the pre-r2 wizard sent it. specs#160r2
 *  requires only `banRisk`; this stays in its old shape on purpose, as the
 *  standing proof that an old client is still accepted and its extra scopes are
 *  PRESERVED rather than dropped. The optional scope is left alone. */
const CONSENT_OK = {
  unofficialAutomation: true,
  banRisk: true,
  ownAccountReplies: true,
};

const BOUND = { channel: "whatsapp", phone: RAW_PHONE, consent: CONSENT_OK };

/** A request that is bound by default; per-test keys override BOUND. */
const post = (body) => POST(jsonRequest({ ...BOUND, ...body })).then(readJson);

/** A request with EXACTLY the given body — nothing merged in. Used by the
 *  binding-gate tests, which are about what happens when a field is absent. */
const postExact = (body) => POST(jsonRequest(body)).then(readJson);

beforeEach(() => {
  env();
  resetNet();
  stripeStub.reset();
});

// ── (a) email guard ────────────────────────────────────────────────────────

test("a: MISSING email is rejected 400 email_required, and nothing is charged", async () => {
  for (const email of [undefined, null, "", "   "]) {
    env(DODO_ARMED); // money path fully armed: only the guard can stop this
    const { status, body } = await post({ plan: "companion", email });
    assert.equal(status, 400, `email=${JSON.stringify(email)} must be 400`);
    assert.equal(body.error, "email_required");
  }
  assert.equal(netCalls.length, 0, "no outbound call may be made without an email");
});

test("a: MALFORMED email is rejected 400 email_required", async () => {
  const bad = [
    "notanemail", "@example.com", "user@", "user@localhost",
    "user @example.com", "user@exa mple.com", "two@@example.com", "user@example.",
  ];
  for (const email of bad) {
    env(DODO_ARMED);
    const { status, body } = await post({ plan: "companion", email });
    assert.equal(status, 400, `email=${JSON.stringify(email)} must be 400`);
    assert.equal(body.error, "email_required");
  }
  assert.equal(netCalls.length, 0, "no outbound call for any malformed address");
});

test("a: an email OVER 200 chars is rejected 400 (201 rejected, 200 accepted)", async () => {
  env(DODO_ARMED);
  const over = "a".repeat(189) + "@example.com"; // 201 chars
  assert.equal(over.length, 201);
  const res = await post({ plan: "companion", email: over });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "email_required");
  assert.equal(netCalls.length, 0, "an over-long address must never reach the provider");

  // Boundary control: exactly 200 chars is NOT rejected by the email guard —
  // proves the test measures the 200 bound, not merely "long strings".
  env(); // dodo deliberately unconfigured
  const at = "a".repeat(188) + "@example.com"; // 200 chars
  assert.equal(at.length, 200);
  const ok = await post({ plan: "companion", email: at });
  assert.notEqual(ok.body.error, "email_required", "200 chars must pass the email guard");
});

test("a: valid email + NO promo + Dodo unconfigured -> fail-safe 503 coming-soon, NOT a 500", async () => {
  env(); // no DODO_API_KEY, no DODO_PAYMENTS_LIVE
  const { status, body } = await post({ plan: "companion", email: "buyer@example.com" });
  assert.equal(status, 503, "unconfigured payments must be a soft 503, never a 5xx crash");
  assert.notEqual(status, 500);
  assert.equal(body.error, "not_configured");
  assert.match(body.message, /switched on/i);
  assert.equal(netCalls.length, 0);
});

test("a: an unknown plan is rejected 400 before anything else", async () => {
  env(DODO_ARMED);
  const { status } = await post({ plan: "enterprise", email: "buyer@example.com" });
  assert.equal(status, 400);
  assert.equal(netCalls.length, 0);
});

test("a: POSITIVE CONTROL — valid email + armed Dodo DOES reach the provider, with cleanEmail", async () => {
  env(DODO_ARMED);
  scriptFetch(async () => new Response(
    JSON.stringify({ payment_link: "https://pay.dodo.test/abc" }),
    { status: 200, headers: { "content-type": "application/json" } },
  ));
  const { status, body } = await post({ plan: "companion", email: "  buyer@example.com  " });
  assert.equal(status, 200);
  assert.equal(body.url, "https://pay.dodo.test/abc");
  assert.equal(netCalls.length, 1, "exactly one provider call on the happy path");
  const sent = JSON.parse(netCalls[0].body);
  assert.equal(sent.customer.email, "buyer@example.com", "the TRIMMED email must be sent");
  assert.notEqual(sent.customer.email, "guest@vualet.com", "never the shared guest identity");
});

// ── (b) promotion codes ────────────────────────────────────────────────────

test("b: promoCode with PROMO_CODES_ENABLED UNSET -> 503 promo_unavailable, no charge", async () => {
  env({ ...DODO_ARMED, ...STRIPE_ARMED }); // both providers armed; only the kill switch is off
  const { status, body } = await post({
    plan: "companion", email: "buyer@example.com", promoCode: "FREEBIE",
  });
  assert.equal(status, 503);
  assert.equal(body.error, "promo_unavailable");
  assert.equal(netCalls.length, 0, "kill switch must stop the request before any provider call");
  assert.equal(stripeStub.calls.length, 0, "promo validation must not even reach Stripe");
});

test("b: only the exact string 1 opens the promo kill switch", async () => {
  for (const v of ["0", "true", "yes", "", " 1"]) {
    env({ ...DODO_ARMED, ...STRIPE_ARMED, PROMO_CODES_ENABLED: v });
    const { status, body } = await post({
      plan: "companion", email: "b@example.com", promoCode: "FREEBIE",
    });
    assert.equal(status, 503, `PROMO_CODES_ENABLED=${JSON.stringify(v)} must stay closed`);
    assert.equal(body.error, "promo_unavailable");
  }
  assert.equal(netCalls.length, 0);
});

test("b: 100%-off code -> NO Dodo call at all, connect record written, zeroCharge true", async () => {
  env({ ...DODO_ARMED, ...STRIPE_ARMED, PROMO_CODES_ENABLED: "1" });
  // Dodo is fully armed above, so if the route did NOT short-circuit it WOULD
  // charge. A zero netCalls count is therefore real evidence, not a vacuum.
  stripeStub.config.promotionCodes = {
    data: [{ id: "promo_100", code: "FREEBIE", active: true, coupon: { percent_off: 100, valid: true } }],
  };
  stripeStub.config.price = { unit_amount: 1499, currency: "usd" };

  const { status, body } = await post({
    plan: "companion", email: "freeuser@example.com", promoCode: "freebie", persona: "warm",
  });

  assert.equal(status, 200);
  assert.equal(body.zeroCharge, true, "the response must declare the zero-charge activation");
  assert.equal(body.url, null, "there must be no payment link to send the customer to");
  assert.ok(body.token, "a connect token must be minted");
  assert.equal(body.plan, "companion");

  assert.equal(netCalls.length, 0, "THE POINT: a 100%-off order must never call Dodo");

  // The connect record really exists in the store, and is ACTIVE (not pending).
  const rec = await store.getConnect(body.token);
  assert.ok(rec, "a connect record must be persisted");
  assert.equal(rec.status, "active", "a 100%-off order is already paid — status must be active");
  assert.equal(rec.email, "freeuser@example.com");
  assert.equal(rec.plan, "companion");
  assert.equal(rec.persona, "warm");

  // The code was validated SERVER-side against Stripe, not trusted from the body.
  const methods = stripeStub.calls.map((c) => c.method);
  assert.ok(methods.includes("promotionCodes.list"), "the code must be looked up server-side");
  assert.ok(methods.includes("prices.retrieve"), "the price must come from the server, not the browser");
  const listArgs = stripeStub.calls.find((c) => c.method === "promotionCodes.list").args[0];
  assert.equal(listArgs.code, "FREEBIE", "the code must be normalised to upper case before lookup");
});

test("b: PARTIAL discount -> 409 partial_discount_unsupported and NO charge", async () => {
  env({ ...DODO_ARMED, ...STRIPE_ARMED, PROMO_CODES_ENABLED: "1" });
  stripeStub.config.promotionCodes = {
    data: [{ id: "promo_30", code: "SAVE30", active: true, coupon: { percent_off: 30, valid: true } }],
  };
  stripeStub.config.price = { unit_amount: 1499, currency: "usd" };

  const { status, body } = await post({
    plan: "companion", email: "buyer@example.com", promoCode: "SAVE30",
  });

  assert.equal(status, 409);
  assert.equal(body.error, "partial_discount_unsupported");
  assert.match(body.message, /30% off/, "the customer must be told what the code was worth");
  assert.equal(netCalls.length, 0, "a partial discount must NEVER fall through to a full-price charge");
});

test("b: partial FIXED-amount discount is also refused 409 (not just percentages)", async () => {
  env({ ...DODO_ARMED, ...STRIPE_ARMED, PROMO_CODES_ENABLED: "1" });
  stripeStub.config.promotionCodes = {
    data: [{ id: "promo_5", code: "FIVE", active: true, coupon: { amount_off: 500, currency: "usd", valid: true } }],
  };
  const { status, body } = await post({
    plan: "companion", email: "buyer@example.com", promoCode: "FIVE",
  });
  assert.equal(status, 409);
  assert.equal(body.error, "partial_discount_unsupported");
  assert.equal(netCalls.length, 0);
});

test("b: an amount_off that covers the WHOLE price is zero-charge, not partial", async () => {
  env({ ...DODO_ARMED, ...STRIPE_ARMED, PROMO_CODES_ENABLED: "1" });
  stripeStub.config.promotionCodes = {
    data: [{ id: "promo_all", code: "ALLOFF", active: true, coupon: { amount_off: 1499, currency: "usd", valid: true } }],
  };
  const { status, body } = await post({
    plan: "companion", email: "buyer@example.com", promoCode: "ALLOFF",
  });
  assert.equal(status, 200);
  assert.equal(body.zeroCharge, true);
  assert.equal(netCalls.length, 0);
});

test("b: an INVALID code -> 400 invalid_promo, no charge, no activation", async () => {
  env({ ...DODO_ARMED, ...STRIPE_ARMED, PROMO_CODES_ENABLED: "1" });
  stripeStub.config.promotionCodes = { data: [] }; // Stripe knows no such code
  const { status, body } = await post({
    plan: "companion", email: "buyer@example.com", promoCode: "BOGUS",
  });
  assert.equal(status, 400);
  assert.equal(body.error, "invalid_promo");
  assert.equal(netCalls.length, 0, "an invalid code must not silently charge full price");
});

test("b: a promo INFRASTRUCTURE failure -> 502 promo_error, and still no charge", async () => {
  env({ ...DODO_ARMED, ...STRIPE_ARMED, PROMO_CODES_ENABLED: "1" });
  stripeStub.config.promotionCodes = new Error("stripe is down");
  const { status, body } = await post({
    plan: "companion", email: "buyer@example.com", promoCode: "FREEBIE",
  });
  assert.equal(status, 502);
  assert.equal(body.error, "promo_error");
  assert.equal(netCalls.length, 0, "failing open to a full-price charge would be the worst outcome");
});

test("b: the email guard runs BEFORE the promo branch", async () => {
  env({ ...DODO_ARMED, ...STRIPE_ARMED, PROMO_CODES_ENABLED: "1" });
  const { status, body } = await post({ plan: "companion", promoCode: "FREEBIE" });
  assert.equal(status, 400);
  assert.equal(body.error, "email_required");
  assert.equal(stripeStub.calls.length, 0, "an anonymous order must not even be priced");
});

test("b: a whitespace-only promoCode falls through to the normal paid path", async () => {
  env(); // dodo unconfigured -> expect the 503 coming-soon, NOT promo_unavailable
  const { status, body } = await post({
    plan: "companion", email: "buyer@example.com", promoCode: "   ",
  });
  assert.equal(status, 503);
  assert.equal(body.error, "not_configured", "a blank code must not be treated as a promo attempt");
});

// ── KNOWN GAP, recorded as evidence rather than prose ──────────────────────

test("b: GAP — a zero-charge activation writes NO subscription record, so the customer is invisible to the account/billing surfaces", async () => {
  // This test documents CURRENT behaviour, not desired behaviour. The 100%-off
  // branch calls putConnect() only. It never calls putSubscription(), and it
  // creates nothing in Stripe. Consequences, all reachable from this fact:
  //   - getSubscriptionByEmail() -> null, so /api/portal answers 404
  //     no_subscription and /api/subscription/cancel (same lookup, route line 36)
  //     cannot find them either: a comped customer cannot self-serve cancel.
  //   - entitlementForEmail() asks STRIPE for a live subscription, so /api/auth/me
  //     reports active:false — the site treats them as not entitled.
  // The Telegram bind still works, because /start reads the CONNECT record.
  // If someone fixes this, this test should start failing — that is the point.
  env({ ...DODO_ARMED, ...STRIPE_ARMED, PROMO_CODES_ENABLED: "1" });
  stripeStub.config.promotionCodes = {
    data: [{ id: "promo_100", code: "FREEBIE", active: true, coupon: { percent_off: 100, valid: true } }],
  };

  const email = "comped-customer@example.com";
  const { status, body } = await post({ plan: "companion", email, promoCode: "FREEBIE" });
  assert.equal(status, 200);
  assert.equal(body.zeroCharge, true);

  // The connect record exists and is active...
  const connect = await store.getConnect(body.token);
  assert.equal(connect.status, "active");

  // ...but there is NO subscription record behind it.
  const sub = await store.getSubscriptionByEmail(email);
  assert.equal(
    sub, null,
    "RECORDED GAP: no subscription record is written, so portal/cancel/entitlement cannot see this customer",
  );
});

test("malformed JSON body -> 400, never a crash", async () => {
  env(DODO_ARMED);
  const res = await POST(jsonRequest("{not json")).then(readJson);
  assert.equal(res.status, 400);
  assert.equal(netCalls.length, 0);
});

// ── (e) BINDING AT THE POINT OF PURCHASE — phone, channel, consent ─────────
//
// gotchas#256 / decisions#340 / specs#160. The defect these tests exist for:
// a customer could complete a PAID checkout and end up with a record carrying
// no number, no channel and no proof of consent — unbindable, and with nothing
// showing they were ever told about the WhatsApp ban risk. The trial path
// (/api/begin) collected all three; the revenue path collected none.
//
// Every refusal test below arms Dodo AND Stripe AND lifts the promo kill switch
// and supplies a genuinely valid 100%-off code. So if the gate did not stop the
// request first, the request WOULD reach a provider — `netCalls.length === 0`
// and `stripeStub.calls.length === 0` are therefore evidence, not a vacuum.

/** Everything armed: the only thing that can stop a request is the gate. */
const ALL_ARMED = { ...DODO_ARMED, ...STRIPE_ARMED, PROMO_CODES_ENABLED: "1" };

/** A real, valid, 100%-off code sitting in Stripe waiting to be used. */
function armFreeCode() {
  stripeStub.config.promotionCodes = {
    data: [{ id: "promo_100", code: "FREEBIE", active: true, coupon: { percent_off: 100, valid: true } }],
  };
  stripeStub.config.price = { unit_amount: 1499, currency: "usd" };
}

/** Assert that a refusal cost nothing: no charge, no promo lookup, no record. */
function assertNothingHappened(body, what) {
  assert.equal(netCalls.length, 0, `${what}: nothing may reach the payment provider`);
  assert.equal(stripeStub.calls.length, 0, `${what}: the order must not even be priced`);
  assert.equal(body.token, undefined, `${what}: no connect token may be minted`);
  assert.equal(body.url, undefined, `${what}: no payment link may be handed back`);
}

const BUYER = { plan: "companion", email: "buyer@example.com" };

/** The connect token a Dodo checkout carries home, read back out of the call. */
function tokenFromProviderCall() {
  const returnUrl = JSON.parse(netCalls[0].body).return_url;
  return new URL(returnUrl).searchParams.get("token");
}

test("e: a valid national-form number is persisted as E.164 on the CHARGED path", async () => {
  env(DODO_ARMED);
  scriptFetch(async () => new Response(
    JSON.stringify({ payment_link: "https://pay.dodo.test/bound" }),
    { status: 200, headers: { "content-type": "application/json" } },
  ));

  const { status, body } = await post({ ...BUYER, phone: RAW_PHONE });
  assert.equal(status, 200);
  assert.equal(body.url, "https://pay.dodo.test/bound");
  assert.equal(netCalls.length, 1, "exactly one provider call on the happy path");

  // The record the webhook will later mark paid is a record that can be BOUND.
  const token = tokenFromProviderCall();
  assert.ok(token, "the checkout must carry a connect token");

  const rec = await store.getConnect(token);
  assert.ok(rec, "a connect record must be persisted for a paid order");
  assert.equal(rec.phone, RAW_PHONE_E164, "ONLY the normalised E.164 may be stored");
  assert.notEqual(rec.phone, RAW_PHONE, "the raw typed input must never be the stored identity");
  assert.equal(rec.channel, "whatsapp");
  assert.equal(rec.status, "pending", "not paid yet — the webhook activates it");
});

test("e: consent is persisted with the paid record, with the optional scope and its provenance", async () => {
  env(DODO_ARMED);
  scriptFetch(async () => new Response(
    JSON.stringify({ payment_link: "https://pay.dodo.test/consent" }),
    { status: 200, headers: { "content-type": "application/json" } },
  ));

  const before = new Date().toISOString();
  const { status, body } = await post({
    ...BUYER,
    consent: { ...CONSENT_OK, observationNumber: true },
  });
  assert.equal(status, 200);
  assert.ok(body.url);

  const rec = await store.getConnect(tokenFromProviderCall());
  assert.ok(rec.consent, "the consent taken must exist on the record, not only in the browser");
  assert.equal(rec.consent.unofficialAutomation, true);
  assert.equal(rec.consent.banRisk, true);
  assert.equal(rec.consent.ownAccountReplies, true);
  assert.equal(rec.consent.observationNumber, true, "an opt-IN that was chosen must be recorded as chosen");
  assert.equal(rec.consent.disclosure, "specs#160r2", "which disclosure they agreed to must be answerable later");
  assert.ok(rec.consent.acceptedAt >= before, "when they agreed must be recorded");
});

test("e: the OPTIONAL observation number defaults to FALSE and is never flipped on for the customer", async () => {
  env(DODO_ARMED);
  scriptFetch(async () => new Response(
    JSON.stringify({ payment_link: "https://pay.dodo.test/obs" }),
    { status: 200, headers: { "content-type": "application/json" } },
  ));

  const { status } = await post({ ...BUYER, consent: CONSENT_OK }); // no observationNumber key
  assert.equal(status, 200);
  const rec = await store.getConnect(tokenFromProviderCall());
  assert.equal(rec.consent.observationNumber, false, "silence about an opt-in is a NO, never a yes");
});

test("e: an INVALID phone is 400 invalid_phone with a stable reason, and NOTHING is charged", async () => {
  // Each of these fails a DIFFERENT rule in phone.ts, so the test measures the
  // normaliser contract rather than one lucky string.
  const bad = [
    ["abcdef", "no-digits"],
    ["+++", "no-digits"],
    ["12", "length"],
    ["+1234567890123456789", "length"],
  ];
  for (const [phone, reason] of bad) {
    env(ALL_ARMED);
    resetNet();
    stripeStub.reset();
    armFreeCode();
    const { status, body } = await post({ ...BUYER, phone, promoCode: "FREEBIE" });
    assert.equal(status, 400, `phone=${JSON.stringify(phone)} must be refused`);
    assert.equal(body.error, "invalid_phone");
    assert.equal(body.reason, reason, `phone=${JSON.stringify(phone)} must report reason ${reason}`);
    assert.ok(body.message, "a refusal must carry text the customer can act on");
    assertNothingHappened(body, `phone=${JSON.stringify(phone)}`);
  }
});

test("e: a MISSING phone on the (default) WhatsApp channel is 400, and nothing is charged", async () => {
  for (const phone of [undefined, null, "", "   "]) {
    env(ALL_ARMED);
    resetNet();
    stripeStub.reset();
    armFreeCode();
    const { status, body } = await postExact({ ...BUYER, consent: CONSENT_OK, phone, promoCode: "FREEBIE" });
    assert.equal(status, 400, `phone=${JSON.stringify(phone)} must be refused`);
    assert.equal(body.error, "invalid_phone");
    assert.equal(body.reason, "empty");
    assertNothingHappened(body, `phone=${JSON.stringify(phone)}`);
  }
});

test("e: an over-long phone is refused, and 200 chars is NOT (the bound is measured)", async () => {
  env(ALL_ARMED);
  armFreeCode();
  const over = "9".repeat(201);
  const res = await post({ ...BUYER, phone: over, promoCode: "FREEBIE" });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "invalid_phone");
  assertNothingHappened(res.body, "over-long phone");

  // Control: exactly 200 chars gets past the CAP and is judged by the
  // normaliser instead — proving the cap is a cap, not "long strings are bad".
  env(ALL_ARMED);
  resetNet();
  stripeStub.reset();
  const at = "9".repeat(200);
  const ctl = await post({ ...BUYER, phone: at });
  assert.equal(ctl.body.reason, "length", "200 chars must reach the normaliser and fail ITS length rule");
});

test("e: MISSING consent is 400 consent_required naming the required scope, and nothing is charged", async () => {
  for (const consent of [undefined, null, {}, "yes", 1, [], [true, true, true]]) {
    env(ALL_ARMED);
    resetNet();
    stripeStub.reset();
    armFreeCode();
    const { status, body } = await postExact({
      ...BUYER, channel: "whatsapp", phone: RAW_PHONE, consent, promoCode: "FREEBIE",
    });
    assert.equal(status, 400, `consent=${JSON.stringify(consent)} must be refused`);
    assert.equal(body.error, "consent_required");
    assert.deepEqual(
      body.missing, ["banRisk"],
      "the customer must be told exactly which consent is outstanding",
    );
    assertNothingHappened(body, `consent=${JSON.stringify(consent)}`);
  }
});

test("e: INCOMPLETE consent — each required scope alone blocks the charge and is named", async () => {
  // specs#160r2: `banRisk` is the whole required set. The demoted scopes are
  // swept in the sibling test below to prove they cannot stand in for it.
  for (const scope of ["banRisk"]) {
    for (const value of [false, undefined, "true", 1, null]) {
      env(ALL_ARMED);
      resetNet();
      stripeStub.reset();
      armFreeCode();
      const consent = { ...CONSENT_OK, [scope]: value };
      const { status, body } = await post({ ...BUYER, consent, promoCode: "FREEBIE" });
      assert.equal(status, 400, `${scope}=${JSON.stringify(value)} must be refused`);
      assert.equal(body.error, "consent_required");
      assert.deepEqual(body.missing, [scope], `only ${scope} is outstanding, so only it may be named`);
      assertNothingHappened(body, `${scope}=${JSON.stringify(value)}`);
    }
  }
});

test("e: consent must be exactly TRUE — a truthy value is a client bug, not informed agreement", async () => {
  env(ALL_ARMED);
  armFreeCode();
  const { status, body } = await post({
    ...BUYER,
    consent: { unofficialAutomation: "yes", banRisk: 1, ownAccountReplies: "on" },
    promoCode: "FREEBIE",
  });
  assert.equal(status, 400);
  assert.equal(body.error, "consent_required");
  assert.deepEqual(body.missing, ["banRisk"], "no truthy stand-in counts as consent to a ban risk");
  assertNothingHappened(body, "truthy consent");
});

test("e: a non-boolean OPTIONAL scope is refused rather than silently decided for the customer", async () => {
  env(ALL_ARMED);
  armFreeCode();
  const { status, body } = await post({
    ...BUYER,
    consent: { ...CONSENT_OK, observationNumber: "maybe" },
    promoCode: "FREEBIE",
  });
  assert.equal(status, 400);
  assert.equal(body.error, "consent_invalid");
  assertNothingHappened(body, "non-boolean observationNumber");
});

test("e: an UNKNOWN channel is 400 invalid_channel — never silently coerced — and nothing is charged", async () => {
  for (const channel of ["signal", "WHATSAPP", "whatsapp ", "", "sms", 1, true, null, {}]) {
    env(ALL_ARMED);
    resetNet();
    stripeStub.reset();
    armFreeCode();
    const { status, body } = await post({ ...BUYER, channel, promoCode: "FREEBIE" });
    assert.equal(status, 400, `channel=${JSON.stringify(channel)} must be refused`);
    assert.equal(body.error, "invalid_channel");
    assertNothingHappened(body, `channel=${JSON.stringify(channel)}`);
  }
});

test("e: an ABSENT channel means WhatsApp, so the gate still applies", async () => {
  env(ALL_ARMED);
  armFreeCode();
  const { status, body } = await postExact({ ...BUYER, phone: RAW_PHONE, promoCode: "FREEBIE" });
  assert.equal(status, 400, "silence means WhatsApp (decisions#340), so consent is still required");
  assert.equal(body.error, "consent_required");
  assertNothingHappened(body, "absent channel");
});

test("e: TELEGRAM does not demand a WhatsApp disclosure, and records the channel it was given", async () => {
  env(DODO_ARMED);
  scriptFetch(async () => new Response(
    JSON.stringify({ payment_link: "https://pay.dodo.test/tg" }),
    { status: 200, headers: { "content-type": "application/json" } },
  ));
  // No phone, no consent — a Telegram order pairs on a Telegram id and specs#160
  // is a WhatsApp notice. Demanding it here would be theatre.
  const { status, body } = await postExact({ ...BUYER, channel: "telegram" });
  assert.equal(status, 200);
  assert.ok(body.url);

  const rec = await store.getConnect(tokenFromProviderCall());
  assert.equal(rec.channel, "telegram");
  assert.equal(rec.phone, undefined, "no number was given, so none may be invented");
  assert.equal(rec.consent, undefined, "a WhatsApp consent must not be recorded for a Telegram order");
});

test("e: a Telegram order that DOES supply a number must still supply a valid one", async () => {
  env(ALL_ARMED);
  armFreeCode();
  const { status, body } = await postExact({
    ...BUYER, channel: "telegram", phone: "abcdef", promoCode: "FREEBIE",
  });
  assert.equal(status, 400);
  assert.equal(body.error, "invalid_phone");
  assertNothingHappened(body, "telegram with a junk number");
});

test("e: ORDERING — the binding gate runs BEFORE the promo branch, so a comped order cannot skip it", async () => {
  // A 100%-off code is the one path that reaches an ACTIVATION without a charge.
  // If the gate ran after it, an unbindable record could still be created for
  // free — the same defect wearing a discount.
  env(ALL_ARMED);
  armFreeCode();
  const { status, body } = await postExact({ ...BUYER, phone: RAW_PHONE, promoCode: "FREEBIE" });
  assert.equal(status, 400);
  assert.equal(body.error, "consent_required");
  assert.equal(stripeStub.calls.length, 0, "an unbound order must not even be priced");
  assert.equal(body.zeroCharge, undefined, "and it must certainly not be activated");
  assertNothingHappened(body, "unbound comped order");
});

test("e: ORDERING — the email guard still runs FIRST (the new gate did not displace it)", async () => {
  env(ALL_ARMED);
  armFreeCode();
  const { status, body } = await post({ plan: "companion", promoCode: "FREEBIE" }); // bound, no email
  assert.equal(status, 400);
  assert.equal(body.error, "email_required");
  assertNothingHappened(body, "anonymous but bound order");
});

test("e: ORDERING — an unknown plan is still refused before the binding gate", async () => {
  env(ALL_ARMED);
  armFreeCode();
  const { status, body } = await postExact({ plan: "enterprise", email: "b@example.com" });
  assert.equal(status, 400);
  assert.match(body.error, /Unknown plan/, "the plan refusal keeps its existing prose shape, unchanged");
  assertNothingHappened(body, "unknown plan");
});

test("e: a ZERO-CHARGE order is bound too — phone, channel and consent all persisted", async () => {
  env(ALL_ARMED);
  armFreeCode();
  const { status, body } = await post({ ...BUYER, promoCode: "FREEBIE" });
  assert.equal(status, 200);
  assert.equal(body.zeroCharge, true);
  assert.equal(netCalls.length, 0, "a 100%-off order still never calls Dodo");

  const rec = await store.getConnect(body.token);
  assert.equal(rec.status, "active");
  assert.equal(rec.phone, RAW_PHONE_E164, "a comped customer must be as bindable as a paying one");
  assert.equal(rec.channel, "whatsapp");
  assert.equal(rec.consent.banRisk, true);
  assert.equal(rec.consent.disclosure, "specs#160r2");
});

test("e: the WhatsApp number is never sent to the payment provider", async () => {
  // The provider needs an email and a country to take money. It does not need
  // the customer WhatsApp number, and PII does not travel further than the job
  // requires (store.ts keeps `phone` on the secret list for the same reason).
  env(DODO_ARMED);
  scriptFetch(async () => new Response(
    JSON.stringify({ payment_link: "https://pay.dodo.test/pii" }),
    { status: 200, headers: { "content-type": "application/json" } },
  ));
  const { status } = await post({ ...BUYER, phone: RAW_PHONE });
  assert.equal(status, 200);
  const sent = netCalls[0].body;
  assert.ok(!sent.includes(RAW_PHONE_E164), "the E.164 number must not be in the provider payload");
  assert.ok(!sent.includes("501234567"), "nor any recognisable form of it");
});

// ── (f) Billing country / tax jurisdiction ─────────────────────────────────
// decisions#342 + the judge's review condition on Writer J's validator: the
// validator itself was right to REFUSE an unrecognised country rather than
// coerce it, but the refusal surfaced through the route's catch-all as a 502
// "checkout_failed" — the same answer a provider outage gives. Judge, verbatim:
// "legitimate customers with a genuine input mistake get a generic server-error
// page instead of an actionable validation error". These tests pin the status
// code, the fact that no charge is attempted, and — the part a status-code-only
// test would miss — that a refused order leaves NO pending connect record.

test("f: an UNASSIGNED country code is 400 invalid_country, not a 502, and nothing is charged", async () => {
  env(DODO_ARMED);
  // ZZ passes /^[A-Z]{2}$/ and is NOT an assigned ISO-3166-1 code — exactly the
  // shape a provider may treat as "no tax". Pre-fix this reached Dodo.
  const { status, body } = await post({ ...BUYER, country: "ZZ" });
  assert.equal(status, 400, "a caller's bad input is a 400, never the 502 an outage returns");
  assert.equal(body.error, "invalid_country");
  assert.equal(netCalls.length, 0, "no charge may be attempted for a refused jurisdiction");
});

test("f: a non-string country off a JSON body is refused, not coerced", async () => {
  env(DODO_ARMED);
  // {"country": 971} really can arrive: the declared TypeScript type is a
  // promise the network never made.
  const { status, body } = await post({ ...BUYER, country: 971 });
  assert.equal(status, 400);
  assert.equal(body.error, "invalid_country");
  assert.equal(netCalls.length, 0);
});

test("f: a refused country leaves NO pending connect record behind", async () => {
  env(DODO_ARMED);
  const before = await store.listConnectTokens?.();
  const { status, body } = await post({ ...BUYER, country: "XX" });
  assert.equal(status, 400);
  assert.equal(body.token, undefined, "a refused order must not hand back a connect token");
  if (Array.isArray(before)) {
    const after = await store.listConnectTokens();
    assert.equal(after.length, before.length, "a rejected order must not litter the store");
  }
});

test("f: POSITIVE CONTROL — a VALID country still reaches the provider, normalised", async () => {
  env(DODO_ARMED);
  scriptFetch(async () => new Response(
    JSON.stringify({ payment_link: "https://pay.dodo.test/ok" }),
    { status: 200, headers: { "content-type": "application/json" } },
  ));
  // Lower-case with surrounding whitespace: normalising it is NOT coercion —
  // it is the same jurisdiction the caller named.
  const { status } = await post({ ...BUYER, country: " de " });
  assert.equal(status, 200, "a real country must not be caught by the guard");
  assert.equal(netCalls.length, 1);
  assert.match(netCalls[0].body, /"country":"DE"/, "the normalised code is what reaches Dodo");
});

test("f: an ABSENT country is untouched — the historical default still applies", async () => {
  // This is the path EVERY order from the checkout page takes today: the page
  // sends no country at all. Changing it would change the tax charged to live
  // customers, which is the very defect being fixed.
  env(DODO_ARMED);
  scriptFetch(async () => new Response(
    JSON.stringify({ payment_link: "https://pay.dodo.test/default" }),
    { status: 200, headers: { "content-type": "application/json" } },
  ));
  const { status } = await post(BUYER);
  assert.equal(status, 200);
  assert.match(netCalls[0].body, /"country":"AE"/);
});
