/**
 * PROMOTION-CODE VALIDATION TEST.
 *
 * Exercises the SAME core the /api/promo/validate and /api/checkout routes use
 * in production (src/lib/promo-core.mjs), with an INJECTED fake Stripe client —
 * no live Stripe calls. Proves:
 *   1. a percent_off coupon prices correctly against the server price;
 *   2. an amount_off coupon prices correctly and is clamped to the subtotal;
 *   3. a 100%-off code (MIRA-QA-100-2026) yields total 0;
 *   4. an unknown / inactive / expired code is rejected as invalid;
 *   5. pure computeDiscount math for percent, amount, none.
 *
 * The server never trusts a browser price: subtotal comes from prices.retrieve.
 *
 * Run: npm run test:promo   (or: node --test scripts/promo-validate-test.mjs)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { validatePromoCore, computeDiscount, normalizeCode } from "../src/lib/promo-core.mjs";

// Server prices (cents) — stand in for Stripe price.unit_amount per plan.
const PRICES = {
  companion: { id: "price_companion", unit_amount: 1499, currency: "usd" },
  assistant: { id: "price_assistant", unit_amount: 3900, currency: "usd" },
  studio: { id: "price_studio", unit_amount: 7900, currency: "usd" },
};

// Fake Stripe client whose promotion_codes table we control per-test.
function fakeStripe(codes) {
  const byId = new Map(Object.values(PRICES).map((p) => [p.id, p]));
  return {
    promotionCodes: {
      async list({ code, active }) {
        const found = codes.find(
          (c) => c.code === code && (active === undefined || c.active !== false),
        );
        return { data: found ? [found] : [] };
      },
    },
    prices: {
      async retrieve(id) {
        const p = byId.get(id);
        if (!p) throw new Error(`no such price ${id}`);
        return { unit_amount: p.unit_amount, currency: p.currency };
      },
    },
  };
}

const priceIdFor = (plan) => PRICES[plan].id;
const deps = (codes) => ({ stripe: fakeStripe(codes), priceIdFor });

test("percent_off: MIRA-PRO-30 gives 30% off the assistant price", async () => {
  const codes = [
    { id: "promo_pro30", code: "MIRA-PRO-30", active: true, coupon: { percent_off: 30, valid: true } },
  ];
  const r = await validatePromoCore("mira-pro-30", "assistant", deps(codes));
  assert.equal(r.valid, true);
  assert.equal(r.code, "MIRA-PRO-30"); // normalized (trim+upper)
  assert.equal(r.promotion_code_id, "promo_pro30");
  assert.equal(r.subtotal, 3900);
  assert.equal(r.discount, 1170); // 30% of 3900
  assert.equal(r.total, 2730);
  assert.equal(r.currency, "usd");
  assert.equal(r.label, "30% off");
});

test("percent_off 100: MIRA-QA-100-2026 drives the total to 0", async () => {
  const codes = [
    { id: "promo_qa", code: "MIRA-QA-100-2026", active: true, coupon: { percent_off: 100, valid: true } },
  ];
  const r = await validatePromoCore("MIRA-QA-100-2026", "companion", deps(codes));
  assert.equal(r.valid, true);
  assert.equal(r.subtotal, 1499);
  assert.equal(r.discount, 1499);
  assert.equal(r.total, 0);
});

test("amount_off: fixed $5 off the companion price", async () => {
  const codes = [
    { id: "promo_5", code: "FIVEOFF", active: true, coupon: { amount_off: 500, currency: "usd", valid: true } },
  ];
  const r = await validatePromoCore("fiveoff", "companion", deps(codes));
  assert.equal(r.valid, true);
  assert.equal(r.subtotal, 1499);
  assert.equal(r.discount, 500);
  assert.equal(r.total, 999);
  assert.equal(r.label, "$5.00 off");
});

test("amount_off clamps to subtotal (never negative total)", async () => {
  const codes = [
    { id: "promo_big", code: "BIG", active: true, coupon: { amount_off: 999999, currency: "usd", valid: true } },
  ];
  const r = await validatePromoCore("BIG", "companion", deps(codes));
  assert.equal(r.valid, true);
  assert.equal(r.discount, 1499);
  assert.equal(r.total, 0);
});

test("unknown code is rejected", async () => {
  const r = await validatePromoCore("NOPE", "assistant", deps([]));
  assert.equal(r.valid, false);
  assert.equal(typeof r.reason, "string");
});

test("inactive code is rejected", async () => {
  const codes = [
    { id: "promo_dead", code: "DEAD", active: false, coupon: { percent_off: 50, valid: true } },
  ];
  const r = await validatePromoCore("DEAD", "assistant", deps(codes));
  assert.equal(r.valid, false);
});

test("expired coupon (coupon.valid=false) is rejected", async () => {
  const codes = [
    { id: "promo_exp", code: "OLD", active: true, coupon: { percent_off: 50, valid: false } },
  ];
  const r = await validatePromoCore("OLD", "assistant", deps(codes));
  assert.equal(r.valid, false);
});

test("expired code (expires_at in the past) is rejected", async () => {
  const codes = [
    {
      id: "promo_past",
      code: "PAST",
      active: true,
      expires_at: Math.floor(Date.now() / 1000) - 60,
      coupon: { percent_off: 50, valid: true },
    },
  ];
  const r = await validatePromoCore("PAST", "assistant", deps(codes));
  assert.equal(r.valid, false);
});

test("empty code is rejected before any Stripe call", async () => {
  const r = await validatePromoCore("   ", "assistant", deps([]));
  assert.equal(r.valid, false);
});

test("computeDiscount pure math: percent, amount, none", () => {
  assert.equal(computeDiscount(3900, { percent_off: 30 }), 1170);
  assert.equal(computeDiscount(1499, { percent_off: 100 }), 1499);
  assert.equal(computeDiscount(1499, { amount_off: 500 }), 500);
  assert.equal(computeDiscount(1499, { amount_off: 999999 }), 1499); // clamped
  assert.equal(computeDiscount(1499, {}), 0); // neither
  assert.equal(normalizeCode("  mira-pro-30 "), "MIRA-PRO-30");
});
