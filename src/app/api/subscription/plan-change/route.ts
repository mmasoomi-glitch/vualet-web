/**
 * Self-serve plan change — THE DECISION HALF.
 *
 * This route deliberately performs NO payment action. It reports whether a
 * change is permitted and what the next step is; it never calls the processor,
 * never mutates the subscription and never charges anyone.
 *
 * This codebase already keeps money-moving operations behind human approval —
 * `refundDodoPayment` in src/lib/dodo.ts carries that rule because a refund
 * moves money OUT. An upgrade moves money IN on identical reasoning, and the
 * proration semantics of a mid-cycle change are an owner decision, so they are
 * not invented here.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getSubscriptionByEmail } from "@/lib/store";
import { decidePlanChange, isPlan, type Plan } from "@/lib/plan-change";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    let body: { target?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "invalid_json", message: "Request body must be valid JSON." },
        { status: 400 },
      );
    }

    const target = body.target;
    if (!isPlan(target)) {
      return NextResponse.json(
        { error: "unknown_plan", message: "Pick free, companion, assistant or studio." },
        { status: 400 },
      );
    }

    const session = await getSession();
    if (!session?.email) {
      return NextResponse.json(
        { error: "not_signed_in", message: "Sign in to change your plan." },
        { status: 401 },
      );
    }

    // ANTI-IDOR: the subscription is resolved ONLY from the verified session email.
    // The body must never be able to name a customer, a subscription id, or an email.
    const found = await getSubscriptionByEmail(session.email);
    if (!found) {
      return NextResponse.json(
        { error: "no_subscription", message: "We could not find a subscription for your account." },
        { status: 404 },
      );
    }

    // An unrecognised stored plan is treated as free rather than trusted.
    const current: Plan = isPlan(found.rec.plan) ? found.rec.plan : "free";

    // This record type does not carry a cancel-at-period-end flag, so the
    // conservative value is passed. The corresponding guard in decidePlanChange
    // is therefore inert until that field exists — it is not pretended to work.
    const decision = decidePlanChange({
      current,
      target,
      status: found.rec.status,
      cancelAtPeriodEnd: false,
      hasSubscriptionId: !!found.rec.subscriptionId,
    });

    if (!decision.allowed) {
      return NextResponse.json(
        {
          error: "change_not_allowed",
          kind: decision.kind,
          reason: decision.reason,
          current,
          target,
        },
        { status: 409 },
      );
    }

    const base = {
      ok: true as const,
      kind: decision.kind,
      reason: decision.reason,
      current,
      target,
      requiresPayment: decision.requiresPayment,
    };

    if (decision.requiresNewCheckout) {
      return NextResponse.json(
        { ...base, nextStep: "checkout", checkoutPath: `/mira/checkout?plan=${target}` },
        { status: 200 },
      );
    }

    if (target === "free") {
      // Dropping to free is a cancellation at period end. That endpoint already
      // exists and is already self-serve by jury ruling, so point at it rather
      // than duplicating the behaviour here.
      return NextResponse.json(
        { ...base, nextStep: "cancel", cancelPath: "/api/subscription/cancel" },
        { status: 200 },
      );
    }

    // Paid to paid. Deliberate: changing an existing paid subscription requires
    // proration semantics that are an owner decision, so the route reports the
    // decision rather than inventing the money movement.
    return NextResponse.json(
      { ...base, nextStep: "support", supportPath: "/contact" },
      { status: 200 },
    );
  } catch (err) {
    console.error("[plan-change] unexpected error:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
}
