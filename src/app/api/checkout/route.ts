import { NextResponse } from "next/server";
import { stripe, priceIdFor, isPaidPlan, appUrl, paymentsConfigured } from "@/lib/stripe";
import { putConnect, type ConnectRecord } from "@/lib/store";
import { mintConnectToken } from "@/lib/connect-token";
import { validatePromo } from "@/lib/promo";
import type Stripe from "stripe";

// Creates a Stripe Checkout session (subscription) for a Mira plan and returns its url.
// Body: { plan: "companion" | "assistant" | "studio", email?, persona?, promoCode? }
export async function POST(req: Request) {
  let body: { plan?: string; email?: string; persona?: string; promoCode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { plan, email, persona, promoCode } = body;
  if (!isPaidPlan(plan)) {
    return NextResponse.json(
      { error: "Unknown plan. Pick companion, assistant, or studio." },
      { status: 400 },
    );
  }

  if (!paymentsConfigured()) {
    // Pre-keys: don't 500 the funnel — tell the UI to show "coming soon".
    return NextResponse.json(
      { error: "not_configured", message: "Payments aren't switched on yet." },
      { status: 503 },
    );
  }

  // Token that ties this purchase to the Telegram bot after payment.
  const token = mintConnectToken();
  const record: ConnectRecord = {
    token,
    plan,
    email,
    status: "pending",
    persona,
    createdAt: new Date().toISOString(),
  };

  // Re-validate any pre-entered promo code SERVER-SIDE (never trust the browser).
  // If a code was supplied but no longer checks out, stop rather than silently
  // charging full price — the client re-checks and shows the reason.
  let appliedPromoId: string | null = null;
  if (typeof promoCode === "string" && promoCode.trim() !== "") {
    const promo = await validatePromo(promoCode, plan);
    if (!promo.valid) {
      return NextResponse.json(
        { error: "promo_invalid", message: promo.reason || "That promotion code is no longer valid." },
        { status: 400 },
      );
    }
    appliedPromoId = promo.promotion_code_id;
  }

  try {
    await putConnect(record);

    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      line_items: [{ price: priceIdFor(plan), quantity: 1 }],
      customer_email: email || undefined,
      metadata: { connect_token: token, plan, persona: persona ?? "" },
      // Carry the token onto the subscription too, so renewal webhooks can find it.
      // 14-day free trial: card is collected but not charged until day 14, which
      // is what the Refund Policy + marketing promise ("no charge during trial").
      subscription_data: { metadata: { connect_token: token, plan }, trial_period_days: 14 },
      automatic_tax: { enabled: true },
      billing_address_collection: "required",
      success_url: `${appUrl()}/mira/welcome?token=${token}`,
      cancel_url: `${appUrl()}/mira/plans`,
    };

    if (appliedPromoId) {
      // Pre-apply the validated code so the Stripe page needs no re-entry.
      // discounts and allow_promotion_codes are mutually exclusive.
      params.discounts = [{ promotion_code: appliedPromoId }];
    } else {
      // No pre-applied code: still let testers/customers enter one on the
      // Stripe-hosted checkout — validated server-side by Stripe.
      params.allow_promotion_codes = true;
    }

    const session = await stripe().checkout.sessions.create(params);

    const url = session.url;
    if (!url) throw new Error("Stripe returned no checkout url.");
    return NextResponse.json({ url });
  } catch (err) {
    console.error("[checkout] failed:", err);
    return NextResponse.json(
      { error: "checkout_failed", message: "Couldn't start checkout. Try again." },
      { status: 502 },
    );
  }
}
