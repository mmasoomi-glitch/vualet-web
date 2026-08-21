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
 * ── WHY THIS ROUTE NO LONGER WRITES status: "cancelled" (gotchas#263, decisions#342 Q_C)
 *
 * The two halves of a cancellation used to disagree, and only one of them gated
 * access. The provider call below sends `atPeriodEnd: true` — Dodo really does
 * keep serving the customer to the end of the period they already bought. But
 * the very next line stamped the local record `status: "cancelled"`, and
 * src/lib/entitlement-core.mjs grants web access on the literal string "active"
 * and nothing else (LIVE_DODO_STATUS). So the response promised "you keep
 * everything you have paid for until the end of your current billing period"
 * while the same request took it away on the spot. Someone who paid for a month
 * and cancelled on day 2 lost the other 28 days. Nothing errored; the two
 * systems simply held different beliefs and only one of them gated access.
 *
 * The rule the judge set is: ACCESS IS GATED ON PERIOD-END, NOT ON
 * CANCELLATION-FLAG TIMING. So a cancel-at-period-end records the INTENT
 * (`cancelAtPeriodEnd`, src/lib/store.ts) and leaves `status` exactly as it
 * found it. Entitlement is unchanged by clicking cancel — as it should be,
 * because clicking cancel does not end the period.
 *
 * NOTE what "leaves status exactly as it found it" also rules out: this route
 * never WRITES "active" either. Promoting the status would hand access back to
 * a paused, on-hold or refunded customer who happened to click cancel — the
 * mirror-image bug. Cancelling is entitlement-neutral in BOTH directions.
 *
 * WHO REVOKES, THEN? The Dodo webhook. DODO_EVENT_EFFECTS in
 * src/lib/dodo-webhook-core.mjs maps `subscription.cancelled` and
 * `subscription.expired` to a revoke -> status "cancelled". That fires when the
 * period ACTUALLY ends, which is the moment we were previously guessing at.
 * This route deliberately does not build a second scheduler; there is already a
 * home for the revocation, and two of them would only be able to disagree.
 */

/**
 * Month names for humanDate below.
 *
 * Deliberately not toLocaleDateString: no ICU dependency, and the date is built
 * from UTC parts so a period ending just after midnight UTC is never reported
 * as the previous day because the server happens to run in a western zone —
 * that is the same off-by-a-day family as the bug this file fixes.
 */
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function humanDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

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

  // ── Idempotency: two clicks must not corrupt state, and must not re-bill ──
  // There are now TWO shapes of "already cancelled" and both short-circuit
  // BEFORE the provider call:
  //   1. status "cancelled" — the subscription has actually ended (the webhook
  //      wrote it when the period ran out, or the record predates this fix).
  //   2. cancelAtPeriodEnd — the end is scheduled and the period is still live.
  // Without (2) a second click would reach Dodo a second time; the flag is the
  // durable memory that the first click already happened.
  if (rec.status === "cancelled") {
    // Idempotent: cancelling twice is not an error.
    return NextResponse.json({ ok: true, alreadyCancelled: true, status: "cancelled" });
  }

  if (rec.cancelAtPeriodEnd === true) {
    const already = humanDate(rec.currentPeriodEnd);
    return NextResponse.json({
      ok: true,
      alreadyCancelled: true,
      status: rec.status,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: rec.currentPeriodEnd ?? null,
      message: already
        ? `That's already done — your plan ends on ${already} and you won't be charged again.`
        : "That's already done — your plan ends at the end of the period you've paid for, and you won't be charged again.",
    });
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
  // can never claim the plan is ending while billing quietly continues.
  //
  // `rec.status` is READ in this route and never assigned. See the header: the
  // scheduled end is an intent, not a revocation.
  rec.cancelAtPeriodEnd = true;
  await putSubscription(customerId, rec);

  // WHEN WE DO NOT KNOW THE END DATE — a deliberate choice, not an oversight.
  // `currentPeriodEnd` is only ever copied from a provider payload
  // (periodFieldsFromDodo in dodo-webhook-core.mjs), and that payload's field
  // NAME is unverified against a live Dodo event, so that reader returns
  // NOTHING rather than risk a wrong date. A record can therefore legitimately
  // reach this line with no date at all, and this route cannot invent one: the
  // cancel PATCH response is not surfaced by cancelDodoSubscription, and
  // computing "now + a month" would be a guess that either confiscates paid
  // days or gives away unpaid ones.
  //
  // The two wrong answers, and why they are wrong:
  //   - REVOKE NOW because the date is unknown. That is exactly the bug being
  //     fixed, re-entered through the back door. Not knowing when the period
  //     ends is not evidence that it has ended.
  //   - GRANT FOREVER as a policy. That would be free service — but it is not
  //     what happens here. The webhook's subscription.cancelled/.expired revoke
  //     fires on the PROVIDER's timing and needs no date from us. The date is
  //     for TELLING the customer, never for gating them.
  // So: unknown date -> access continues (correct), revocation still arrives
  // from the webhook (correct), and the message simply stops naming a date.
  const when = humanDate(rec.currentPeriodEnd);

  // The message must match what the code actually did. Two things vary: whether
  // we can name the date, and whether this customer HAS access to keep — a
  // paused or on-hold record is not entitled today, so telling them they "keep
  // full access" would be the same species of false promise this fix removes.
  const entitled = rec.status === "active";
  let message: string;
  if (entitled && when) {
    message = `Cancelled. You keep full access until ${when} — the end of the period you've already paid for — and you won't be charged again.`;
  } else if (entitled) {
    message =
      "Cancelled. You keep full access until the end of the period you've already paid for, and you won't be charged again.";
  } else {
    message = "Cancelled. You won't be charged again.";
  }

  return NextResponse.json({
    ok: true,
    // The stored status is UNCHANGED and reported as-is. `cancelAtPeriodEnd` is
    // the new fact, carried in its own field rather than smuggled into
    // `status`, because on the Dodo path `status` IS the entitlement gate and
    // any value but "active" revokes (entitlement-core.mjs LIVE_DODO_STATUS).
    status: rec.status,
    cancelAtPeriodEnd: true,
    currentPeriodEnd: rec.currentPeriodEnd ?? null,
    message,
  });
}
