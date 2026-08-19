import { stripe, paymentsConfigured, planForPriceId, type PaidPlan } from "@/lib/stripe";
import { getSubscriptionByEmail } from "@/lib/store";
import { resolveEntitlement, noneEntitlement } from "@/lib/entitlement-core.mjs";

/**
 * Server-side entitlement: given a VERIFIED email (from the login session), does
 * this person have a live subscription? This is the ONLY source of truth for
 * "has this person paid" — never localStorage, never the client.
 *
 * TWO PROCESSORS, ONE ANSWER (ledger gotchas#158). Money comes in through DODO
 * (merchant-of-record; see /api/checkout), while an older cohort still has live
 * STRIPE subscriptions. This resolves DODO FIRST — from the durable email ->
 * subscription index putSubscription() maintains — then falls back to Stripe for
 * the legacy cohort. Both eras work.
 *
 * CRITICAL: the Dodo path is NOT gated on paymentsConfigured(). That helper means
 * "STRIPE_SECRET_KEY is set AND PAYMENTS_LIVE=1"; the previous version early-returned
 * `none` on it, so with Stripe switched off (the current production posture) EVERY
 * paying Dodo customer resolved to "no plan". paymentsConfigured() now gates ONLY
 * the Stripe branch, which is the sole thing it actually describes.
 *
 * Read-only, and never throws — the account page degrades to "no plan", not a 500.
 */

export type Entitlement = {
  active: boolean;
  status: string | null; // subscription status (stripe status, or the stored Dodo record status)
  plan: PaidPlan | null; // which paid tier (companion/assistant/studio); null if none/unknown
  priceId: string | null; // Stripe price id; always null for Dodo-era records
  customerId: string | null; // Stripe customer id, or the DODO customer id — never faked
};

export async function entitlementForEmail(email: string): Promise<Entitlement> {
  if (!email) return noneEntitlement() as Entitlement;
  try {
    return (await resolveEntitlement(email, {
      // 1. Dodo — the current processor. Runs regardless of Stripe configuration.
      getSubscriptionByEmail,
      // 2. Stripe — legacy cohort only. stripe() throws without STRIPE_SECRET_KEY,
      //    so these are only ever invoked when stripeEnabled is true, and the core
      //    additionally catches anything they throw.
      stripeEnabled: paymentsConfigured(),
      listCustomers: async (e: string) =>
        (await stripe().customers.list({ email: e, limit: 3 })).data,
      listSubscriptions: async (customerId: string) =>
        (await stripe().subscriptions.list({ customer: customerId, status: "all", limit: 10 })).data,
      planForPriceId,
      onError: (source: "dodo" | "stripe", err: unknown) =>
        console.error(`[entitlement] ${source} lookup failed:`, err),
    })) as Entitlement;
  } catch (err) {
    // Belt and braces: the core is contractually non-throwing, but entitlement is on
    // the revenue path and must never be the reason an account page 500s.
    console.error("[entitlement] unexpected failure:", err);
    return noneEntitlement() as Entitlement;
  }
}
