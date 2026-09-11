// Assistant reliability — the polling worker.
//
// This runs forever in a production process. The last outage went unnoticed
// for four days because the process was alive and the port answered, so the
// one thing this worker may never do is die quietly: every path that could
// throw is contained, including the listeners the caller hands us.
//
// Construction is the exception. A misconfigured monitor should fail at
// startup, loudly, rather than run and watch nothing.
//
// Nothing here reads the clock or the timers directly — they are injected, so
// the whole worker is testable with no network, no real time and no waiting.

import {
  DEFAULT_POLICY,
  initialState,
  onProbe,
  pollIntervalMs,
  shouldAlert,
} from './state-machine.mjs';

const DEFAULT_MAX_JITTER_MS = 2000;

function validateConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('createPoller requires a config object.');
  }
  if (!Array.isArray(config.services) || config.services.length === 0) {
    throw new Error('createPoller requires a non-empty services array.');
  }
  const seen = new Set();
  for (const svc of config.services) {
    if (!svc || typeof svc.name !== 'string' || svc.name.trim().length === 0) {
      throw new Error('Every service needs a non-empty name.');
    }
    if (typeof svc.probe !== 'function') {
      throw new Error(`Service "${svc.name}" needs a callable probe.`);
    }
    // Two services sharing a name would share one tracker and one timer, so
    // one of them would be silently unmonitored — the exact failure this
    // subsystem exists to prevent.
    if (seen.has(svc.name)) {
      throw new Error(`Duplicate service name "${svc.name}".`);
    }
    seen.add(svc.name);
  }
}

/** Trackers are flat, but carry a nested `transition` once probed. */
function copyTracker(tracker) {
  const copy = { ...tracker };
  if (copy.transition) copy.transition = { ...copy.transition };
  return copy;
}

export function createPoller(config) {
  validateConfig(config);

  const {
    services,
    clock = () => Date.now(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    onEvent = null,
    onAlert = null,
    maxJitterMs = DEFAULT_MAX_JITTER_MS,
    random = Math.random,
  } = config;

  const startedAt = clock();
  const probes = new Map();
  const policies = new Map();
  const trackers = new Map();
  const inFlight = new Map();
  const timers = new Map();
  let running = false;

  for (const svc of services) {
    probes.set(svc.name, svc.probe);
    policies.set(svc.name, svc.policy || DEFAULT_POLICY);
    trackers.set(svc.name, initialState(startedAt));
  }

  /** A listener that throws is a bug in the caller, not a reason to stop monitoring. */
  function emit(event) {
    if (typeof onEvent !== 'function') return;
    try {
      onEvent(event);
    } catch {
      /* ignored on purpose */
    }
  }

  function raise(alert, serviceName, tracker) {
    if (typeof onAlert !== 'function') return;
    try {
      onAlert(alert, serviceName, tracker);
    } catch {
      /* ignored on purpose */
    }
  }

  function scheduleNext(serviceName, state) {
    if (!running) return;
    // Jitter is only ever ADDED. Subtracting it would poll faster than the
    // policy allows and could hammer a service that is already struggling.
    const delay = pollIntervalMs(state) + Math.floor(random() * maxJitterMs);
    const existing = timers.get(serviceName);
    if (existing !== undefined) clearTimer(existing);
    timers.set(
      serviceName,
      setTimer(() => {
        timers.delete(serviceName);
        // Fire-and-forget: runCycle never rejects.
        runCycle(serviceName, true);
      }, delay),
    );
  }

  /**
   * One probe + transition cycle.
   *
   * `scheduled` distinguishes the timer loop from a forced check. The timer
   * loop reschedules itself and must go silent the moment stop() is called;
   * a forced check (tests, the ops API) runs even when the worker is stopped
   * and never plants a timer, so calling it cannot resurrect a stopped poller.
   */
  async function runCycle(serviceName, scheduled) {
    if (scheduled && !running) return trackers.get(serviceName);

    // A probe slower than its own interval must not stack up a second one.
    if (inFlight.get(serviceName)) return trackers.get(serviceName);
    inFlight.set(serviceName, true);

    try {
      let probe;
      try {
        probe = await probes.get(serviceName)();
      } catch (err) {
        // Probes are contracted never to throw. If one does anyway, that is
        // itself a failure of the thing being watched, not a reason to stop.
        probe = {
          ok: false,
          atMs: clock(),
          latencyMs: 0,
          error: (err && err.message) || 'probe threw',
          detail: {},
        };
      }

      // stop() may have been called while we were awaiting. A late result must
      // not emit, alert or reschedule.
      if (scheduled && !running) return trackers.get(serviceName);

      const before = trackers.get(serviceName);
      const tracker = onProbe(before, probe, policies.get(serviceName));
      trackers.set(serviceName, tracker);

      // The state machine treats probe.atMs as "now", so every event and the
      // alert decision use the same instant. Reading the clock again here
      // would timestamp the transition later than the probe that caused it.
      const atMs = typeof probe.atMs === 'number' ? probe.atMs : clock();

      emit({
        type: 'probe',
        service: serviceName,
        atMs,
        ok: probe.ok === true,
        latencyMs: probe.latencyMs,
        state: tracker.state,
        error: probe.error || null,
      });

      if (tracker.transition && tracker.transition.changed) {
        emit({
          type: 'transition',
          service: serviceName,
          atMs,
          from: tracker.transition.from,
          to: tracker.transition.to,
          reason: tracker.transition.reason,
          // Recovering CLEARS the incident id, so the very event that closes an
          // incident would otherwise carry none and the history would never be
          // able to match it to the incident it ended.
          incidentId: tracker.incidentId || before.incidentId || null,
        });
        const alert = shouldAlert(tracker.transition, tracker, atMs);
        if (alert) raise(alert, serviceName, tracker);
      }

      // Derived from the NEW state: a service that just degraded must be
      // re-checked at the faster cadence immediately, not one slow tick later.
      if (scheduled) scheduleNext(serviceName, tracker.state);

      return tracker;
    } finally {
      inFlight.set(serviceName, false);
    }
  }

  function start() {
    if (running) return;
    running = true;
    for (const svc of services) {
      // A 0ms timer rather than an inline await, so start() stays synchronous
      // and a slow first probe cannot block process startup.
      timers.set(
        svc.name,
        setTimer(() => {
          timers.delete(svc.name);
          runCycle(svc.name, true);
        }, 0),
      );
    }
  }

  function stop() {
    if (!running) return;
    running = false;
    for (const timerId of timers.values()) clearTimer(timerId);
    timers.clear();
    // In-flight flags are deliberately left alone: those probes are still
    // running and will clear their own flags, and they check `running` after
    // the await before doing anything observable.
  }

  function snapshot() {
    const out = {};
    for (const [name, tracker] of trackers) out[name] = copyTracker(tracker);
    return out;
  }

  /** Forces one check. Resolves to the current tracker even if a probe was
   *  already in flight, in which case no second probe is issued. */
  async function pollOnce(serviceName) {
    if (!trackers.has(serviceName)) {
      throw new Error(`Unknown service "${serviceName}".`);
    }
    return runCycle(serviceName, false);
  }

  return {
    start,
    stop,
    snapshot,
    pollOnce,
    isRunning: () => running,
  };
}
