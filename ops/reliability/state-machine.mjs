// Assistant reliability — the core state machine.
//
// PURE: no imports, no I/O, no timers, no network, no Date.now(). The caller
// supplies every timestamp, so every transition is deterministic and testable.
//
// ALERTS FIRE ONLY ON STATE TRANSITIONS. A previous monitor wrote the same
// failure line 1212 times over four days and nobody acted on it. An alert that
// repeats on every probe is an alert nobody reads.

export const STATES = Object.freeze({
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  FAILOVER_ACTIVE: 'FAILOVER_ACTIVE',
  RECOVERING: 'RECOVERING',
  OFFLINE: 'OFFLINE',
  UNKNOWN: 'UNKNOWN',
});

export const DEFAULT_POLICY = Object.freeze({
  degradeAfterFailures: 1,
  failoverAfterFailures: 3,
  offlineAfterFailures: 5,
  recoverAfterSuccesses: 3,
  cooldownMs: 60000,
  latencyDegradedMs: 5000,
});

export function initialState(nowMs) {
  return {
    state: STATES.UNKNOWN,
    stateSince: nowMs,
    lastSuccessAt: null,
    lastFailureAt: null,
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    lastLatencyMs: null,
    lastError: null,
    recoveryAttempts: 0,
    incidentId: null,
    failoverEnteredAt: null,
  };
}

export function onProbe(tracker, probe, policy = DEFAULT_POLICY) {
  // Defensive: this runs on a timer and must never crash the monitor.
  if (!tracker || typeof tracker !== 'object') {
    tracker = initialState(probe && typeof probe.atMs === 'number' ? probe.atMs : 0);
  }
  if (!probe || typeof probe !== 'object') {
    // No clock is available here, so reuse the tracker's own. Never Date.now():
    // that would make this function non-deterministic and untestable.
    probe = { ok: false, atMs: tracker.stateSince || 0, error: 'no probe result' };
  }

  const now = probe.atMs;
  const isOk = probe.ok === true;
  const latency = probe.latencyMs;
  const error = probe.error || (isOk ? null : 'unknown error');
  const fallback = probe.fallbackAvailable === true;

  const next = { ...tracker };
  let reason = '';
  let targetState = tracker.state;

  if (isOk) {
    next.consecutiveFailures = 0;
    next.consecutiveSuccesses = tracker.consecutiveSuccesses + 1;
    next.lastSuccessAt = now;
    next.lastLatencyMs = latency != null ? latency : null;
    next.lastError = null;

    if (tracker.state !== STATES.HEALTHY) {
      // ANTI-OSCILLATION FIRST. The cooldown is checked BEFORE the recovery
      // hysteresis, otherwise the very first successful probe would move
      // FAILOVER_ACTIVE -> RECOVERING and the cooldown would never hold
      // anything. Successes still accumulate while we wait.
      if (
        tracker.state === STATES.FAILOVER_ACTIVE &&
        tracker.failoverEnteredAt != null &&
        now - tracker.failoverEnteredAt < policy.cooldownMs
      ) {
        targetState = STATES.FAILOVER_ACTIVE;
        reason = `Failover cooldown active (${policy.cooldownMs}ms required before switch-back)`;
      } else if (next.consecutiveSuccesses < policy.recoverAfterSuccesses) {
        // Hysteresis: one lucky probe must not declare recovery.
        targetState = STATES.RECOVERING;
        reason = `Recovering after ${next.consecutiveSuccesses}/${policy.recoverAfterSuccesses} successes`;
      } else {
        targetState = STATES.HEALTHY;
        reason = 'System recovered after sustained successful probes';
      }
    } else if (latency != null && latency > policy.latencyDegradedMs) {
      // A slow assistant is not a healthy one.
      targetState = STATES.DEGRADED;
      reason = `High latency detected: ${latency}ms`;
    } else {
      targetState = STATES.HEALTHY;
      reason = 'System healthy';
    }
  } else {
    next.consecutiveSuccesses = 0;
    next.consecutiveFailures = tracker.consecutiveFailures + 1;
    next.lastFailureAt = now;
    next.lastError = error;

    if (next.consecutiveFailures >= policy.offlineAfterFailures) {
      targetState = STATES.OFFLINE;
      reason = `Offline after ${next.consecutiveFailures} consecutive failures`;
    } else if (next.consecutiveFailures >= policy.failoverAfterFailures) {
      if (fallback) {
        targetState = STATES.FAILOVER_ACTIVE;
        reason = `Failover activated after ${next.consecutiveFailures} failures`;
      } else {
        // Declaring failover with no fallback would be a lie.
        targetState = STATES.OFFLINE;
        reason = `Offline after ${next.consecutiveFailures} failures (no fallback available)`;
      }
    } else if (next.consecutiveFailures >= policy.degradeAfterFailures) {
      targetState = STATES.DEGRADED;
      reason = `Degraded after ${next.consecutiveFailures} consecutive failures`;
    } else {
      targetState = tracker.state;
      reason = 'Failure recorded, state unchanged';
    }
  }

  if (targetState !== tracker.state) {
    next.state = targetState;
    next.stateSince = now;

    if (targetState === STATES.HEALTHY) {
      next.incidentId = null;
      next.failoverEnteredAt = null;
      next.recoveryAttempts = 0;
    } else if (targetState === STATES.FAILOVER_ACTIVE) {
      if (tracker.state !== STATES.FAILOVER_ACTIVE) {
        next.failoverEnteredAt = now;
        next.recoveryAttempts = tracker.recoveryAttempts + 1;
      }
      if (!next.incidentId) next.incidentId = `inc_${now}`;
    } else if (targetState === STATES.OFFLINE) {
      if (!next.incidentId) next.incidentId = `inc_${now}`;
    }
  }

  return {
    ...next,
    transition: {
      from: tracker.state,
      to: targetState,
      changed: tracker.state !== targetState,
      reason,
    },
  };
}

export function pollIntervalMs(state) {
  switch (state) {
    case STATES.HEALTHY: return 45000;
    case STATES.DEGRADED: return 12000;
    case STATES.FAILOVER_ACTIVE: return 10000;
    case STATES.RECOVERING: return 7000;
    case STATES.OFFLINE: return 7000;
    case STATES.UNKNOWN: return 15000;
    default: return 15000;
  }
}

export function shouldAlert(transition, tracker, nowMs, serviceName) {
  if (!transition || !transition.changed) return null;

  const { to, from } = transition;
  const inc = (tracker && tracker.incidentId) || 'N/A';
  const err = (tracker && tracker.lastError) || 'N/A';
  const fails = tracker ? tracker.consecutiveFailures : 0;
  // The title is the line a human reads first, at 3am, on a phone. Hardcoding
  // "Assistant" sent an operator after the wrong system the first time the
  // WhatsApp gateway went down in production.
  const who = typeof serviceName === 'string' && serviceName.length > 0 ? serviceName : 'Assistant';

  if (to === STATES.OFFLINE) {
    return {
      severity: 'critical',
      title: `${who} OFFLINE`,
      detail: `State changed to OFFLINE. Incident: ${inc}. Last error: ${err}. Consecutive failures: ${fails}.`,
    };
  }
  if (to === STATES.FAILOVER_ACTIVE) {
    return {
      severity: 'high',
      title: `${who} failover activated`,
      detail: `State changed to FAILOVER_ACTIVE. Incident: ${inc}. Last error: ${err}. Consecutive failures: ${fails}.`,
    };
  }
  if (to === STATES.DEGRADED) {
    return {
      severity: 'warning',
      title: `${who} degraded`,
      detail: `State changed to DEGRADED. Incident: ${inc}. Last error: ${err}. Consecutive failures: ${fails}.`,
    };
  }
  if (to === STATES.HEALTHY && from !== STATES.HEALTHY) {
    return {
      severity: 'info',
      title: `${who} restored`,
      detail: `State changed to HEALTHY from ${from}. Incident: ${inc}. Consecutive successes: ${tracker ? tracker.consecutiveSuccesses : 0}.`,
    };
  }
  return null;
}
