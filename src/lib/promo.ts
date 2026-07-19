import { stripe as realStripe, priceIdFor, type PaidPlan } from "@/lib/stripe";
import { validatePromoCore, computeDiscount, normalizeCode } from "@/lib/promo-core.mjs";

/**
 * Promotion-code validation — typed public surface over the pure core.
 *
 * Stripe is the single source of truth for codes. The customer NEVER visits
 * Stripe to enter one: we look the code up server-side against Stripe's
 * promotion_codes, confirm it is active + its coupon is valid, then compute the
 * discount against the SERVER price for the plan. No price or discount value
 * from the browser is ever trusted. All money values are integer cents.
 */

export type PromoOk = {
  valid: true;
  code: string;
  promotion_code_id: string;
  subtotal: number; // cents, recurring plan price before discount
  discount: number; // cents, amount taken off
  total: number; // cents, subtotal - discount (>= 0)
  currency: string; // ISO currency of the price
  label: string; // human-readable discount, e.g. "100% off" / "$5.00 off"
};

export type PromoFail = { valid: false; reason: string };
export type PromoResult = PromoOk | PromoFail;

export { computeDiscount, normalizeCode };

/**
 * Validate + price a code against a plan, injecting the real Stripe client.
 * Callers must have already confirmed payments are configured.
 */
export async function validatePromo(rawCode: string, plan: PaidPlan): Promise<PromoResult> {
  // Cast the real Stripe client + priceIdFor to the core's injected-dep shape;
  // the core only touches promotionCodes.list / prices.retrieve, which the real
  // client provides.
  const deps = { stripe: realStripe(), priceIdFor } as unknown as Parameters<
    typeof validatePromoCore
  >[2];
  return (await validatePromoCore(rawCode, plan, deps)) as PromoResult;
}
