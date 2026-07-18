import { NextResponse } from "next/server";
import { stripe, appUrl, paymentsConfigured } from "@/lib/stripe";
import { getSubscription } from "@/lib/store";

// Returns a Stripe billing-portal link so a subscriber can manage/cancel billing.
// Body: { customer_id }. Full auth lands with real accounts; until then we at
// least refuse portals for any customer id we have no subscription record for,
// so a guessed/scraped cus_… can't open a stranger's billing (was an open IDOR).
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

  // Only customers we actually recorded (via the Stripe webhook) may open a portal.
  const known = await getSubscription(customerId);
  if (!known) {
    return NextResponse.json({ error: "not_a_customer" }, { status: 403 });
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
