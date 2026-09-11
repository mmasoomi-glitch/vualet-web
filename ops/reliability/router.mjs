// Assistant reliability — provider routing and bounded self-recovery.
//
// A PURE DECISION MODULE. It chooses which provider a request should use and
// what to tell the customer; it does not call anything and does not fail over
// by itself. The caller acts on the verdict. Keeping the decision separate is
// what makes every rule below testable without a network.
//
// The real topology:
//   primary   — the self-hosted pod. Free, fastest, and it is one machine.
//   secondary — a paid API, billed PER CALL. A failover target, never a default.
//   kb        — a deterministic grounded answer. Always available, cannot answer
//               general questions. The last resort.
//
// THE USER NOTICE IS CUSTOMER-FACING COPY. It must never leak a vendor, a
// model, a host, a status code or an internal state name.

import { STATES } from './state-machine.mjs';

export const USER_NOTICES = Object.freeze({
  ON_SECONDARY:
    "I'm running on a backup system right now, so answers may be a little slower than usual.",
  ON_KB:
    "I can still answer questions about Mira right now, but my general knowledge is briefly unavailable.",
});

export const RECOVERY_POLICY = Object.freeze({
  baseBackoffMs: 30000,
  maxBackoffMs: 900000,
  maxRecoveryAttempts: 6,
});

const NOTHING_CONFIGURED = 'No provider is configured; falling back to the knowledge base.';

/** An unrecognised state must not crash a request path — treat it as UNKNOWN. */
function normaliseState(state) {
  return STATES[state] || STATES.UNKNOWN;
}

function onSecondary(reason) {
  return { target: 'secondary', reason, degraded: true, userNotice: USER_NOTICES.ON_SECONDARY };
}

function onKb(reason) {
  return { target: 'kb', reason, degraded: true, userNotice: USER_NOTICES.ON_KB };
}

export function chooseProvider(input) {
  const { state, providers } = input || {};
  const current = normaliseState(state);

  const hasPrimary = !!(providers && providers.primary === true);
  const hasSecondary = !!(providers && providers.secondary === true);
  const hasKb = !!(providers && providers.kb === true);

  const failed = current === STATES.FAILOVER_ACTIVE || current === STATES.OFFLINE;

  if (!failed && hasPrimary) {
    // DEGRADED deliberately stays on primary: a slow assistant that answers is
    // better than moving every request onto a provider billed per call.
    // UNKNOWN stays on primary too — refusing to serve because a probe has not
    // run yet would turn a monitoring gap into a self-inflicted outage.
    return {
      target: 'primary',
      reason: `Primary is serving (state ${current}).`,
      degraded: false,
      userNotice: null,
    };
  }

  if (hasSecondary) {
    return onSecondary(
      failed ? `Primary is ${current}; routing to the paid fallback.` : 'Primary is not configured.',
    );
  }
  if (hasKb) {
    return onKb(
      failed
        ? `Primary is ${current} and no secondary is configured.`
        : 'Neither primary nor secondary is configured.',
    );
  }
  // Answering something grounded beats answering nothing, so this never throws.
  return onKb(NOTHING_CONFIGURED);
}

/**
 * Bounded self-recovery: may the caller retry the primary yet?
 *
 * The bound is the important part. Retrying a dead provider forever burns money
 * on the paid fallback and hides the fault behind a self-healing illusion that
 * never actually heals — after the budget is spent this reports that a human is
 * needed and stops.
 */
export function shouldAttemptRecovery(tracker, policy, nowMs) {
  const p = policy || RECOVERY_POLICY;
  const baseBackoffMs = typeof p.baseBackoffMs === 'number' ? p.baseBackoffMs : RECOVERY_POLICY.baseBackoffMs;
  const maxBackoffMs = typeof p.maxBackoffMs === 'number' ? p.maxBackoffMs : RECOVERY_POLICY.maxBackoffMs;
  const maxRecoveryAttempts =
    typeof p.maxRecoveryAttempts === 'number' ? p.maxRecoveryAttempts : RECOVERY_POLICY.maxRecoveryAttempts;

  if (!tracker || typeof tracker !== 'object') {
    return { attempt: false, reason: 'No tracker to reason about.', nextEligibleAtMs: null };
  }

  const current = normaliseState(tracker.state);
  if (current !== STATES.FAILOVER_ACTIVE && current !== STATES.OFFLINE) {
    return {
      attempt: false,
      reason: `Nothing to recover from in state ${current}.`,
      nextEligibleAtMs: null,
    };
  }

  // A missing or malformed count must mean "none so far", never NaN — NaN would
  // silently make every comparison below false and quietly disable recovery.
  const attempts =
    typeof tracker.recoveryAttempts === 'number' && Number.isFinite(tracker.recoveryAttempts)
      ? tracker.recoveryAttempts
      : 0;

  if (attempts >= maxRecoveryAttempts) {
    return {
      attempt: false,
      reason: `Recovery budget spent after ${attempts} attempts; this needs a human.`,
      nextEligibleAtMs: null,
    };
  }

  const lastFailureAt =
    typeof tracker.lastFailureAt === 'number' && Number.isFinite(tracker.lastFailureAt)
      ? tracker.lastFailureAt
      : null;

  if (lastFailureAt === null) {
    return { attempt: true, reason: 'No recorded failure to back off from.', nextEligibleAtMs: nowMs };
  }

  const delay = Math.min(baseBackoffMs * 2 ** attempts, maxBackoffMs);
  const nextEligibleAtMs = lastFailureAt + delay;

  if (nowMs >= nextEligibleAtMs) {
    return {
      attempt: true,
      reason: `Backoff of ${delay}ms has elapsed; attempt ${attempts + 1} of ${maxRecoveryAttempts}.`,
      nextEligibleAtMs,
    };
  }
  return {
    attempt: false,
    reason: `Backing off ${delay}ms after attempt ${attempts}.`,
    nextEligibleAtMs,
  };
}

/**
 * One line for a log or an ops dashboard. Unlike the user notice this MAY name
 * the state and the target, because that is exactly what an operator needs. It
 * only ever reads state, target, reason, recoveryAttempts and incidentId, so
 * there is no path by which a key or a customer message reaches a log line.
 */
export function describeForOperator(decision, tracker) {
  const d = decision || {};
  const t = tracker && typeof tracker === 'object' ? tracker : null;
  const state = t && t.state ? t.state : 'UNKNOWN';
  const attempts = t && typeof t.recoveryAttempts === 'number' ? t.recoveryAttempts : 0;
  const incident = t && t.incidentId ? t.incidentId : 'none';
  return `assistant route=${d.target || 'none'} state=${state} degraded=${d.degraded === true} attempts=${attempts} incident=${incident} reason="${d.reason || ''}"`;
}
