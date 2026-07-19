import Stripe from "stripe";
import { planForPriceId as planForPriceIdCore } from "@/lib/plan-core.mjs";

/**
 * Stripe client + plan→price mapping.
 *
 * Money-in runs through Stripe Checkout (subscriptions). Stripe handles cards
 * and, with Stripe Tax enabled, global tax/VAT on the session. We never store
 * card data.
 *
 * Required env (see .env.example):
 *   STRIPE_SECRET_KEY       — secret API key (sk_test_… / sk_live_…)
 *   STRIPE_PRICE_COMPANION  — Stripe price id for the $14.99 plan
 *   STRIPE_PRICE_ASSISTANT  — Stripe price id for the $39 plan
 *   STRIPE_PRICE_STUDIO     — Stripe price id for the $79 plan
 *   STRIPE_WEBHOOK_SECRET   — signing secret for the events webhook
 */

export type PaidPlan = "companion" | "assistant" | "studio";

const PRICE_ENV: Record<PaidPlan, string> = {
  companion: "STRIPE_PRICE_COMPANION",
  assistant: "STRIPE_PRICE_ASSISTANT",
  studio: "STRIPE_PRICE_STUDIO",
};

export function isPaidPlan(v: unknown): v is PaidPlan {
  return v === "companion" || v === "assistant" || v === "studio";
}

export function priceIdFor(plan: PaidPlan): string {
  const id = process.env[PRICE_ENV[plan]];
  if (!id) {
    throw new Error(
      `Missing ${PRICE_ENV[plan]} — create the "${plan}" price in Stripe and set its id in env.`,
    );
  }
  return id;
}

/**
 * Reverse of priceIdFor: given a Stripe price id, which plan is it? Used by the webhook to
 * detect an UPGRADE/DOWNGRADE (customer.subscription.updated carries the new price) so the
 * stored connect record's plan can be corrected and the engine picks up the new tier on its
 * next bind. Returns null for an unknown/unconfigured price id (caller must not guess a plan).
 */
export function planForPriceId(priceId: string | null | undefined): PaidPlan | null {
  // Delegate to the pure core (shared with scripts/tier-map-test.mjs) so the
  // mapping is tested exactly as production runs it. We only supply the live
  // env price ids here; the core does the priceId -> plan reverse lookup.
  const priceByPlan: Record<PaidPlan, string | undefined> = {
    companion: process.env[PRICE_ENV.companion],
    assistant: process.env[PRICE_ENV.assistant],
    studio: process.env[PRICE_ENV.studio],
  };
  return planForPriceIdCore(priceId, priceByPlan);
}

let _client: Stripe | null = null;

export function stripe(): Stripe {
  if (_client) return _client;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("Missing STRIPE_SECRET_KEY — add it in env to take payments.");
  }
  _client = new Stripe(secretKey);
  return _client;
}

/** True when payments are configured — lets the UI degrade gracefully pre-keys. */
export function paymentsConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** Absolute app origin for success_url / cancel_url redirects. */
export function appUrl(): string {
  return (
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://mira.vualet.com"
  ).replace(/\/$/, "");
}
