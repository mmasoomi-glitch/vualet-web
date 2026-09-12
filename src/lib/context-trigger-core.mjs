/**
 * Deciding whether being in a place should say something.
 *
 * A remembered experience ("the pizza here was awful") is only useful if it
 * comes back at the moment it matters — standing outside that pizzeria again,
 * months later, having long forgotten you ever said it. This module is the
 * deterministic half of that: given a location fix, does this memory fire?
 *
 * It runs BEFORE any AI does. Narrowing candidates is arithmetic, not judgement,
 * and asking a model to reason over every GPS update would be slow, expensive
 * and non-deterministic. The model's turn comes later, over the handful of
 * memories this module says are actually relevant.
 *
 * ── WHY TWO RADII ─────────────────────────────────────────────────────────
 * A single boundary turns GPS noise into a stream of alerts. A fix drifting
 * twenty metres either side of one 100 m circle enters and leaves it over and
 * over while the phone sits still on a table. So entry is at 100 m and exit is
 * at 140 m: once you are in, you are not out until you are properly out. The
 * gap is the silence.
 *
 * ── WHY DWELL ─────────────────────────────────────────────────────────────
 * Driving past a restaurant is not visiting it. Requiring thirty seconds inside
 * the fence is the difference between a useful reminder and a phone that buzzes
 * at every junction.
 *
 * ── WHY FIRING IS REARMED ONLY BY LEAVING ─────────────────────────────────
 * Sitting in a café for three hours generates hundreds of location events. One
 * reminder is help; two hundred is an uninstall. A memory that has fired stays
 * quiet until you have actually left and come back, or until the cooldown has
 * expired — whichever the user configured.
 *
 * PURE: no imports, no I/O, no clock, no randomness. Time always arrives as a
 * NUMBER named nowMs — never a function, a mistake this codebase has made
 * before. Nothing here throws; malformed input returns a decision.
 */

export const DECISIONS = Object.freeze({
  IGNORED_DUPLICATE: 'IGNORED_DUPLICATE',
  IGNORED_DISABLED: 'IGNORED_DISABLED',
  IGNORED_INACCURATE: 'IGNORED_INACCURATE',
  IGNORED_MALFORMED: 'IGNORED_MALFORMED',
  OUTSIDE: 'OUTSIDE',
  ENTERED_PENDING_DWELL: 'ENTERED_PENDING_DWELL',
  SUPPRESSED_COOLDOWN: 'SUPPRESSED_COOLDOWN',
  SUPPRESSED_ALREADY_INSIDE: 'SUPPRESSED_ALREADY_INSIDE',
  FIRE: 'FIRE',
  EXITED: 'EXITED',
});

export const DEFAULT_TRIGGER = Object.freeze({
  entryRadiusM: 100,
  exitRadiusM: 140,
  dwellMs: 30_000,
  cooldownMs: 43_200_000, // 12 hours
  enabled: true,
  maxFires: null, // null = unlimited; 1 honours "only remind me once"
});

const EARTH_RADIUS_M = 6_371_000;

/** How many event ids to remember for deduplication. Bounded on purpose. */
export const MAX_SEEN_EVENT_IDS = 50;

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Great-circle metres. NaN for anything not a real coordinate. */
export function distanceM(aLat, aLon, bLat, bLon) {
  if (!num(aLat) || !num(aLon) || !num(bLat) || !num(bLon)) return NaN;
  if (aLat < -90 || aLat > 90 || bLat < -90 || bLat > 90) return NaN;
  if (aLon < -180 || aLon > 180 || bLon < -180 || bLon > 180) return NaN;

  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export function initialTriggerState() {
  return { inside: false, enteredAtMs: null, lastFiredAtMs: null, fireCount: 0, seenEventIds: [] };
}

/**
 * Coerce a stored trigger into something safe to evaluate.
 *
 * The hysteresis invariant (exit strictly greater than entry) is enforced
 * rather than validated: a stored trigger with exit <= entry would reintroduce
 * the single-boundary chatter this module exists to prevent, and refusing to
 * evaluate would silently disable the user's reminder instead. Clamping happens
 * BEFORE the exit radius is derived, so a clamped entry cannot end up larger
 * than the exit that was computed from its pre-clamp value.
 */
export function normaliseTrigger(trigger) {
  const t = trigger && typeof trigger === 'object' ? trigger : {};
  const entryRadiusM = clamp(num(t.entryRadiusM) ? t.entryRadiusM : DEFAULT_TRIGGER.entryRadiusM, 10, 50_000);

  const rawExit = num(t.exitRadiusM) ? t.exitRadiusM : DEFAULT_TRIGGER.exitRadiusM;
  const exitRadiusM = rawExit > entryRadiusM ? Math.min(rawExit, 100_000) : entryRadiusM * 1.4;

  return Object.freeze({
    entryRadiusM,
    exitRadiusM,
    dwellMs: clamp(num(t.dwellMs) ? t.dwellMs : DEFAULT_TRIGGER.dwellMs, 0, 3_600_000),
    cooldownMs: clamp(num(t.cooldownMs) ? t.cooldownMs : DEFAULT_TRIGGER.cooldownMs, 0, 2_592_000_000),
    enabled: t.enabled !== false,
    maxFires: num(t.maxFires) && t.maxFires > 0 ? Math.floor(t.maxFires) : null,
  });
}

/** Append an event id, oldest dropped. Unbounded growth here would be a leak. */
function remember(seen, eventId) {
  const list = Array.isArray(seen) ? seen : [];
  if (typeof eventId !== 'string' || eventId.length === 0) return list.slice();
  const next = [...list, eventId];
  return next.length > MAX_SEEN_EVENT_IDS ? next.slice(next.length - MAX_SEEN_EVENT_IDS) : next;
}

const out = (decision, state, distance, reason) => ({ decision, state, distanceM: distance, reason });

/**
 * Evaluate one location event against one memory.
 *
 * Returns a NEW state object every time; the caller's state is never mutated,
 * so a failed persist leaves the previous state intact rather than half-applied.
 */
export function evaluateLocationEvent({ memory, state, event, nowMs }) {
  const s =
    state && typeof state === 'object' ? { ...initialTriggerState(), ...state } : initialTriggerState();

  if (!memory || typeof memory !== 'object' || !event || typeof event !== 'object' || !num(nowMs)) {
    return out(DECISIONS.IGNORED_MALFORMED, s, NaN, 'The memory, the event or the clock was missing.');
  }

  const loc = memory.location;
  if (!loc || typeof loc !== 'object' || !num(loc.lat) || !num(loc.lon)) {
    return out(DECISIONS.IGNORED_MALFORMED, s, NaN, 'This memory has no usable coordinates.');
  }
  if (!num(event.lat) || !num(event.lon)) {
    return out(DECISIONS.IGNORED_MALFORMED, s, NaN, 'The location event has no usable coordinates.');
  }

  // Mobile operating systems redeliver the same geofence crossing. A repeat must
  // not produce a second notification, a second history row, or advance state.
  const id = event.eventId;
  if (typeof id === 'string' && id.length > 0 && s.seenEventIds.includes(id)) {
    return out(DECISIONS.IGNORED_DUPLICATE, s, NaN, 'This event has already been processed.');
  }
  const seenEventIds = remember(s.seenEventIds, id);
  const base = { ...s, seenEventIds };

  const trigger = normaliseTrigger(memory.trigger);
  if (!trigger.enabled) {
    return out(DECISIONS.IGNORED_DISABLED, base, NaN, 'This reminder is switched off.');
  }
  if (trigger.maxFires !== null && s.fireCount >= trigger.maxFires) {
    return out(
      DECISIONS.IGNORED_DISABLED,
      base,
      NaN,
      `This reminder was set to fire at most ${trigger.maxFires} time(s) and already has.`,
    );
  }

  const d = distanceM(loc.lat, loc.lon, event.lat, event.lon);
  if (!num(d)) {
    return out(DECISIONS.IGNORED_MALFORMED, base, NaN, 'The coordinates could not be compared.');
  }

  // A fix whose own error exceeds the fence cannot tell inside from outside, so
  // acting on it is guessing. Deliberately does NOT block a clearly-distant fix
  // from registering an exit — otherwise a bad fix could strand the state
  // "inside" forever and the reminder would never rearm.
  if (num(event.accuracyM) && event.accuracyM > trigger.entryRadiusM && d <= trigger.exitRadiusM) {
    return out(DECISIONS.IGNORED_INACCURATE, base, d, 'The location fix is too imprecise to trust here.');
  }

  // ── Where are we, and has that changed? ────────────────────────────────
  // The two radii mean the answer depends on where we were. Crucially, staying
  // inside PRESERVES enteredAtMs: recomputing it on every event would restart
  // the dwell timer forever and the reminder could never fire at all.
  let { inside, enteredAtMs } = base;

  if (inside) {
    if (d > trigger.exitRadiusM) {
      return out(
        DECISIONS.EXITED,
        { ...base, inside: false, enteredAtMs: null },
        d,
        'Left the area; this reminder is armed again.',
      );
    }
    if (d > trigger.entryRadiusM) {
      // In the gap between the radii. Still inside, by design.
      return out(DECISIONS.SUPPRESSED_ALREADY_INSIDE, base, d, 'Still in the area, not far enough out to count as leaving.');
    }
  } else {
    if (d > trigger.entryRadiusM) {
      return out(DECISIONS.OUTSIDE, base, d, 'Not near this place.');
    }
    inside = true;
    enteredAtMs = nowMs; // only on a genuine crossing inwards
  }

  const arrived = { ...base, inside, enteredAtMs };

  if (nowMs - enteredAtMs < trigger.dwellMs) {
    return out(DECISIONS.ENTERED_PENDING_DWELL, arrived, d, 'Just arrived; waiting to see if this is a real visit.');
  }
  if (num(arrived.lastFiredAtMs) && nowMs - arrived.lastFiredAtMs < trigger.cooldownMs) {
    return out(DECISIONS.SUPPRESSED_COOLDOWN, arrived, d, 'Mentioned recently; staying quiet for now.');
  }
  // Fired already during THIS visit — three hours in a café is one reminder.
  if (num(arrived.lastFiredAtMs) && arrived.lastFiredAtMs >= enteredAtMs) {
    return out(DECISIONS.SUPPRESSED_ALREADY_INSIDE, arrived, d, 'Already mentioned this during the current visit.');
  }

  return out(
    DECISIONS.FIRE,
    { ...arrived, lastFiredAtMs: nowMs, fireCount: arrived.fireCount + 1 },
    d,
    'Arrived and settled at a place with something worth recalling.',
  );
}

/** True when a previously-inside state is now beyond the exit radius. */
export function shouldRearm(state, memory, event) {
  if (!state || state.inside !== true || !memory?.location || !event) return false;
  const trigger = normaliseTrigger(memory.trigger);
  const d = distanceM(memory.location.lat, memory.location.lon, event.lat, event.lon);
  return num(d) && d > trigger.exitRadiusM;
}
