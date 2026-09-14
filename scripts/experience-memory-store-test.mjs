// A remembered experience, from saving it to it coming back.
//
// The three pure cores are tested on their own. This exercises them through
// the actual store, because the joins are where this feature can still fail
// silently: a memory saved but never indexed, an index that survives a delete,
// a retired warning that keeps firing, or one tenant's life visible to another.

import test from "node:test";
import assert from "node:assert/strict";
import { resetNet } from "./route-harness/index.mjs";
import { DECISIONS } from "../src/lib/context-trigger-core.mjs";
import { SENTIMENTS, IMPORTANCE, SCOPES, STATUS } from "../src/lib/experience-memory-core.mjs";

const store = () => import("../src/lib/experience-memory-store.ts");

const RIGGA = { lat: 25.2697, lon: 55.3095 };
const JUMEIRAH = { lat: 25.2715, lon: 55.3095 }; // ~200 m away
const FAR = { lat: 25.35, lon: 55.42 };

const T = 1_800_000_000_000;
const HOUR = 3_600_000;

const pizza = (over = {}) => ({
  tenantId: "tnt_a",
  userId: "usr_1",
  experience: "Pizza quality was very poor.",
  preference: "Avoid buying pizza from this location.",
  category: "food.restaurant.pizza",
  entity: { name: "Tom's Pizza", placeId: "place_rigga" },
  sentiment: SENTIMENTS.STRONG_NEGATIVE,
  confidence: 0.94,
  scope: SCOPES.THIS_BRANCH,
  location: RIGGA,
  ...over,
});

/** A location event at a place, with a unique id unless one is given. */
let seq = 0;
const evt = (loc, over = {}) => ({ eventId: `ev_${++seq}`, lat: loc.lat, lon: loc.lon, ...over });

/* ── the directive's end-to-end scenario ────────────────────────────────── */

test("THE PIZZA SCENARIO WORKS END TO END", async () => {
  resetNet();
  const s = await store();

  // 20:14, standing in Tom's Pizza: "This pizza is awful. Remind me never to
  // buy from here again."
  const saved = await s.saveMemory(pizza(), T);
  assert.equal(saved.ok, true, saved.reason);
  assert.ok(saved.memory.id.startsWith("xm_"), "it is given a durable id");

  // Weeks later, they walk back in.
  const place = { placeId: "place_rigga", name: "Tom's Pizza" };
  const later = T + 30 * 24 * HOUR;

  const near = await s.nearbyMemories("tnt_a", RIGGA.lat, RIGGA.lon, place, "usr_1");
  assert.equal(near.length, 1, "the memory is found from the doorway without scanning anything");
  assert.equal(near[0].preference, "Avoid buying pizza from this location.");

  // Arrival, then still there past the dwell.
  const first = await s.evaluateArrival("tnt_a", evt(RIGGA), place, "usr_1", later);
  assert.equal(first.fired.length, 0, "arriving is not yet a visit");
  assert.equal(first.considered, 1);

  const settled = await s.evaluateArrival("tnt_a", evt(RIGGA), place, "usr_1", later + 40_000);
  assert.equal(settled.fired.length, 1, "once they have settled, the warning comes back unprompted");
  assert.equal(settled.fired[0].experience, "Pizza quality was very poor.");
});

test("a redelivered event does not produce a second warning", async () => {
  resetNet();
  const s = await store();
  await s.saveMemory(pizza({ userId: "usr_dup" }), T);
  const place = { placeId: "place_rigga", name: "Tom's Pizza" };

  await s.evaluateArrival("tnt_a", evt(RIGGA), place, "usr_dup", T);
  const same = { eventId: "ev_fixed", lat: RIGGA.lat, lon: RIGGA.lon };

  const a = await s.evaluateArrival("tnt_a", same, place, "usr_dup", T + 40_000);
  const b = await s.evaluateArrival("tnt_a", same, place, "usr_dup", T + 40_100);
  assert.equal(a.fired.length, 1);
  assert.equal(b.fired.length, 0, "the operating system redelivering must not warn twice");
  assert.equal(b.decisions[DECISIONS.IGNORED_DUPLICATE], 1);
});

test("the state survives across calls, so a restart does not re-notify", async () => {
  resetNet();
  const s = await store();
  const saved = await s.saveMemory(pizza({ userId: "usr_state" }), T);
  const place = { placeId: "place_rigga", name: "Tom's Pizza" };

  await s.evaluateArrival("tnt_a", evt(RIGGA), place, "usr_state", T);
  await s.evaluateArrival("tnt_a", evt(RIGGA), place, "usr_state", T + 40_000);

  const persisted = await s.getTriggerState("tnt_a", saved.memory.id);
  assert.equal(persisted.fireCount, 1, "the fire is recorded in the store, not only in memory");
  assert.equal(persisted.inside, true, "and so is the fact that they are still there");
});

/* ── the branch rule, through the store ─────────────────────────────────── */

test("THE OTHER BRANCH DOES NOT INHERIT THE WARNING", async () => {
  resetNet();
  const s = await store();
  await s.saveMemory(pizza({ userId: "usr_br" }), T);

  const other = await s.evaluateArrival(
    "tnt_a",
    evt(JUMEIRAH),
    { placeId: "place_jumeirah", name: "Tom's Pizza" },
    "usr_br",
    T + 10 * HOUR,
  );
  assert.equal(other.fired.length, 0, "200 m away and the same brand is still a different restaurant");
});

test("somewhere unrelated returns nothing at all", async () => {
  resetNet();
  const s = await store();
  await s.saveMemory(pizza({ userId: "usr_far" }), T);
  const far = await s.nearbyMemories("tnt_a", FAR.lat, FAR.lon, {}, "usr_far");
  assert.equal(far.length, 0);
});

/* ── tenant isolation, through the store ────────────────────────────────── */

test("ONE TENANT CANNOT SEE ANOTHER TENANT'S LIFE", async () => {
  resetNet();
  const s = await store();
  const mine = await s.saveMemory(pizza({ tenantId: "tnt_a", userId: "u" }), T);

  assert.equal(await s.getMemory("tnt_b", mine.memory.id), null, "not by guessing the id");

  const theirs = await s.nearbyMemories("tnt_b", RIGGA.lat, RIGGA.lon, { placeId: "place_rigga", name: "Tom's Pizza" }, "u");
  assert.equal(theirs.length, 0, "and not by standing in the same doorway");

  const theirList = await s.listMemories("tnt_b", "u");
  assert.equal(theirList.length, 0, "and not by listing");
});

/* ── the user's own control ─────────────────────────────────────────────── */

test('"forget what I said about Tom\'s Pizza" actually forgets it', async () => {
  resetNet();
  const s = await store();
  const saved = await s.saveMemory(pizza({ userId: "usr_del" }), T);
  const place = { placeId: "place_rigga", name: "Tom's Pizza" };

  assert.equal(await s.deleteMemory("tnt_a", saved.memory.id), true);
  assert.equal(await s.getMemory("tnt_a", saved.memory.id), null, "the record is gone");

  const near = await s.nearbyMemories("tnt_a", RIGGA.lat, RIGGA.lon, place, "usr_del");
  assert.equal(near.length, 0, "and it is gone from the index too — a deleted memory that still fires is the worst outcome here");

  const listed = await s.listMemories("tnt_a", "usr_del", { includeRetired: true });
  assert.equal(listed.length, 0, "and gone from their own list");
  assert.equal(await s.deleteMemory("tnt_a", saved.memory.id), false, "deleting twice is not an error");
});

test('"actually the food is good now" retires the warning', async () => {
  resetNet();
  const s = await store();
  const jan = await s.saveMemory(pizza({ userId: "usr_sup" }), T);
  const aug = await s.saveMemory(
    pizza({ userId: "usr_sup", sentiment: SENTIMENTS.POSITIVE, experience: "Tried it again, very good now." }),
    T + 200 * 24 * HOUR,
  );

  const r = await s.supersedeMemory("tnt_a", jan.memory.id, aug.memory, T + 200 * 24 * HOUR);
  assert.equal(r.superseded, true, r.reason);

  const retired = await s.getMemory("tnt_a", jan.memory.id);
  assert.equal(retired.status, STATUS.SUPERSEDED);

  const place = { placeId: "place_rigga", name: "Tom's Pizza" };
  const near = await s.nearbyMemories("tnt_a", RIGGA.lat, RIGGA.lon, place, "usr_sup");
  assert.ok(
    !near.some((m) => m.id === jan.memory.id),
    "the old warning must stop coming back once the user has told us the place got better",
  );
});

test("moving a memory moves where it is looked for", async () => {
  resetNet();
  const s = await store();
  const saved = await s.saveMemory(pizza({ userId: "usr_mv" }), T);
  const place = { placeId: "place_rigga", name: "Tom's Pizza" };

  const moved = await s.updateMemory("tnt_a", saved.memory.id, { location: FAR }, T + HOUR);
  assert.equal(moved.ok, true, moved.reason);

  const atOld = await s.nearbyMemories("tnt_a", RIGGA.lat, RIGGA.lon, place, "usr_mv");
  assert.equal(atOld.length, 0, "it is no longer found at the old position");

  const atNew = await s.nearbyMemories("tnt_a", FAR.lat, FAR.lon, place, "usr_mv");
  assert.equal(atNew.length, 1, "and IS found at the new one — otherwise it would quietly never fire again");
});

test("ownership cannot be changed by a request body", async () => {
  resetNet();
  const s = await store();
  const saved = await s.saveMemory(pizza({ userId: "usr_own" }), T);

  const patched = await s.updateMemory(
    "tnt_a",
    saved.memory.id,
    { tenantId: "tnt_evil", userId: "usr_evil", id: "xm_evil" },
    T + HOUR,
  );
  assert.equal(patched.ok, true);
  assert.equal(patched.memory.tenantId, "tnt_a", "a patch must not be able to move a memory between tenants");
  assert.equal(patched.memory.userId, "usr_own");
  assert.equal(patched.memory.id, saved.memory.id);
});

test("a switched-off memory stays stored but stops firing", async () => {
  resetNet();
  const s = await store();
  const saved = await s.saveMemory(pizza({ userId: "usr_off" }), T);
  const place = { placeId: "place_rigga", name: "Tom's Pizza" };

  assert.equal(await s.setMemoryEnabled("tnt_a", saved.memory.id, false), true);
  await s.evaluateArrival("tnt_a", evt(RIGGA), place, "usr_off", T);
  const r = await s.evaluateArrival("tnt_a", evt(RIGGA), place, "usr_off", T + 40_000);

  assert.equal(r.fired.length, 0, "disabled means silent");
  assert.equal(r.decisions[DECISIONS.IGNORED_DISABLED], 1);
  assert.ok(await s.getMemory("tnt_a", saved.memory.id), "but it is not deleted — off is not gone");
});

/* ── the index's failure mode ───────────────────────────────────────────── */

test("A TORN INDEX REPAIRS ITSELF RATHER THAN ACCUMULATING RUBBISH", async () => {
  resetNet();
  const s = await store();
  const base = await import("../src/lib/store.ts");
  const saved = await s.saveMemory(pizza({ userId: "usr_torn" }), T);

  // Simulate the record being lost while the index entry survives — the shape
  // a crash between the two writes would leave.
  await base.kvDel(`mira:xm:mem:tnt_a:${saved.memory.id}`);

  const near = await s.nearbyMemories("tnt_a", RIGGA.lat, RIGGA.lon, { placeId: "place_rigga" }, "usr_torn");
  assert.equal(near.length, 0, "an id that resolves to nothing is not returned");

  const cell = await base.kvGet(saved.memory.indexKey);
  assert.ok(!Array.isArray(cell) || !cell.includes(saved.memory.id), "and it is swept out of the cell on the way past");
});

test("reindex can rebuild an index entry that was lost", async () => {
  resetNet();
  const s = await store();
  const base = await import("../src/lib/store.ts");
  const saved = await s.saveMemory(pizza({ userId: "usr_re" }), T);

  // The documented race: the memory is written, the index write is lost.
  await base.kvSet(saved.memory.indexKey, []);
  const place = { placeId: "place_rigga", name: "Tom's Pizza" };
  assert.equal((await s.nearbyMemories("tnt_a", RIGGA.lat, RIGGA.lon, place, "usr_re")).length, 0, "so it cannot be found");

  assert.equal(await s.reindexMemory("tnt_a", saved.memory.id), true);
  assert.equal(
    (await s.nearbyMemories("tnt_a", RIGGA.lat, RIGGA.lon, place, "usr_re")).length,
    1,
    "and the repair path restores it",
  );
});

/* ── refusals ───────────────────────────────────────────────────────────── */

test("it refuses to store something it could never recall", async () => {
  resetNet();
  const s = await store();
  const bad = await s.saveMemory({ tenantId: "tnt_a", userId: "u", experience: "it was bad" }, T);
  assert.equal(bad.ok, false, "no place, no entity, no coordinates — nothing to ever match on");
  assert.ok(bad.reason.length > 0);

  assert.equal((await s.updateMemory("tnt_a", "xm_nope", {}, T)).ok, false, "and it does not invent a memory to patch");
  assert.equal(await s.setMemoryEnabled("tnt_a", "xm_nope", false), false);
  assert.equal(await s.reindexMemory("tnt_a", "xm_nope"), false);
  assert.deepEqual(await s.listMemories("", ""), []);
  assert.deepEqual(await s.nearbyMemories("", 1, 1), []);
});

test("importance widens the fence all the way through the store", async () => {
  resetNet();
  const s = await store();
  const critical = await s.saveMemory(
    pizza({ userId: "usr_imp", importance: IMPORTANCE.CRITICAL, category: "parking", experience: "Car was towed from here." }),
    T,
  );
  const normal = await s.saveMemory(pizza({ userId: "usr_imp2", importance: IMPORTANCE.NORMAL }), T);
  assert.ok(
    critical.memory.trigger.entryRadiusM > normal.memory.trigger.entryRadiusM,
    '"the car was towed" must reach the user before they park, not as they walk away',
  );
});
