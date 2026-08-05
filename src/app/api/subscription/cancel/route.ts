import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getSubscriptionByEmail, putSubscription } from "@/lib/store";
import { cancelDodoSubscription } from "@/lib/dodo";

/**
 * Self-serve subscription cancellation (defect E, jury verdict #102).
 *
 * Before this existed, a customer charged through Dodo had NO way to stop being
 * billed: /api/portal is Stripe-only and src/lib/dodo.ts had no cancel path at
 * all. A real customer wrote in unable to cancel, and the published
 * /legal/refund page promised something the code did not implement.
 *
 * Design constraints the jury set:
 *  - CANCELLING is the customer's own right -> self-serve, no human in the loop.
 *  - REFUNDING moves real money out -> NOT here. Refunds are a recorded request
 *    that a human approves; see /api/subscription/refund-request.
 *
 * Anti-IDOR: the subscription is resolved ONLY from the verified session email.
 * The caller cannot pass a customer id, subscription id, or email — so there is
 * nothing to tamper with and no way to enumerate or cancel someone else's plan.
 * (The old portal route had exactly this bug; its own comment records it.)
 *
 * Cancels at period end by default: the customer keeps what they already paid
 * for, and only future billing stops.
 */
export async function POST() {
  const session = await getSession();
  if (!session?.email) {
    return NextResponse.json(
      { error: "not_signed_in", message: "Sign in to manage your plan." },
      { status: 401 },
    );
  }

  const found = await getSubscriptionByEmail(session.email);

  // No record: either they never subscribed, or they predate the email index.
  // Fail closed and route them to a human rather than guessing at a record —
  // a wrong guess here cancels the wrong person's subscription.
  if (!found) {
    return NextResponse.json(
      {
        error: "no_subscription",
        message:
          "We couldn't find an active subscription for your account. Contact us and we'll sort it out right away.",
      },
      { status: 404 },
    );
  }

  const { customerId, rec } = found;

  if (rec.status === "cancelled") {
    // Idempotent: cancelling twice is not an error.
    return NextResponse.json({ ok: true, alreadyCancelled: true, status: "cancelled" });
  }

  // Provider-aware. Dodo-era subscriptions cancel here; Stripe-era customers
  // predate Dodo and still have the Stripe billing portal, so send them there
  // rather than calling the wrong provider's API with an id it never issued.
  if (!rec.subscriptionId) {
    return NextResponse.json(
      {
        error: "manual_required",
        message:
          "Your plan needs a quick manual cancellation. Contact us and we'll cancel it immediately.",
      },
      { status: 409 },
    );
  }

  try {
    await cancelDodoSubscription(rec.subscriptionId, {
      atPeriodEnd: true,
      comment: "Self-serve cancellation from the customer's account page.",
    });
  } catch (err) {
    console.error("[subscription/cancel] provider call failed:", err);
    return NextResponse.json(
      {
        error: "cancel_failed",
        message:
          "We couldn't cancel automatically. Contact us and we'll cancel it for you straight away.",
      },
      { status: 502 },
    );
  }

  // Only record the cancellation AFTER the provider confirmed it, so our state
  // can never claim "cancelled" while billing quietly continues.
  rec.status = "cancelled";
  await putSubscription(customerId, rec);

  return NextResponse.json({
    ok: true,
    status: "cancelled",
    message:
      "Cancelled. You keep everything you've paid for until the end of your current billing period, and you won't be charged again.",
  });
}
