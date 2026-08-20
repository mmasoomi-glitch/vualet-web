/**
 * ENTITLEMENT CORE — pure "has this person paid" resolution. All I/O injected.
 *
 * WHY THIS EXISTS (ledger gotchas#158): the processor that TAKES the money and the
 * processor that ANSWERS "has this person paid" had drifted apart. Checkout moved to
 * Dodo Payments (merchant-of-record), but entitlement was still resolved Stripe-only,
 * so every Dodo-paying customer saw "No active plan" on /mira/account.
 *
 * Resolution order is deliberate:
 *   1. DODO   — the CURRENT processor. Resolved from the durable email -> subscription
 *               index that putSubscription() maintains. MUST work even when Stripe is
 *               not configured at all.
 *   2. STRIPE — legacy Stripe-era customers, so the pre-Dodo cohort keeps working.
 *
 * Kept env-free and network-free (deps injected) so scripts/entitlement-test.mjs
 * exercises the EXACT code path production runs — mirrors plan-core.mjs and
 * dodo-webhook-core.mjs.
 *
 * FAIL-SAFE CONTRACT: this module never throws. A failing Dodo lookup falls through
 * to Stripe; a failing Stripe lookup falls through to whatever Dodo found; a total
 * failure returns a well-formed inactive entitlement. The account page must degrade
 * to "no plan", never to a 500.
 *
 * @typedef {"companion"|"assistant"|"studio"} PaidPlan
 * @typedef {{ active: boolean, status: string|null, plan: PaidPlan|null, priceId: string|null, customerId: string|null }} Entitlement
 */

import { PAID_PLANS } from "./plan-core.mjs";

/** The well-formed "not entitled" answer. Callers get a fresh copy, never this object. */
export const NONE = Object.freeze(
  /** @type {Entitlement} */ ({ active: false, status: null, plan: null, priceId: null, customerId: null }),
);

/** Stripe subscription statuses that still grant access. */
export const LIVE_STRIPE_STATUS = new Set(["active", "trialing", "past_due"]);

/**
 * ConnectRecord.status values that grant access. ONLY "active" — the webhook sets
 * that exclusively after Dodo confirms money. "pending" (checkout started, unpaid)
 * and "bound" (Telegram claimed an unpaid token) must NOT entitle anyone.
 */
export const LIVE_DODO_STATUS = new Set(["active"]);

/** A fresh, well-formed inactive entitlement. */
export function noneEntitlement() {
  return /** @type {Entitlement} */ ({ ...NONE });
}

/**
 * ConnectRecord.plan is a loose `string`; Entitlement.plan is a strict PaidPlan.
 * Never guess a tier from an unrecognised slug.
 * @param {unknown} v
 * @returns {PaidPlan|null}
 */
export function paidPlanOrNull(v) {
  return PAID_PLANS.includes(/** @type {any} */ (v)) ? /** @type {PaidPlan} */ (v) : null;
}

/**
 * Map a store lookup ({ customerId, rec }) onto an Entitlement.
 *
 * customerId is the DODO customer id — deliberately NOT faked into a Stripe id.
 * priceId is null because Dodo has no Stripe price ids.
 *
 * @param {{ customerId?: string, rec?: any }|null|undefined} found
 * @returns {Entitlement|null} null when there is no Dodo record at all
 */
export function entitlementFromDodoRecord(found) {
  if (!found || !found.rec) return null;
  const rec = found.rec;
  const status = typeof rec.status === "string" ? rec.status : null;
  return /** @type {Entitlement} */ ({
    active: status != null && LIVE_DODO_STATUS.has(status),
    status,
    plan: paidPlanOrNull(rec.plan),
    priceId: null,
    customerId: rec.customerId ?? found.customerId ?? null,
  });
}

/**
 * Resolve entitlement for a VERIFIED email (from the login session — never client input).
 *
 * @param {string} email
 * @param {{
 *   getSubscriptionByEmail?: (email: string) => Promise<{ customerId: string, rec: any }|null>,
 *   stripeEnabled?: boolean,
 *   listCustomers?: (email: string) => Promise<Array<{ id: string }>>,
 *   listSubscriptions?: (customerId: string) => Promise<Array<any>>,
 *   planForPriceId?: (priceId: string|null) => PaidPlan|null,
 *   onError?: (source: "dodo"|"stripe", err: unknown) => void,
 * }} [deps]
 * @returns {Promise<Entitlement>}
 */
export async function resolveEntitlement(email, deps = {}) {
  const {
    getSubscriptionByEmail,
    stripeEnabled = false,
    listCustomers,
    listSubscriptions,
    planForPriceId = () => null,
    onError = () => {},
  } = deps;

  const clean = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!clean) return noneEntitlement();

  // ---- 1. DODO (current processor) -------------------------------------
  // NOTE: this block is intentionally NOT gated on stripeEnabled. Gating the whole
  // function on Stripe configuration is the original bug; see entitlement.ts.
  /** @type {Entitlement|null} */
  let dodoFallback = null;
  if (typeof getSubscriptionByEmail === "function") {
    try {
      const ent = entitlementFromDodoRecord(await getSubscriptionByEmail(clean));
      if (ent) {
        if (ent.active) return ent;
        // Known Dodo customer, no live subscription (cancelled/expired). Remember it,
        // but still let a legacy Stripe subscription win if one is live.
        dodoFallback = ent;
      }
    } catch (err) {
      onError("dodo", err);
    }
  }

  // ---- 2. STRIPE (legacy cohort) ---------------------------------------
  /** @type {Entitlement|null} */
  let stripeFallback = null;
  if (stripeEnabled && typeof listCustomers === "function" && typeof listSubscriptions === "function") {
    try {
      const customers = (await listCustomers(clean)) ?? [];
      // A person may have more than one customer row (e.g. guest checkout); check each.
      for (const cust of customers) {
        const subs = (await listSubscriptions(cust.id)) ?? [];
        const live = subs.find((s) => LIVE_STRIPE_STATUS.has(s?.status));
        if (live) {
          const priceId = live.items?.data?.[0]?.price?.id ?? null;
          return /** @type {Entitlement} */ ({
            active: true,
            status: live.status,
            plan: planForPriceId(priceId),
            priceId,
            customerId: cust.id,
          });
        }
      }
      // Known Stripe customer, no live subscription (cancelled/expired).
      if (customers[0]) stripeFallback = { ...noneEntitlement(), customerId: customers[0].id };
    } catch (err) {
      onError("stripe", err);
    }
  }

  // Prefer the CURRENT processor's record when neither era is live.
  return dodoFallback ?? stripeFallback ?? noneEntitlement();
}
