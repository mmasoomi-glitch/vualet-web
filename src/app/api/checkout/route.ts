import { NextResponse } from "next/server";
import { createDodoCheckout, dodoConfigured, isPaidPlan } from "@/lib/dodo";
import { putConnect, type ConnectRecord } from "@/lib/store";
import { mintConnectToken } from "@/lib/connect-token";
import { validatePromo, type PromoOk } from "@/lib/promo";

// Creates a Dodo Payments subscription checkout for a Mira plan and returns its url.
// Merchant-of-Record provider (replaced Stripe). Carries a connect_token so the
// purchase binds to the Telegram bot after payment (see /api/webhooks/dodo).
// Body: { plan, email, persona?, country?, promoCode? }
// When a valid 100%-off promotion code is supplied, the Dodo checkout is skipped
// entirely and the connect record is activated directly (no charge, no payment link).
export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: {
    plan?: string; email?: string; name?: string; persona?: string;
    country?: string; promoCode?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { plan, email, name, persona, country, promoCode } = body;
  if (!isPaidPlan(plan)) {
    return NextResponse.json(
      { error: "Unknown plan. Pick companion, assistant, or studio." },
      { status: 400 },
    );
  }

  // A paid order MUST carry a real customer email. Without one, dodo.ts falls
  // back to a shared hardcoded identity ("guest@vualet.com"), which collapses
  // every paying customer into one fake record — unidentifiable, unable to sign
  // in, and impossible to resolve entitlement for. /mira/checkout marks the
  // field required, but a browser-side attribute is not a guard: this is the
  // server-side one. Fail closed. (Defect B, jury #101.)
  const cleanEmail = typeof email === "string" ? email.trim() : "";
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(cleanEmail) || cleanEmail.length > 200) {
    return NextResponse.json(
      { error: "email_required", message: "Enter your email address to continue." },
      { status: 400 },
    );
  }

  // ── Promotion code ──────────────────────────────────────────────────────
  // Defect A (jury #120): the checkout form sends promoCode in the body, but
  // this route never read it — the customer was told $0 and then charged full
  // price. Now: if a 100%-off code is validated server-side, we skip the Dodo
  // checkout entirely and activate the connect record directly (no charge).
  // Partial discounts are rejected because Dodo has no native promo-code API;
  // the customer is routed to contact us for manual application.
  const promoCodeNorm = typeof promoCode === "string" ? promoCode.trim() : "";
  if (promoCodeNorm) {
    // Only available when the kill-switch is lifted (PROMO_CODES_ENABLED=1) and
    // Stripe is configured (the promo system validates against Stripe).
    if (process.env.PROMO_CODES_ENABLED !== "1") {
      return NextResponse.json(
        {
          error: "promo_unavailable",
          message: "Discount codes are temporarily unavailable. Contact us and we'll apply it manually.",
        },
        { status: 503 },
      );
    }

    let promoResult: PromoOk | { valid: false; reason: string };
    try {
      promoResult = await validatePromo(promoCodeNorm, plan);
    } catch (err) {
      console.error("[checkout] promo validation failed:", err);
      return NextResponse.json(
        { error: "promo_error", message: "Couldn't verify that code. Try again." },
        { status: 502 },
      );
    }

    if (!promoResult.valid) {
      return NextResponse.json(
        { error: "invalid_promo", message: promoResult.reason },
        { status: 400 },
      );
    }

    // 100%-off: activate directly. The customer never visits a payment page.
    if (promoResult.total === 0) {
      const token = mintConnectToken();
      const record: ConnectRecord = {
        token,
        plan,
        email: cleanEmail,
        status: "active", // no payment needed — already "paid" by the code
        persona,
        createdAt: new Date().toISOString(),
      };
      try {
        await putConnect(record);
        return NextResponse.json({
          url: null, // no checkout URL — the frontend redirects to welcome
          zeroCharge: true,
          token,
          plan,
          message: "Code applied — your plan is active.",
        });
      } catch (err) {
        console.error("[checkout] zero-charge connect failed:", err);
        return NextResponse.json(
          { error: "checkout_failed", message: "Couldn't activate your plan. Try again." },
          { status: 502 },
        );
      }
    }

    // Partial discount: Dodo has no native promo-code API, so we cannot apply
    // a non-100% discount to the charge. Be honest rather than silent.
    return NextResponse.json(
      {
        error: "partial_discount_unsupported",
        message:
          `This code gives you ${promoResult.label} off, but partial discounts aren't available through checkout yet. Contact us and we'll apply it manually.`,
      },
      { status: 409 },
    );
  }

  if (!dodoConfigured(plan)) {
    // Fail-safe: pre-keys / product-ids-unset → don't 500 the funnel; the UI
    // shows "coming soon". Money path opens only when DODO_API_KEY + the plan's
    // DODO_PRODUCT_* id exist AND DODO_PAYMENTS_LIVE=1.
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
    email: cleanEmail,
    status: "pending",
    persona,
    createdAt: new Date().toISOString(),
  };

  try {
    await putConnect(record);
    const { url } = await createDodoCheckout({ plan, email: cleanEmail, name, connectToken: token, country });
    return NextResponse.json({ url });
  } catch (err) {
    console.error("[checkout] dodo failed:", err);
    return NextResponse.json(
      { error: "checkout_failed", message: "Couldn't start checkout. Try again." },
      { status: 502 },
    );
  }
}
