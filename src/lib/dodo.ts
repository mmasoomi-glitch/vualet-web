import DodoPayments from "dodopayments";

/**
 * Dodo Payments client + plan→product mapping.
 *
 * Money-in runs entirely through Dodo (merchant of record — it handles global
 * tax/VAT, cards, and the hosted customer portal). We never store card data.
 *
 * Required env (see .env.example):
 *   DODO_PAYMENTS_API_KEY   — secret API key
 *   DODO_ENVIRONMENT        — "test_mode" | "live_mode" (default test_mode)
 *   DODO_PRODUCT_COMPANION  — Dodo product id for the $19 plan
 *   DODO_PRODUCT_ASSISTANT  — Dodo product id for the $59 plan
 *   DODO_PRODUCT_STUDIO     — Dodo product id for the $199 plan
 *   DODO_WEBHOOK_SECRET     — Standard Webhooks signing secret
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

export function productIdFor(plan: PaidPlan): string {
  const id = process.env[PRODUCT_ENV[plan]];
  if (!id) {
    throw new Error(
      `Missing ${PRODUCT_ENV[plan]} — create the "${plan}" product in Dodo and set its id in env.`,
    );
  }
  return id;
}

let _client: DodoPayments | null = null;

export function dodo(): DodoPayments {
  if (_client) return _client;
  const bearerToken = process.env.DODO_PAYMENTS_API_KEY;
  if (!bearerToken) {
    throw new Error("Missing DODO_PAYMENTS_API_KEY — add it in env to take payments.");
  }
  const environment =
    process.env.DODO_ENVIRONMENT === "live_mode" ? "live_mode" : "test_mode";
  _client = new DodoPayments({ bearerToken, environment });
  return _client;
}

/** True when payments are configured — lets the UI degrade gracefully pre-keys. */
export function paymentsConfigured(): boolean {
  return Boolean(process.env.DODO_PAYMENTS_API_KEY);
}

/** Absolute app origin for return_url / portal redirects. */
export function appUrl(): string {
  return (
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://mira.vualet.com"
  ).replace(/\/$/, "");
}
