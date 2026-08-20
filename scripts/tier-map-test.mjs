/**
 * TIER-MAP TEST (jury #68).
 *
 * Proves the SAME core that stripe.ts's planForPriceId uses in production
 * (src/lib/plan-core.mjs) reverses a Stripe price id back to the correct
 * purchased tier slug — which the web account page turns into "Companion" /
 * "Assistant" / "Studio". Injects FAKE price ids (no env, no Stripe calls),
 * exactly as the production wrapper injects the live STRIPE_PRICE_* ids.
 *
 * Proves:
 *   1. each configured price id -> its correct plan (companion/assistant/studio);
 *   2. an unknown / unconfigured price id -> null (never a guessed plan);
 *   3. null / undefined / empty priceId -> null;
 *   4. a plan whose price id is unset does not match a null lookup.
 *
 * Run: npm run test:tier   (or: node --test scripts/tier-map-test.mjs)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { planForPriceId, PAID_PLANS } from "../src/lib/plan-core.mjs";

// Stand-in for the live STRIPE_PRICE_* env ids, injected the same way stripe.ts does.
const PRICE_BY_PLAN = {
  companion: "price_companion_1499",
  assistant: "price_assistant_3900",
  studio: "price_studio_7900",
};

test("each price id maps to its correct tier slug", () => {
  assert.equal(planForPriceId("price_companion_1499", PRICE_BY_PLAN), "companion");
  assert.equal(planForPriceId("price_assistant_3900", PRICE_BY_PLAN), "assistant");
  assert.equal(planForPriceId("price_studio_7900", PRICE_BY_PLAN), "studio");
});

test("PAID_PLANS round-trips: every configured plan reverses to itself", () => {
  for (const plan of PAID_PLANS) {
    assert.equal(planForPriceId(PRICE_BY_PLAN[plan], PRICE_BY_PLAN), plan);
  }
});

test("an unknown / unconfigured price id maps to null (never a guessed plan)", () => {
  assert.equal(planForPriceId("price_does_not_exist", PRICE_BY_PLAN), null);
  assert.equal(planForPriceId("price_legacy_removed", PRICE_BY_PLAN), null);
});

test("null / undefined / empty price id maps to null", () => {
  assert.equal(planForPriceId(null, PRICE_BY_PLAN), null);
  assert.equal(planForPriceId(undefined, PRICE_BY_PLAN), null);
  assert.equal(planForPriceId("", PRICE_BY_PLAN), null);
});

test("a plan with an unset price id does not swallow a null lookup", () => {
  const partial = { companion: "price_companion_1499", assistant: undefined, studio: null };
  assert.equal(planForPriceId("price_companion_1499", partial), "companion");
  assert.equal(planForPriceId(null, partial), null);
  // undefined/null configured ids must never match a null/undefined incoming id
  assert.equal(planForPriceId(undefined, partial), null);
});
