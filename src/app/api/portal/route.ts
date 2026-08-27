import { NextResponse } from "next/server";
import { stripe, appUrl, paymentsConfigured } from "@/lib/stripe";
import { getSession } from "@/lib/session";
import { getSubscriptionByEmail } from "@/lib/store";

/**
 * Self-serve Stripe billing portal (manage payment method, view invoices, cancel).
 *
 * ANTI-IDOR (jury #125, P0-W3): the subscription is resolved ONLY from the verified
 * session email. The caller cannot pass a customer id, subscription id, or email —
 * so there is nothing to tamper with and no way to open a stranger's billing portal.
 * The old version took customer_id from the request body, which let anyone who knew
 * any customer id open that customer's portal. That is fixed here.
 *
 * The payment processor has changed and self-serve billing management is no longer
 * available through this endpoint. In production, `paymentsConfigured()` is permanently
 * false, so the 503 branch below is the permanent production path rather than a
 * temporary "not configured yet" state. Cancellation deliberately lives at
 * `/api/subscription/cancel` and remains fully working.
 */
export async function POST() {
  if (!paymentsConfigured()) {
    return NextResponse.json({
      error: "not_configured",
      message: "Self-serve billing management is not available for this account. You can view your plan and cancel from the account page; for plan changes or card updates, please contact support."
    }, { status: 503 });
  }

  const session = await getSession();
  if (!session?.email) {
    return NextResponse.json(
      { error: "not_signed_in", message: "Sign in to manage your billing." },
      { status: 401 },
    );
  }

  // Resolve the subscription from the verified session email — never from a
  // client-supplied id. This is the anti-IDOR shape.
  const found = await getSubscriptionByEmail(session.email);
  if (!found) {
    return NextResponse.json(
      {
        error: "no_subscription",
        message:
          "We couldn't find a subscription for your account. Contact us and we'll sort it out right away.",
      },
      { status: 404 },
    );
  }

  const { customerId, rec } = found;

  // The Stripe billing portal only works for Stripe-era customers (those with a
  // Stripe customer id). Dodo-era customers manage their plan through the account
  // page instead.
  if (!rec.customerId) {
    return NextResponse.json(
      {
        error: "dodo_managed",
        message:
          "Your plan is managed through your account page. Visit /mira/account to manage or cancel your subscription.",
        redirect: `${appUrl()}/mira/account`,
      },
      { status: 409 },
    );
  }

  try {
    const portalSession = await stripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl()}/mira/account`,
    });
    if (!portalSession.url) throw new Error("Stripe returned no portal url.");
    return NextResponse.json({ url: portalSession.url });
  } catch (err) {
    console.error("[portal] failed:", err);
    return NextResponse.json(
      { error: "portal_failed", message: "Couldn't open billing portal.", redirect: `${appUrl()}/mira/account` },
      { status: 502 },
    );
  }
}
