import { NextResponse } from "next/server";
import { stripe, appUrl, paymentsConfigured } from "@/lib/stripe";

// Returns a Stripe billing-portal link so a subscriber can manage/cancel billing.
// Body: { customer_id }  (until auth lands, the account page passes this through).
export async function POST(req: Request) {
  if (!paymentsConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  let customerId: string | undefined;
  try {
    customerId = (await req.json())?.customer_id;
  } catch {
    /* fall through */
  }
  if (!customerId) {
    return NextResponse.json({ error: "missing customer_id" }, { status: 400 });
  }

  try {
    const session = await stripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl()}/mira/account`,
    });
    if (!session.url) throw new Error("Stripe returned no portal url.");
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[portal] failed:", err);
    return NextResponse.json(
      { error: "portal_failed", message: "Couldn't open billing portal.", redirect: `${appUrl()}/mira/account` },
      { status: 502 },
    );
  }
}
