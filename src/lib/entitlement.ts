import { stripe, paymentsConfigured, planForPriceId, type PaidPlan } from "@/lib/stripe";

/**
 * Server-side entitlement: given a VERIFIED email (from the login session), does
 * this person have a live Stripe subscription? This is the ONLY source of truth
 * for "has this person paid" — never localStorage, never the client.
 *
 * We match the session email to a Stripe customer by email, then look for a
 * subscription in a live state (active / trialing / past_due). Read-only.
 */

export type Entitlement = {
  active: boolean;
  status: string | null; // stripe subscription status
  plan: PaidPlan | null; // which paid tier (companion/assistant/studio); null if none/unknown
  priceId: string | null;
  customerId: string | null;
};

const LIVE = new Set(["active", "trialing", "past_due"]);

export async function entitlementForEmail(email: string): Promise<Entitlement> {
  const none: Entitlement = { active: false, status: null, plan: null, priceId: null, customerId: null };
  if (!paymentsConfigured() || !email) return none;
  try {
    const customers = await stripe().customers.list({ email: email.toLowerCase(), limit: 3 });
    // A person may have more than one customer row (e.g. guest checkout); check each.
    for (const cust of customers.data) {
      const subs = await stripe().subscriptions.list({ customer: cust.id, status: "all", limit: 10 });
      const live = subs.data.find((s) => LIVE.has(s.status));
      if (live) {
        const priceId = live.items.data[0]?.price?.id ?? null;
        return {
          active: true,
          status: live.status,
          plan: planForPriceId(priceId), // reverse the priceId to the purchased tier name
          priceId,
          customerId: cust.id,
        };
      }
    }
    // Known customer, no live subscription (cancelled/expired).
    if (customers.data[0]) return { ...none, customerId: customers.data[0].id };
    return none;
  } catch {
    return none;
  }
}
