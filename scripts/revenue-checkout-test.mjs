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

const post = (body) => POST(jsonRequest(body)).then(readJson);

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
