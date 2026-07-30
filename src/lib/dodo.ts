/**
 * DODO PAYMENTS — server-side client + config for Mira subscriptions.
 *
 * Merchant-of-Record provider (replaces the Stripe money path). We talk to the
 * REST API directly with fetch (no SDK dependency) so the surface is small and
 * auditable. Verified API shape (docs.dodopayments.com, 2026-07):
 *   - Base URL:  https://test.dodopayments.com | https://live.dodopayments.com
 *   - Auth:      Authorization: Bearer <API key>
 *   - Create:    POST /subscriptions  { product_id, quantity, customer, billing,
 *                return_url, payment_link:true, metadata } → { payment_link, ... }
 *   - Webhooks:  Standard Webhooks spec (see dodo-webhook-core.mjs)
 *
 * Config (all from env / runtime.conf — NEVER hard-coded):
 *   DODO_API_KEY               the secret API key (env.txt: DODOPAYMENTS_API)
 *   DODO_MODE                  "test" | "live"  (default "test")
 *   DODO_PAYMENTS_LIVE         "1" to open the money path (fail-safe gate, mirrors
 *                              the Stripe PAYMENTS_LIVE pattern — coming-soon otherwise)
 *   DODO_PRODUCT_COMPANION     Dodo product id for the $14.99 tier
 *   DODO_PRODUCT_ASSISTANT     Dodo product id for the $39 tier
 *   DODO_PRODUCT_STUDIO        Dodo product id for the $79 tier
 *   DODO_WEBHOOK_SECRET        Standard-Webhooks signing secret (whsec_…)
 */

export type PaidPlan = "companion" | "assistant" | "studio";

const PRODUCT_ENV: Record<PaidPlan, string> = {
  companion: "DODO_PRODUCT_COMPANION",
  assistant: "DODO_PRODUCT_ASSISTANT",
  studio: "DODO_PRODUCT_STUDIO",
};

export function isPaidPlan(v: unknown): v is PaidPlan {
  return v === "companion" || v === "assistant" || v === "studio";
}

/** Dodo product id configured for a plan, or undefined if unset. */
export function productIdFor(plan: PaidPlan): string | undefined {
  return process.env[PRODUCT_ENV[plan]];
}

/** Reverse map: a Dodo product id → our plan, or null (never a guessed plan). */
export function planForProductId(productId: string | null | undefined): PaidPlan | null {
  if (!productId) return null;
  for (const plan of Object.keys(PRODUCT_ENV) as PaidPlan[]) {
    if (process.env[PRODUCT_ENV[plan]] && process.env[PRODUCT_ENV[plan]] === productId) {
      return plan;
    }
  }
  return null;
}

function dodoBaseUrl(): string {
  return process.env.DODO_MODE === "live"
    ? "https://live.dodopayments.com"
    : "https://test.dodopayments.com";
}

/**
 * Fail-safe gate — mirrors Stripe's paymentsConfigured(). Money path stays OFF
 * (checkout → "coming soon" 503) unless the API key AND the plan's product id
 * exist AND DODO_PAYMENTS_LIVE is explicitly "1". This keeps mira.vualet.com off
 * the money path until counsel/dashboard are ready, exactly like the Stripe gate.
 */
export function dodoConfigured(plan?: PaidPlan): boolean {
  if (!process.env.DODO_API_KEY) return false;
  if (process.env.DODO_PAYMENTS_LIVE !== "1") return false;
  if (plan && !productIdFor(plan)) return false;
  return true;
}

export function appUrl(): string {
  return process.env.MIRA_WEB_URL || "https://mira.vualet.com";
}

export interface DodoCheckoutInput {
  plan: PaidPlan;
  email?: string;
  connectToken: string;
  /** ISO country code for MoR tax (billing.country is required by Dodo). */
  country?: string;
}

/**
 * Create a subscription payment link for a Mira plan. Carries connect_token +
 * plan in metadata so the webhook can bind the purchase to the Telegram bot and
 * activate the correct tier (same contract as the Stripe path). Returns the
 * hosted checkout URL. Throws on a non-2xx or a missing payment_link.
 */
export async function createDodoCheckout(input: DodoCheckoutInput): Promise<{ url: string; subscriptionId?: string }> {
  const apiKey = process.env.DODO_API_KEY;
  if (!apiKey) throw new Error("DODO_API_KEY unset");
  const productId = productIdFor(input.plan);
  if (!productId) throw new Error(`no Dodo product id configured for plan ${input.plan}`);

  const body = {
    product_id: productId,
    quantity: 1,
    payment_link: true,
    return_url: `${appUrl()}/mira/welcome?token=${input.connectToken}`,
    customer: input.email ? { email: input.email } : undefined,
    billing: { country: input.country || "AE" },
    metadata: { connect_token: input.connectToken, plan: input.plan },
  };

  const res = await fetch(`${dodoBaseUrl()}/subscriptions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Dodo create-subscription failed ${res.status}: ${detail.slice(0, 300)}`);
  }
  const json = (await res.json()) as { payment_link?: string; subscription_id?: string };
  if (!json.payment_link) throw new Error("Dodo returned no payment_link");
  return { url: json.payment_link, subscriptionId: json.subscription_id };
}
