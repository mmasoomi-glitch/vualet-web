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
  name?: string;
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

  // Dodo's `customer` is an untagged enum: a NEW customer needs email + name +
  // create_new_customer:true (bare {email} is rejected 422). Derive a display
  // name from the email local-part when the caller didn't supply one.
  const email = input.email;
  const name = input.name || (email ? email.split("@")[0] : "Mira Subscriber");
  const body = {
    product_id: productId,
    quantity: 1,
    payment_link: true,
    return_url: `${appUrl()}/mira/welcome?token=${input.connectToken}`,
    customer: email
      ? { email, name, create_new_customer: true }
      : { email: "guest@vualet.com", name: "Mira Subscriber", create_new_customer: true },
    billing: {
      country: input.country || "AE",
      city: "NA",
      state: "NA",
      street: "NA",
      zipcode: "00000",
    },
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

/**
 * Cancel a Dodo subscription (defect E, jury #102).
 *
 * Defaults to cancel_at_next_billing_date=true so the customer keeps what they
 * already paid for until the end of the period they bought — cancelling should
 * stop future billing, not confiscate the current month.
 *
 * PATCH /subscriptions/{id} — see Dodo API reference. cancel_reason is an enum;
 * "cancelled_by_customer" is the correct value for a self-serve cancellation.
 */
export async function cancelDodoSubscription(
  subscriptionId: string,
  opts: { atPeriodEnd?: boolean; comment?: string } = {},
): Promise<{ ok: true }> {
  const apiKey = process.env.DODO_API_KEY;
  if (!apiKey) throw new Error("DODO_API_KEY unset");
  if (!subscriptionId) throw new Error("subscriptionId required");

  const body: Record<string, unknown> = {
    cancel_at_next_billing_date: opts.atPeriodEnd !== false,
    cancel_reason: "cancelled_by_customer",
  };
  if (opts.comment) body.cancellation_comment = opts.comment.slice(0, 3000);

  const res = await fetch(`${dodoBaseUrl()}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Dodo cancel-subscription failed ${res.status}: ${detail.slice(0, 300)}`);
  }
  return { ok: true };
}

/**
 * Refund a Dodo payment (defect E, jury #102).
 *
 * DELIBERATELY NOT REACHABLE FROM A CUSTOMER-FACING ROUTE. The jury ruled that
 * cancellation is the customer's own right and may be self-serve, but a refund
 * moves real money OUT and is a fraud surface — so it stays behind human
 * approval. This function exists so an authorised operator path can call it;
 * do not wire it directly to an unauthenticated or customer-triggered endpoint.
 *
 * POST /refunds — payment_id is required; omitting items refunds the whole payment.
 */
export async function refundDodoPayment(
  paymentId: string,
  opts: { reason?: string } = {},
): Promise<{ refundId?: string; status?: string }> {
  const apiKey = process.env.DODO_API_KEY;
  if (!apiKey) throw new Error("DODO_API_KEY unset");
  if (!paymentId) throw new Error("paymentId required");

  const body: Record<string, unknown> = { payment_id: paymentId };
  if (opts.reason) body.reason = opts.reason.slice(0, 3000);

  const res = await fetch(`${dodoBaseUrl()}/refunds`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Dodo refund failed ${res.status}: ${detail.slice(0, 300)}`);
  }
  const json = (await res.json()) as { refund_id?: string; status?: string };
  return { refundId: json.refund_id, status: json.status };
}
