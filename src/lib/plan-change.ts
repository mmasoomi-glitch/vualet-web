/**
 * Self-serve plan change — THE PURE DECISION LAYER ONLY.
 *
 * This module deliberately contains NO payment call. The proration and billing
 * semantics of a mid-cycle plan change are NOT invented here, because getting
 * them wrong moves real customer money. A plan change is a money-moving
 * operation in the same family as a refund, which this codebase already keeps
 * behind human approval (see `refundDodoPayment` in src/lib/dodo.ts).
 *
 * It performs no I/O, makes no network call and imports nothing, so every rule
 * below is testable without a payment processor.
 */

export type Plan = "free" | "companion" | "assistant" | "studio";

export type PlanChangeKind = "upgrade" | "downgrade" | "noop" | "unknown_current";

export function planRank(plan: Plan): number {
  if (plan === "free") return 0;
  if (plan === "companion") return 1;
  if (plan === "assistant") return 2;
  if (plan === "studio") return 3;
  return -1;
}

export function isPlan(v: unknown): v is Plan {
  return v === "free" || v === "companion" || v === "assistant" || v === "studio";
}

export type PlanChangeRequest = {
  current: Plan;
  target: Plan;
  status: string;
  hasSubscriptionId: boolean;
};

// MISSING GUARD: refusing a change on a subscription that is already set to
// cancel at period end. That guard IS wanted — without it, changing the plan
// silently resurrects billing the customer deliberately stopped. It was removed
// rather than left inert because `ConnectRecord` carries no cancel-at-period-end
// field, so the only caller could pass nothing but a hardcoded `false` and the
// branch could never fire. A guard that cannot fire is worse than no guard,
// because the next reader assumes it protects them. REINSTATE THIS as the first
// check after the plan checks when the record gains that field.

export type PlanChangeDecision = {
  allowed: boolean;
  kind: PlanChangeKind;
  reason: string;
  requiresPayment: boolean;
  requiresNewCheckout: boolean;
};

export function decidePlanChange(req: PlanChangeRequest): PlanChangeDecision {
  // The type says these cannot happen. Values arriving from a request body and
  // from a stored record are not bound by the type, so reject rather than trust.
  // The two are kept distinct deliberately: an unrecognised STORED plan is our
  // own data problem and must be visible as such, whereas an unrecognised
  // REQUESTED plan is just bad caller input.
  if (!isPlan(req.current)) {
    return {
      allowed: false,
      kind: "unknown_current",
      reason: "The plan stored against this customer is not one we recognise; someone needs to look at the record.",
      requiresPayment: false,
      requiresNewCheckout: false,
    };
  }

  if (!isPlan(req.target)) {
    return {
      allowed: false,
      kind: "noop",
      reason: "The requested plan is not one we offer.",
      requiresPayment: false,
      requiresNewCheckout: false,
    };
  }

  // Nothing to do, and charging for it would be indefensible.
  if (req.target === req.current) {
    return {
      allowed: false,
      kind: "noop",
      reason: "The customer is already on that plan.",
      requiresPayment: false,
      requiresNewCheckout: false,
    };
  }

  // Past due, paused or cancelled subscriptions need a human. Case-insensitive
  // because the processor's casing is not ours to rely on.
  const status = req.status.toLowerCase();
  if (status !== "active" && status !== "trialing") {
    return {
      allowed: false,
      kind: "noop",
      reason: `The subscription is ${req.status || "in an unknown state"}, so it cannot be changed without a human.`,
      requiresPayment: false,
      requiresNewCheckout: false,
    };
  }

  // There is no subscription to modify, so this has to go through checkout —
  // true even if a stale subscription id is somehow attached to the record.
  if (req.current === "free") {
    return {
      allowed: true,
      kind: "upgrade",
      reason: "Moving off the free plan starts a new subscription, so it goes through checkout.",
      requiresPayment: true,
      requiresNewCheckout: true,
    };
  }

  // Dropping to free is a cancellation by another name; the customer keeps what
  // they paid for until the period ends.
  if (req.target === "free") {
    return {
      allowed: true,
      kind: "downgrade",
      reason: "Moving to the free plan is a cancellation at the end of the paid period.",
      requiresPayment: false,
      requiresNewCheckout: false,
    };
  }

  // Paid-to-paid modifies an existing subscription, so we must actually have one.
  if (!req.hasSubscriptionId) {
    return {
      allowed: false,
      kind: "noop",
      reason: "No subscription id is on file, so there is nothing to change.",
      requiresPayment: false,
      requiresNewCheckout: false,
    };
  }

  const isUpgrade = planRank(req.target) > planRank(req.current);

  return {
    allowed: true,
    kind: isUpgrade ? "upgrade" : "downgrade",
    reason: isUpgrade
      ? "Upgrading between paid plans modifies the existing subscription."
      : "Downgrading between paid plans modifies the existing subscription.",
    requiresPayment: isUpgrade,
    requiresNewCheckout: false,
  };
}
