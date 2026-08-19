/**
 * PLAN CORE — pure Stripe-priceId -> plan-slug mapping.
 *
 * Single source of truth shared by BOTH the TypeScript wrapper (stripe.ts's
 * planForPriceId, which injects the live STRIPE_PRICE_* env ids) AND the
 * runnable test (scripts/tier-map-test.mjs, which injects fake ids) — so the
 * exact same mapping code path is exercised, with no env reads and no Stripe
 * calls in tests. Returns null for an unknown/unconfigured price id (the caller
 * must never guess a plan).
 *
 * @typedef {"companion"|"assistant"|"studio"} PaidPlan
 */

/** The paid plan slugs, in ascending tier order. */
export const PAID_PLANS = /** @type {const} */ (["companion", "assistant", "studio"]);

/**
 * Reverse a Stripe price id back to its plan slug.
 * @param {string|null|undefined} priceId
 * @param {Record<string, string|null|undefined>} priceByPlan  plan slug -> its Stripe price id
 * @returns {PaidPlan|null}
 */
export function planForPriceId(priceId, priceByPlan) {
  if (!priceId) return null;
  for (const plan of PAID_PLANS) {
    const id = priceByPlan[plan];
    if (id && id === priceId) return /** @type {PaidPlan} */ (plan);
  }
  return null;
}
