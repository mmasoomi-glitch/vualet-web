// What the assistant learned from something that happened to the user.
//
// The failures this guards against are not crashes. They are confident, wrong,
// repeated statements to a customer's face: warning them off a whole chain
// because one branch was bad, still warning them about a place that got better,
// or showing one tenant another tenant's life. Those are the tests.

import test from "node:test";
import assert from "node:assert/strict";
import {
  SCOPES, IMPORTANCE, SENTIMENTS, STATUS, PRECISION,
  buildExperienceMemory, matchesScope, radiusForScope, redactToPrecision,
  detectSupersession, applySupersession, effectiveMemories, deliveryPolicy, roundTo,
} from "../src/lib/experience-memory-core.mjs";

const T = 1_800_000_000_000;
const DAY = 86_400_000;

const RIGGA = { lat: 25.2697, lon: 55.3095 };
// ~200 m away: another branch in the same mall.
const JUMEIRAH = { lat: 25.2715, lon: 55.3095 };

const build = (over = {}) =>
  buildExperienceMemory({
    tenantId: "tnt_a", userId: "usr_1",
    experience: "Pizza quality was very poor.",
    preference: "Avoid buying pizza from this location.",
    category: "food.restaurant.pizza",
    entity: { name: "Tom's Pizza", placeId: "place_rigga" },
    sentiment: SENTIMENTS.STRONG_NEGATIVE,
    importance: IMPORTANCE.NORMAL,
    confidence: 0.94,
    scope: SCOPES.THIS_BRANCH,
    location: RIGGA,
    createdAtMs: T,
    ...over,
  }).memory;

/* ── the directive's worked example ─────────────────────────────────────── */

test("THE PIZZA SCENARIO PRODUCES A STRUCTURED MEMORY, NOT A NOTE", () => {
  const m = build();
  assert.equal(m.type, "experience_memory");
  assert.equal(m.preference, "Avoid buying pizza from this location.", "the future behaviour is captured separately from the event");
  assert.equal(m.sentiment, SENTIMENTS.STRONG_NEGATIVE);
  assert.equal(m.entity.placeId, "place_rigga", "the branch is identified");
  assert.ok(m.trigger.entryRadiusM > 0 && m.trigger.exitRadiusM > m.trigger.entryRadiusM, "and it arrives ready to fence");
  assert.equal(m.status, STATUS.ACTIVE);
});

/* ── the rule that matters most ─────────────────────────────────────────── */

test("ONE BAD BRANCH DOES NOT CONDEMN THE WHOLE CHAIN", () => {
  const m = build();
  const here = { placeId: "place_rigga", name: "Tom's Pizza", ...RIGGA };
  const other = { placeId: "place_jumeirah", name: "Tom's Pizza", ...JUMEIRAH };

  assert.equal(matchesScope(m, here, { tenantId: "tnt_a" }), true, "it applies at the branch it happened in");
  assert.equal(
    matchesScope(m, other, { tenantId: "tnt_a" }),
    false,
    "a DIFFERENT branch of the same brand must not inherit the warning — being confidently wrong at the wrong shop is worse than saying nothing",
  );
});

test("a known place id that disagrees is refused even when the coordinates are close", () => {
  // Two units 200 m apart: geometry alone would happily fire the wrong one.
  const m = build({ importance: IMPORTANCE.CRITICAL }); // widens the fence to 200m
  const neighbour = { placeId: "place_jumeirah", name: "Tom's Pizza", ...JUMEIRAH };
  assert.equal(matchesScope(m, neighbour, { tenantId: "tnt_a" }), false, "identity beats geometry");
});

test("widening to the whole brand is possible, but only when asked for", () => {
  const m = build({ scope: SCOPES.ALL_BRANCHES_OF_ENTITY });
  const other = { placeId: "place_jumeirah", name: "Tom's Pizza", ...JUMEIRAH };
  const different = { placeId: "place_x", name: "Mario's", ...JUMEIRAH };

  assert.equal(matchesScope(m, other, { tenantId: "tnt_a" }), true, '"apply this to every branch" must actually work');
  assert.equal(matchesScope(m, different, { tenantId: "tnt_a" }), false, "but not to an unrelated business");
});

test("a different business at the same address does not inherit the memory", () => {
  const m = build({ entity: { name: "Tom's Pizza", placeId: null } });
  const successor = { name: "Golden Wok", ...RIGGA };
  assert.equal(matchesScope(m, successor, { tenantId: "tnt_a" }), false, "the unit changed hands; the warning did not transfer");
});

/* ── tenant isolation ───────────────────────────────────────────────────── */

test("TENANT ISOLATION IS ENFORCED IN THE LOGIC, NOT ONLY THE QUERY", () => {
  const m = build({ tenantId: "tnt_a" });
  const here = { placeId: "place_rigga", name: "Tom's Pizza", ...RIGGA };

  assert.equal(matchesScope(m, here, { tenantId: "tnt_a" }), true);
  assert.equal(
    matchesScope(m, here, { tenantId: "tnt_b" }),
    false,
    "a bug in a caller must not be able to surface one tenant's private life to another",
  );

  const mixed = [build({ tenantId: "tnt_a" }), build({ tenantId: "tnt_b" })];
  const got = effectiveMemories(mixed, { tenantId: "tnt_a" });
  assert.equal(got.length, 1, "listing filters by tenant too");
  assert.equal(got[0].tenantId, "tnt_a");
});

test("a memory belonging to another user of the same tenant is not assumed shared", () => {
  const m = build({ userId: "usr_1" });
  const here = { placeId: "place_rigga", name: "Tom's Pizza", ...RIGGA };
  assert.equal(matchesScope(m, here, { tenantId: "tnt_a", userId: "usr_2" }), false);
  assert.equal(matchesScope(m, here, { tenantId: "tnt_a", userId: "usr_1" }), true);
});

/* ── memory evolution ───────────────────────────────────────────────────── */

test("A BETTER LATER EXPERIENCE RETIRES THE OLD WARNING", () => {
  // January: terrible. August: actually very good. Storing both and warning
  // anyway is how a memory system becomes something people switch off.
  const jan = build({ id: "mem_1", createdAtMs: T });
  const aug = build({
    id: "mem_2",
    sentiment: SENTIMENTS.POSITIVE,
    experience: "Tried it again and it was very good.",
    createdAtMs: T + 200 * DAY,
  });

  const v = detectSupersession(jan, aug);
  assert.equal(v.supersedes, true, "the newer experience replaces the older");
  assert.equal(v.contradicts, true, "and it is recognised as a reversal");

  const applied = applySupersession(jan, aug, T + 200 * DAY);
  assert.equal(applied.previous.status, STATUS.SUPERSEDED);
  assert.equal(applied.next.supersedesId, "mem_1", "the chain is traceable");
  assert.equal(jan.status, STATUS.ACTIVE, "and the inputs are not mutated");

  const live = effectiveMemories([applied.previous, applied.next], { tenantId: "tnt_a" });
  assert.equal(live.length, 1, "a retired warning must not merely sort last — it must not be shown at all");
  assert.equal(live[0].id, "mem_2");
});

test("a memory about one thing does not retire a memory about another", () => {
  const parking = build({ id: "p", category: "parking", experience: "Car was towed.", createdAtMs: T });
  const coffee = build({ id: "c", category: "food.coffee", sentiment: SENTIMENTS.POSITIVE, createdAtMs: T + DAY });
  assert.equal(detectSupersession(parking, coffee).supersedes, false, "good coffee does not make the towing untrue");
});

test("supersession refuses across places, tenants, and backwards in time", () => {
  const base = build({ id: "a", createdAtMs: T });
  const elsewhere = build({ id: "b", entity: { name: "Tom's Pizza", placeId: "place_jumeirah" }, sentiment: SENTIMENTS.POSITIVE, createdAtMs: T + DAY });
  assert.equal(detectSupersession(base, elsewhere).supersedes, false, "another branch is not evidence about this one");

  const otherTenant = build({ id: "c", tenantId: "tnt_b", sentiment: SENTIMENTS.POSITIVE, createdAtMs: T + DAY });
  assert.equal(detectSupersession(base, otherTenant).supersedes, false, "tenants never interact");

  const older = build({ id: "d", sentiment: SENTIMENTS.POSITIVE, createdAtMs: T - DAY });
  assert.equal(detectSupersession(base, older).supersedes, false, "an older statement does not overwrite a newer one");

  const already = build({ id: "e", status: STATUS.SUPERSEDED, createdAtMs: T });
  assert.equal(detectSupersession(already, build({ id: "f", sentiment: SENTIMENTS.POSITIVE, createdAtMs: T + DAY })).supersedes, false);
});

/* ── privacy ────────────────────────────────────────────────────────────── */

test("COARSE PRECISION ACTUALLY DISCARDS THE COORDINATES", () => {
  // "Traffic around Deira is terrible" must not quietly record the doorway the
  // user was standing in when they said it. A coarse LABEL over exact
  // coordinates is not privacy; it is exact coordinates with a label.
  const exact = { lat: 25.2697123, lon: 55.3095456 };
  const city = redactToPrecision(exact, PRECISION.CITY);

  assert.equal(city.lat, 25.3, "one decimal place, ~11 km");
  assert.notEqual(city.lat, exact.lat, "the precise value is gone, not hidden");
  assert.ok(city.accuracyM > 10_000, "and the record admits how vague it now is");

  const venue = redactToPrecision(exact, PRECISION.VENUE);
  assert.equal(venue.lat, 25.2697, "venue precision keeps ~11 m");
  assert.ok(venue.accuracyM >= 11 && venue.accuracyM < 20);

  assert.equal(redactToPrecision(null, PRECISION.CITY), null, "and it never throws");
  assert.equal(redactToPrecision({ lat: "x", lon: 1 }, PRECISION.CITY), null);
});

test("a memory built at coarse precision never holds the exact position", () => {
  const m = build({ precision: PRECISION.NEIGHBOURHOOD, location: { lat: 25.2697123, lon: 55.3095456 } });
  assert.equal(m.location.lat, 25.27, "stored coarse");
  assert.equal(String(m.location.lat).length < String(25.2697123).length, true, "the digits are not merely masked");
  assert.equal(m.location.precision, PRECISION.NEIGHBOURHOOD, "and it says what it is");
});

test("roundTo is honest about junk", () => {
  assert.equal(roundTo(1.23456, 2), 1.23);
  for (const bad of [NaN, "1", null, undefined, Infinity]) assert.ok(Number.isNaN(roundTo(bad, 2)));
});

/* ── importance and confidence ──────────────────────────────────────────── */

test("IMPORTANCE WIDENS THE FENCE SO A SERIOUS WARNING ARRIVES IN TIME", () => {
  const low = radiusForScope(SCOPES.THIS_BRANCH, IMPORTANCE.LOW);
  const normal = radiusForScope(SCOPES.THIS_BRANCH, IMPORTANCE.NORMAL);
  const critical = radiusForScope(SCOPES.THIS_BRANCH, IMPORTANCE.CRITICAL);

  assert.ok(low < normal && normal < critical, `expected LOW<NORMAL<CRITICAL, got ${low}/${normal}/${critical}`);
  assert.ok(critical >= normal * 2, '"do not park here, the car was towed" should reach you before you park');
  assert.equal(radiusForScope(SCOPES.CUSTOM_RADIUS, IMPORTANCE.NORMAL, 350), 350, "an explicit radius is honoured");
  assert.ok(radiusForScope("NONSENSE", "NONSENSE") > 0, "and nonsense still yields a usable fence");
});

test("A GUESS IS NEVER ALLOWED TO INTERRUPT", () => {
  const guess = build({ confidence: 0.55 });
  const sure = build({ confidence: 0.94 });

  assert.equal(deliveryPolicy(guess).proactive, false, "0.55 confidence must not push a notification");
  assert.equal(deliveryPolicy(guess).onRecall, true, "but it is still there if the user asks");
  assert.equal(deliveryPolicy(sure).proactive, true);
  assert.equal(deliveryPolicy({}).proactive, false, "unknown confidence is treated as a guess, not as certainty");
});

test("effectiveMemories ranks by importance, then confidence, then recency", () => {
  const list = [
    build({ id: "low", importance: IMPORTANCE.LOW, confidence: 0.9, createdAtMs: T }),
    build({ id: "crit", importance: IMPORTANCE.CRITICAL, confidence: 0.6, createdAtMs: T }),
    build({ id: "norm_new", importance: IMPORTANCE.NORMAL, confidence: 0.8, createdAtMs: T + DAY }),
    build({ id: "norm_old", importance: IMPORTANCE.NORMAL, confidence: 0.8, createdAtMs: T }),
    build({ id: "dead", status: STATUS.ARCHIVED }),
  ];
  const got = effectiveMemories(list, { tenantId: "tnt_a" }).map((m) => m.id);
  assert.deepEqual(got, ["crit", "norm_new", "norm_old", "low"]);
  assert.ok(!got.includes("dead"), "archived memories are dropped, not ranked");
});

test("effectiveMemories can exclude guesses entirely", () => {
  const list = [build({ id: "sure", confidence: 0.9 }), build({ id: "guess", confidence: 0.3 })];
  const got = effectiveMemories(list, { tenantId: "tnt_a", minConfidence: 0.7 }).map((m) => m.id);
  assert.deepEqual(got, ["sure"]);
});

/* ── refusals ───────────────────────────────────────────────────────────── */

test("it refuses a memory that could never be recalled", () => {
  const bad = [
    { tenantId: "", userId: "u", experience: "x", entity: { name: "a" } },
    { tenantId: "t", userId: "", experience: "x", entity: { name: "a" } },
    { tenantId: "t", userId: "u", experience: "", entity: { name: "a" } },
    // No entity, no place id, no coordinates: nothing to ever match against.
    { tenantId: "t", userId: "u", experience: "it was bad" },
  ];
  for (const b of bad) {
    const r = buildExperienceMemory(b);
    assert.equal(r.ok, false, `${JSON.stringify(b)} must be refused`);
    assert.ok(r.reason.length > 0, "with a reason");
  }
  for (const junk of [null, undefined, 5, "nope"]) {
    assert.equal(buildExperienceMemory(junk).ok, false, `${String(junk)} is refused, not thrown on`);
  }
});

test("confidence is clamped and unknown enums fall back rather than propagating", () => {
  const m = build({ confidence: 99, sentiment: "ecstatic", importance: "VERY", scope: "EVERYWHERE" });
  assert.equal(m.confidence, 1, "confidence cannot exceed certainty");
  assert.equal(buildExperienceMemory({ tenantId: "t", userId: "u", experience: "x", entity: { name: "a" }, confidence: -5 }).memory.confidence, 0);
  assert.equal(m.sentiment, SENTIMENTS.NEUTRAL, "an unrecognised sentiment is not invented");
  assert.equal(m.importance, IMPORTANCE.NORMAL);
  assert.ok(Object.values(SCOPES).includes(m.scope), "and the scope is always a real one");
});

test("matchesScope never throws", () => {
  for (const m of [null, undefined, 5, {}, { location: null }]) {
    for (const p of [null, undefined, 5, {}, { lat: "x" }]) {
      assert.equal(typeof matchesScope(m, p, { tenantId: "t" }), "boolean");
    }
  }
});
