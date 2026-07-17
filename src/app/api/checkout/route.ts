import { NextResponse } from "next/server";
import { stripe, priceIdFor, isPaidPlan, appUrl, paymentsConfigured } from "@/lib/stripe";
import { putConnect, type ConnectRecord } from "@/lib/store";
import { mintConnectToken } from "@/lib/connect-token";

// Creates a Stripe Checkout session (subscription) for a Mira plan and returns its url.
// Body: { plan: "companion" | "assistant" | "studio", email?, persona? }
export async function POST(req: Request) {
  let body: { plan?: string; email?: string; persona?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { plan, email, persona } = body;
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

  try {
    await putConnect(record);

    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceIdFor(plan), quantity: 1 }],
      customer_email: email || undefined,
      metadata: { connect_token: token, plan, persona: persona ?? "" },
      // Carry the token onto the subscription too, so renewal webhooks can find it.
      subscription_data: { metadata: { connect_token: token, plan } },
      automatic_tax: { enabled: true },
      billing_address_collection: "required",
      success_url: `${appUrl()}/mira/welcome?token=${token}`,
      cancel_url: `${appUrl()}/mira/plans`,
    });

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
