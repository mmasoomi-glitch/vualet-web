// Whether standing somewhere should make the assistant speak.
//
// This is the deterministic gate in front of the whole location-memory feature.
// If it is too eager the product becomes a phone that buzzes at every junction
// and gets uninstalled; if it is too shy the memory never comes back and the
// feature does not exist. Both failures are silent, so they are tested here.
//
// Distances below are derived from real degrees of latitude: 1 degree of
// latitude is ~111.32 km everywhere, so 0.001 deg is ~111 m. Coordinates are
// chosen from that, not guessed.

import test from "node:test";
import assert from "node:assert/strict";
import {
  DECISIONS,
  DEFAULT_TRIGGER,
  MAX_SEEN_EVENT_IDS,
  distanceM,
  initialTriggerState,
  normaliseTrigger,
  evaluateLocationEvent,
  shouldRearm,
} from "../src/lib/context-trigger-core.mjs";

const PLACE = { lat: 25.0, lon: 55.0 };
const memory = (trigger = {}) => ({ id: "mem_pizza", location: PLACE, trigger });

/** Metres north of PLACE, converted to a latitude offset. */
const northOf = (metres) => ({ lat: PLACE.lat + metres / 111_320, lon: PLACE.lon });

const at = (metres, over = {}) => ({ ...northOf(metres), eventId: `ev_${Math.random()}`, ...over });

const T0 = 1_800_000_000_000;

/** Feed a sequence of [metresFromPlace, msSinceT0] and collect the decisions. */
function run(steps, { trigger = {}, state = initialTriggerState() } = {}) {
  const mem = memory(trigger);
  const decisions = [];
  let s = state;
  for (const [metres, dt, over] of steps) {
    const r = evaluateLocationEvent({ memory: mem, state: s, event: at(metres, over), nowMs: T0 + dt });
    decisions.push(r.decision);
    s = r.state;
  }
  return { decisions, state: s, fired: decisions.filter((d) => d === DECISIONS.FIRE).length };
}

/* ── the two failures that would kill the feature ───────────────────────── */

test("A REAL VISIT EVENTUALLY FIRES — the reminder is not silently dead", () => {
  // Someone walks in and stays. Events keep arriving while they sit there.
  // A naive implementation recomputes "arrived at" on every event, so the dwell
  // timer restarts forever and the reminder NEVER fires. The feature would look
  // implemented, pass a casual demo, and never once work in the field.
  const { fired, decisions } = run([
    [20, 0],      // arrives
    [18, 10_000], // still there, dwell not yet met
    [22, 20_000],
    [19, 35_000], // dwell (30s) satisfied -> must fire
    [21, 45_000],
  ]);

  assert.equal(
    fired,
    1,
    `staying inside must fire exactly once, got ${fired}. Decisions: ${decisions.join(", ")}. If this is 0, enteredAtMs is being reset on every event and the dwell timer can never elapse.`,
  );
  assert.equal(decisions[0], DECISIONS.ENTERED_PENDING_DWELL, "the arrival itself waits");
  assert.equal(decisions[3], DECISIONS.FIRE, "and it fires once dwell is satisfied");
});

test("DRIVING PAST DOES NOT FIRE", () => {
  // Through the fence and out the other side inside a few seconds.
  const { fired } = run([
    [300, 0],
    [40, 4_000],
    [30, 8_000],
    [400, 14_000],
  ]);
  assert.equal(fired, 0, "a car passing a restaurant has not visited it");
});

/* ── notification fatigue ───────────────────────────────────────────────── */

test("SITTING IN A CAFE FOR HOURS PRODUCES ONE REMINDER, NOT HUNDREDS", () => {
  // 200 location events over three hours, never leaving.
  const steps = [];
  for (let i = 0; i < 200; i++) steps.push([15 + (i % 7), 60_000 + i * 54_000]);
  const { fired } = run(steps);
  assert.equal(fired, 1, `three hours inside must yield one reminder, got ${fired}`);
});

test("GPS BOUNCING ACROSS THE ENTRY RADIUS DOES NOT RE-ENTER", () => {
  // Phone on a table; fixes jitter either side of the 100 m entry radius but
  // never past the 140 m exit radius. With a single boundary this is a stream
  // of enter/exit events. With hysteresis it is silence.
  const steps = [[50, 0], [50, 40_000]]; // settle and fire
  for (let i = 0; i < 30; i++) steps.push([i % 2 ? 95 : 120, 100_000 + i * 30_000]);

  const { decisions, fired } = run(steps);
  assert.equal(fired, 1, "the bouncing must not produce extra reminders");
  assert.ok(
    !decisions.slice(2).includes(DECISIONS.EXITED),
    "and must never register as leaving — that is what the gap between the radii is for",
  );
});

test("a reminder rearms only after genuinely leaving", () => {
  const { decisions, fired } = run([
    [20, 0],
    [20, 40_000],        // fire
    [500, 100_000],      // properly gone -> rearm
    [20, 200_000],
    [20, 250_000],       // dwell met again, but cooldown (12h default) holds
  ]);
  assert.ok(decisions.includes(DECISIONS.EXITED), "leaving is detected");
  assert.equal(fired, 1, "the default 12h cooldown still applies after returning");
  assert.equal(decisions[4], DECISIONS.SUPPRESSED_COOLDOWN, "and it says so");
});

test("after the cooldown expires, a return does fire again", () => {
  const twelveHoursOne = 43_200_001;
  const { fired } = run([
    [20, 0],
    [20, 40_000],
    [500, 100_000],
    [20, twelveHoursOne],
    [20, twelveHoursOne + 40_000],
  ]);
  assert.equal(fired, 2, "a genuine later visit is worth mentioning again");
});

test('maxFires honours "only remind me once"', () => {
  const trigger = { maxFires: 1, cooldownMs: 0 };
  const { fired, decisions } = run(
    [
      [20, 0], [20, 40_000],
      [500, 100_000],
      [20, 200_000], [20, 240_000],
      [500, 300_000],
      [20, 400_000], [20, 440_000],
    ],
    { trigger },
  );
  assert.equal(fired, 1, "once means once, however many times they return");
  assert.equal(decisions[decisions.length - 1], DECISIONS.IGNORED_DISABLED, "later visits are explicitly spent");
});

/* ── idempotency: the OS redelivers ─────────────────────────────────────── */

test("A REDELIVERED EVENT DOES NOT FIRE TWICE", () => {
  const mem = memory();
  const arrive = { ...northOf(20), eventId: "ev_dup" };
  let s = initialTriggerState();

  s = evaluateLocationEvent({ memory: mem, state: s, event: { ...northOf(20), eventId: "ev_a" }, nowMs: T0 }).state;

  const first = evaluateLocationEvent({ memory: mem, state: s, event: arrive, nowMs: T0 + 40_000 });
  assert.equal(first.decision, DECISIONS.FIRE);

  // Same event id delivered again, as Android and iOS both do.
  const second = evaluateLocationEvent({ memory: mem, state: first.state, event: arrive, nowMs: T0 + 40_050 });
  assert.equal(second.decision, DECISIONS.IGNORED_DUPLICATE, "a redelivery is not a new visit");
  assert.equal(second.state.fireCount, first.state.fireCount, "and must not advance the fire count");
  assert.deepEqual(second.state, first.state, "a duplicate must leave state completely untouched");
});

test("the deduplication buffer is bounded", () => {
  const mem = memory();
  let s = initialTriggerState();
  for (let i = 0; i < MAX_SEEN_EVENT_IDS * 3; i++) {
    s = evaluateLocationEvent({ memory: mem, state: s, event: { ...northOf(900), eventId: `ev_${i}` }, nowMs: T0 + i * 1000 }).state;
  }
  assert.equal(s.seenEventIds.length, MAX_SEEN_EVENT_IDS, "an unbounded id list is a slow memory leak on a phone");
  assert.ok(s.seenEventIds.includes(`ev_${MAX_SEEN_EVENT_IDS * 3 - 1}`), "the newest is kept");
  assert.ok(!s.seenEventIds.includes("ev_0"), "the oldest is dropped");
});

/* ── accuracy ───────────────────────────────────────────────────────────── */

test("A FIX TOO IMPRECISE TO LOCATE THE FENCE IS NOT ACTED ON", () => {
  const r = evaluateLocationEvent({
    memory: memory(),
    state: initialTriggerState(),
    event: { ...northOf(40), eventId: "ev_vague", accuracyM: 2_000 },
    nowMs: T0,
  });
  assert.equal(r.decision, DECISIONS.IGNORED_INACCURATE, "a 2 km error cannot resolve a 100 m fence");
  assert.equal(r.state.inside, false, "and must not claim an arrival on a guess");
});

test("but a poor fix far away can still register leaving", () => {
  // Otherwise one bad fix strands the state inside forever and the reminder
  // never rearms — a silent permanent failure.
  const inside = { ...initialTriggerState(), inside: true, enteredAtMs: T0 };
  const r = evaluateLocationEvent({
    memory: memory(),
    state: inside,
    event: { ...northOf(50_000), eventId: "ev_far", accuracyM: 3_000 },
    nowMs: T0 + 600_000,
  });
  assert.equal(r.decision, DECISIONS.EXITED, "50 km away is 50 km away whatever the error bars say");
  assert.equal(r.state.inside, false);
});

/* ── robustness ─────────────────────────────────────────────────────────── */

test("it never throws, whatever it is handed", () => {
  const junk = [null, undefined, 5, "nope", {}, { location: null }, { location: { lat: "x", lon: 1 } }];
  for (const m of junk) {
    for (const e of junk) {
      const r = evaluateLocationEvent({ memory: m, state: initialTriggerState(), event: e, nowMs: T0 });
      assert.ok(Object.values(DECISIONS).includes(r.decision), `${JSON.stringify(m)}/${JSON.stringify(e)} returned a decision`);
    }
  }
  for (const bad of [null, undefined, NaN, Infinity, "now"]) {
    const r = evaluateLocationEvent({ memory: memory(), state: initialTriggerState(), event: at(10), nowMs: bad });
    assert.equal(r.decision, DECISIONS.IGNORED_MALFORMED, `nowMs=${String(bad)} is refused, not guessed at`);
  }
});

test("THE CALLER'S STATE IS NEVER MUTATED", () => {
  const s = initialTriggerState();
  const frozen = JSON.stringify(s);
  for (const metres of [20, 20, 500, 20]) {
    evaluateLocationEvent({ memory: memory(), state: s, event: at(metres), nowMs: T0 + 60_000 });
  }
  assert.equal(JSON.stringify(s), frozen, "a failed persist must leave the previous state intact, not half-applied");
});

/* ── configuration ──────────────────────────────────────────────────────── */

test("THE HYSTERESIS INVARIANT SURVIVES BAD CONFIGURATION", () => {
  for (const t of [
    { entryRadiusM: 100, exitRadiusM: 50 },
    { entryRadiusM: 100, exitRadiusM: 100 },
    { entryRadiusM: 1, exitRadiusM: 2 }, // entry clamps up to 10 — exit must follow
    { entryRadiusM: -5 },
    { exitRadiusM: NaN },
    {},
    null,
  ]) {
    const n = normaliseTrigger(t);
    assert.ok(
      n.exitRadiusM > n.entryRadiusM,
      `${JSON.stringify(t)} produced exit ${n.exitRadiusM} <= entry ${n.entryRadiusM}, which collapses back to a single boundary and reintroduces the chatter`,
    );
    assert.ok(n.entryRadiusM >= 10 && n.entryRadiusM <= 50_000, "entry radius stays sane");
  }
});

test("trigger settings are clamped, not trusted", () => {
  const n = normaliseTrigger({ dwellMs: 999_999_999, cooldownMs: -1, maxFires: 2.7 });
  assert.equal(n.dwellMs, 3_600_000, "an hour is the most anyone should have to loiter");
  assert.equal(n.cooldownMs, 0);
  assert.equal(n.maxFires, 2, "a fractional fire count is floored");
  assert.ok(Object.isFrozen(n), "and the result cannot be edited underneath the evaluator");
});

test("a disabled trigger stays silent", () => {
  const r = evaluateLocationEvent({
    memory: memory({ enabled: false }),
    state: initialTriggerState(),
    event: at(5),
    nowMs: T0,
  });
  assert.equal(r.decision, DECISIONS.IGNORED_DISABLED);
});

test("the defaults are the ones the directive asked for", () => {
  assert.equal(DEFAULT_TRIGGER.entryRadiusM, 100);
  assert.equal(DEFAULT_TRIGGER.exitRadiusM, 140);
  assert.equal(DEFAULT_TRIGGER.dwellMs, 30_000);
  assert.equal(DEFAULT_TRIGGER.cooldownMs, 43_200_000, "12 hours");
  assert.ok(Object.isFrozen(DEFAULT_TRIGGER), "defaults, not hard-coded business rules — but not mutable either");
});

/* ── geometry ───────────────────────────────────────────────────────────── */

test("distance is real metres", () => {
  assert.equal(Math.round(distanceM(25, 55, 25, 55)), 0);
  // 0.001 deg latitude ~ 111.32 m
  assert.ok(Math.abs(distanceM(25, 55, 25.001, 55) - 111.32) < 1.5, "one thousandth of a degree of latitude");
  // Longitude converges toward the poles; at 25 deg, cos(25) ~ 0.906
  assert.ok(Math.abs(distanceM(25, 55, 25, 55.001) - 100.9) < 2, "longitude is narrower away from the equator");
  for (const bad of [[NaN, 55, 25, 55], [91, 55, 25, 55], [25, 181, 25, 55], ["25", 55, 25, 55]]) {
    assert.ok(Number.isNaN(distanceM(...bad)), `${JSON.stringify(bad)} is not a coordinate`);
  }
});

test("shouldRearm agrees with the evaluator", () => {
  const inside = { ...initialTriggerState(), inside: true, enteredAtMs: T0 };
  assert.equal(shouldRearm(inside, memory(), northOf(500)), true);
  assert.equal(shouldRearm(inside, memory(), northOf(120)), false, "between the radii is still inside");
  assert.equal(shouldRearm(initialTriggerState(), memory(), northOf(500)), false, "cannot leave what you never entered");
  for (const junk of [null, undefined, {}]) {
    assert.equal(shouldRearm(junk, memory(), northOf(500)), false, "and it never throws");
  }
});
