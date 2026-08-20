/**
 * PROMOTION-CODE CORE — pure, injectable validation + discount math.
 *
 * This module owns the code-normalization, Stripe lookup flow, and the
 * discount arithmetic. Its Stripe access is INJECTED (deps.stripe,
 * deps.priceIdFor) so BOTH the TypeScript wrapper (promo.ts, which injects the
 * real Stripe client) AND the runnable test (scripts/promo-validate-test.mjs,
 * which injects a fake Stripe client) run the exact same code path — no live
 * Stripe calls in tests, and a price/discount from the browser is never trusted.
 *
 * All money values are integer minor units (cents), matching Stripe's
 * price.unit_amount and coupon.amount_off.
 *
 * @typedef {Object} CouponLike
 * @property {number|null} [percent_off]
 * @property {number|null} [amount_off]
 * @property {string|null} [currency]
 * @property {boolean} [valid]
 * @property {string|null} [name]
 *
 * @typedef {Object} PromotionCodeLike
 * @property {string} id
 * @property {string} code
 * @property {boolean} [active]
 * @property {number|null} [expires_at]
 * @property {CouponLike} coupon
 *
 * @typedef {Object} StripeLike
 * @property {{ list: (params: { code: string, active?: boolean, limit?: number, expand?: string[] }) => Promise<{ data: PromotionCodeLike[] }> }} promotionCodes
 * @property {{ retrieve: (id: string) => Promise<{ unit_amount?: number|null, currency?: string|null }> }} prices
 *
 * @typedef {Object} PromoDeps
 * @property {StripeLike} stripe
 * @property {(plan: string) => string} priceIdFor
 *
 * @typedef {{ valid: true, code: string, promotion_code_id: string, subtotal: number, discount: number, total: number, currency: string, label: string }} PromoOk
 * @typedef {{ valid: false, reason: string }} PromoFail
 * @typedef {PromoOk | PromoFail} PromoResult
 */

/**
 * Trim + uppercase so "mira-pro-30 " and "MIRA-PRO-30" resolve to one code.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeCode(raw) {
  return typeof raw === "string" ? raw.trim().toUpperCase() : "";
}

/**
 * Pure discount math (cents). percent_off wins if present, else amount_off.
 * Discount is clamped to [0, subtotal] so total never goes negative.
 * @param {number} subtotal
 * @param {CouponLike} coupon
 * @returns {number}
 */
export function computeDiscount(subtotal, coupon) {
  if (typeof coupon.percent_off === "number" && coupon.percent_off > 0) {
    const pct = Math.min(coupon.percent_off, 100);
    return Math.min(subtotal, Math.round(subtotal * (pct / 100)));
  }
  if (typeof coupon.amount_off === "number" && coupon.amount_off > 0) {
    return Math.min(subtotal, Math.round(coupon.amount_off));
  }
  return 0;
}

/**
 * @param {number} cents
 * @param {string} currency
 * @returns {string}
 */
function moneyLabel(cents, currency) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/**
 * @param {CouponLike} coupon
 * @param {number} discount
 * @param {string} currency
 * @returns {string}
 */
function discountLabel(coupon, discount, currency) {
  if (typeof coupon.percent_off === "number" && coupon.percent_off > 0) {
    return `${coupon.percent_off}% off`;
  }
  if (typeof coupon.amount_off === "number" && coupon.amount_off > 0) {
    return `${moneyLabel(discount, currency)} off`;
  }
  return coupon.name || "Discount applied";
}

/**
 * Look the code up in the injected Stripe client and, if valid, price it
 * against the plan's server price. Never throws for a bad code — returns a
 * discriminated result; only an infrastructure failure propagates.
 * @param {string} rawCode
 * @param {string} plan
 * @param {PromoDeps} deps
 * @returns {Promise<PromoResult>}
 */
export async function validatePromoCore(rawCode, plan, deps) {
  const code = normalizeCode(rawCode);
  if (!code) return { valid: false, reason: "Enter a promotion code." };

  const list = await deps.stripe.promotionCodes.list({
    code,
    active: true,
    limit: 1,
    expand: ["data.coupon"],
  });
  const promo = list.data[0];
  if (!promo) return { valid: false, reason: "That code isn't valid." };
  if (promo.active === false) return { valid: false, reason: "That code is no longer active." };
  if (typeof promo.expires_at === "number" && promo.expires_at * 1000 < Date.now()) {
    return { valid: false, reason: "That code has expired." };
  }
  const coupon = promo.coupon;
  if (!coupon || coupon.valid === false) {
    return { valid: false, reason: "That code has expired." };
  }

  const priceId = deps.priceIdFor(plan);
  const priceObj = await deps.stripe.prices.retrieve(priceId);
  const subtotal = priceObj.unit_amount;
  const currency = (priceObj.currency ?? "usd").toLowerCase();
  if (typeof subtotal !== "number") {
    return { valid: false, reason: "This plan can't be priced right now." };
  }

  const discount = computeDiscount(subtotal, coupon);
  if (discount <= 0) return { valid: false, reason: "That code isn't valid." };

  const total = Math.max(0, subtotal - discount);
  return {
    valid: true,
    code,
    promotion_code_id: promo.id,
    subtotal,
    discount,
    total,
    currency,
    label: discountLabel(coupon, discount, currency),
  };
}
