import { NextResponse } from "next/server";
import { dodo, productIdFor, isPaidPlan, appUrl, paymentsConfigured } from "@/lib/dodo";
import { putConnect, type ConnectRecord } from "@/lib/store";

// Creates a Dodo hosted-checkout session for a Mira plan and returns its url.
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
  const token = crypto.randomUUID();
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

    const session = await dodo().checkoutSessions.create({
      product_cart: [{ product_id: productIdFor(plan), quantity: 1 }],
      customer: email ? { email, name: email.split("@")[0] } : undefined,
      metadata: { connect_token: token, plan, persona: persona ?? "" },
      return_url: `${appUrl()}/mira/welcome?token=${token}`,
    });

    const url = (session as { checkout_url?: string }).checkout_url;
    if (!url) throw new Error("Dodo returned no checkout_url.");
    return NextResponse.json({ url });
  } catch (err) {
    console.error("[checkout] failed:", err);
    return NextResponse.json(
      { error: "checkout_failed", message: "Couldn't start checkout. Try again." },
      { status: 502 },
    );
  }
}
