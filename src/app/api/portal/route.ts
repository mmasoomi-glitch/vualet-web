import { NextResponse } from "next/server";
import { stripe, appUrl, paymentsConfigured } from "@/lib/stripe";
import { createDodoPortalSession } from "@/lib/dodo";
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

  // The Stripe configuration gate used to 503 the WHOLE route, which made the
  // Dodo portal below unreachable in production (Stripe is off for good). It
  // now guards only the legacy Stripe-era branch it actually protects; the
  // truthful 503 copy is preserved for those customers.
  if (rec.customerId && !paymentsConfigured()) {
    return NextResponse.json({
      error: "not_configured",
      message: "Self-serve billing management is not available for this account. You can view your plan and cancel from the account page; for plan changes or card updates, please contact support."
    }, { status: 503 });
  }

  // Dodo-era customers (no legacy Stripe customer id) get Dodo's hosted
  // customer portal. The session call NEVER throws (it returns null on any
  // failure), so a Dodo outage degrades to exactly the pre-existing account
  // page redirect rather than an error the customer cannot act on.
  if (!rec.customerId) {
    const portalUrl = await createDodoPortalSession(customerId);
    if (portalUrl) {
      return NextResponse.json({ url: portalUrl });
    }
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
