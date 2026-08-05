import { NextResponse } from "next/server";
import { createDodoCheckout, dodoConfigured, isPaidPlan } from "@/lib/dodo";
import { putConnect, type ConnectRecord } from "@/lib/store";
import { mintConnectToken } from "@/lib/connect-token";

// Creates a Dodo Payments subscription checkout for a Mira plan and returns its url.
// Merchant-of-Record provider (replaced Stripe). Carries a connect_token so the
// purchase binds to the Telegram bot after payment (see /api/webhooks/dodo).
// Body: { plan: "companion" | "assistant" | "studio", email?, persona?, country? }
export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { plan?: string; email?: string; name?: string; persona?: string; country?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { plan, email, name, persona, country } = body;
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
