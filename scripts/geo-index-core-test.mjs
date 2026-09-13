// Finding nearby memories in a store that cannot search.
//
// The failure this guards against is invisible. If the index does not return a
// memory, nothing errors: the memory still exists, still looks right in the UI,
// and simply never fires. Nobody reports a notification that did not arrive.
// So the coverage property is tested by sweep, not by example.

import test from "node:test";
import assert from "node:assert/strict";
import {
  GRID_LEVELS, MAX_KEYS_PER_QUERY, MAX_INDEXED_RADIUS_M,
  metresPerDegreeLon, levelForRadius, cellIndex, cellKey, maxIndexableRadiusM,
  keyForMemory, keysToQuery, isReachable,
} from "../src/lib/geo-index-core.mjs";

const R = 6_371_000;
const rad = (d) => d * (Math.PI / 180);
const deg = (r) => r * (180 / Math.PI);

/** A point `d` metres from (lat,lon) on `bearing` degrees. Spherical, exact enough. */
function destination(lat, lon, d, bearing) {
  const dR = d / R;
  const br = rad(bearing);
  const p1 = rad(lat);
  const l1 = rad(lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(dR) + Math.cos(p1) * Math.sin(dR) * Math.cos(br));
  const l2 = l1 + Math.atan2(Math.sin(br) * Math.sin(dR) * Math.cos(p1), Math.cos(dR) - Math.sin(p1) * Math.sin(p2));
  return { lat: deg(p2), lon: ((deg(l2) + 540) % 360) - 180 };
}

function haversine(aLat, aLon, bLat, bLon) {
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/* ── the property everything depends on ─────────────────────────────────── */

test("A MEMORY IS FINDABLE FROM EVERY POINT INSIDE ITS OWN RADIUS", () => {
  const tenant = "tnt_a";
  const latitudes = [0, 12.5, 25, 45, 60, 71];
  const radii = [30, 75, 100, 200, 500, 1_000, 5_000, 15_000, 100_000];
  const lons = [0, 55.3, -122.4, 179.4];

  let checked = 0;
  const misses = [];

  for (const lat of latitudes) {
    for (const lon of lons) {
      for (const rawRadius of radii) {
        // Ask only for what the grid promises at this latitude; the promise
        // itself is asserted separately below.
        const radiusM = Math.min(rawRadius, maxIndexableRadiusM(lat));
        const place = { lat, lon };
        for (let bearing = 0; bearing < 360; bearing += 15) {
          // Right on the edge of the fence is the hardest case.
          for (const frac of [0.01, 0.5, 0.999]) {
            const p = destination(lat, lon, radiusM * frac, bearing);
            checked++;
            if (!isReachable(tenant, place, radiusM, p.lat, p.lon)) {
              misses.push(`lat=${lat} lon=${lon} r=${radiusM} brg=${bearing} frac=${frac}`);
            }
          }
        }
      }
    }
  }

  assert.equal(
    misses.length,
    0,
    `${misses.length} of ${checked} positions inside a fence could not find their own memory. A miss here is a memory that exists, looks correct, and never fires. First few: ${misses.slice(0, 5).join(" | ")}`,
  );
  assert.ok(checked > 5_000, `the sweep must actually be a sweep (checked ${checked})`);
});

test("longitude convergence is respected, not assumed away", () => {
  // A degree of longitude is ~111 km at the equator and ~55 km at 60 degrees.
  // Treating them as equal would make high-latitude cells narrower than the
  // coverage maths assumes, and memories there would quietly stop being found.
  assert.ok(Math.abs(metresPerDegreeLon(0) - 111_320) < 10);
  assert.ok(Math.abs(metresPerDegreeLon(60) - 55_660) < 200, "half the width at 60 degrees");
  assert.ok(metresPerDegreeLon(89.99) > 0, "and it never reaches zero and divides by it");
  assert.ok(Number.isNaN(metresPerDegreeLon("x")));

  // The same radius at a higher latitude may need a coarser level.
  assert.ok(
    levelForRadius(1_000, 70) >= levelForRadius(1_000, 0),
    "a 1 km fence near the pole needs at least as coarse a cell as one at the equator",
  );
});

/* ── cost ───────────────────────────────────────────────────────────────── */

test("A LOOKUP COSTS A CONSTANT, KNOWN NUMBER OF READS", () => {
  // This runs on every location event. If the cost scaled with the number of
  // memories the feature could not be switched on for a real user.
  for (const [lat, lon] of [[0, 0], [25.2697, 55.3095], [-33.86, 151.2], [71, 179.9]]) {
    const keys = keysToQuery("tnt_a", lat, lon);
    assert.ok(keys.length <= MAX_KEYS_PER_QUERY, `${keys.length} keys exceeds the stated bound of ${MAX_KEYS_PER_QUERY}`);
    assert.ok(keys.length > 0);
    assert.equal(new Set(keys).size, keys.length, "and it never reads the same key twice");
  }
  assert.equal(MAX_KEYS_PER_QUERY, GRID_LEVELS.length * 9);
});

test("the number of reads does not depend on how many memories exist", () => {
  const a = keysToQuery("tnt_a", 25.2697, 55.3095).length;
  const b = keysToQuery("tnt_b", 25.2697, 55.3095).length;
  assert.equal(a, b, "the key set is a function of position alone");
});

/* ── tenant isolation ───────────────────────────────────────────────────── */

test("TENANTS CANNOT READ EACH OTHER'S CELLS", () => {
  const place = { lat: 25.2697, lon: 55.3095 };
  const mine = keyForMemory("tnt_a", place, 100);
  const theirs = keyForMemory("tnt_b", place, 100);

  assert.notEqual(mine, theirs, "the same doorway must produce different keys for different tenants");
  assert.ok(!keysToQuery("tnt_b", place.lat, place.lon).includes(mine), "isolation is in the key, not a filter that can be forgotten");
  assert.ok(keysToQuery("tnt_a", place.lat, place.lon).includes(mine));
});

/* ── the antimeridian ───────────────────────────────────────────────────── */

test("A MEMORY NEXT TO THE ANTIMERIDIAN IS FOUND FROM THE OTHER SIDE", () => {
  // 179.999 and -179.999 are about 200 m apart. Arithmetic that treats
  // longitude as a line rather than a circle puts them in cells half a world
  // apart, and the memory is never found.
  const place = { lat: 10, lon: 179.999 };
  const justAcross = { lat: 10, lon: -179.999 };
  assert.ok(haversine(place.lat, place.lon, justAcross.lat, justAcross.lon) < 300, "the two points really are close");
  assert.equal(isReachable("tnt_a", place, 500, justAcross.lat, justAcross.lon), true, "and the index must agree");
  assert.equal(isReachable("tnt_a", justAcross, 500, place.lat, place.lon), true, "in both directions");
});

test("cells wrap in longitude and clamp in latitude", () => {
  const a = cellIndex(10, 180, 0);
  const b = cellIndex(10, -180, 0);
  assert.deepEqual(a, b, "+180 and -180 are the same meridian, not two");

  // There is no cell north of the pole; fabricating one would index memories
  // into a region no lookup ever visits.
  const keys = keysToQuery("tnt_a", 89.999, 0);
  assert.ok(keys.length > 0 && keys.length <= MAX_KEYS_PER_QUERY);
  for (const k of keys) {
    const latIdx = Number(k.split(":")[5]);
    const level = Number(k.split(":")[4]);
    assert.ok(latIdx <= Math.floor(90 / GRID_LEVELS[level]), `${k} is beyond the pole`);
  }
});

/* ── level selection ────────────────────────────────────────────────────── */

test("a small fence is filed in a small cell, a city-sized one is not", () => {
  const fine = levelForRadius(100, 25);
  const coarse = levelForRadius(15_000, 25);
  assert.ok(fine < coarse, "otherwise every shop in a district shares one key and the lookup stops being selective");
  assert.equal(levelForRadius(0, 25), 0);
  assert.equal(levelForRadius(-5, 25), 0, "nonsense does not select a world-sized cell");
  assert.equal(levelForRadius(1e9, 25), GRID_LEVELS.length - 1, "and nothing exceeds the coarsest level");
});

test("THE COVERAGE CEILING IS A PROMISE, NOT A SILENT DEGRADATION", () => {
  // Every populated latitude must support a fence far larger than any real
  // one. Longyearbyen, the northernmost town, sits at about 78 degrees.
  for (const lat of [0, 25, 45, 60, 71, 78]) {
    assert.ok(
      maxIndexableRadiusM(lat) >= 150_000,
      `at ${lat} degrees the grid covers only ${maxIndexableRadiusM(lat)} m, less than the 150 km ceiling it advertises`,
    );
  }
  // And a fence beyond the ceiling is clamped to something reachable rather
  // than filed at a level that cannot find it.
  const lat = 82;
  const beyond = maxIndexableRadiusM(lat) * 4;
  assert.equal(isReachable("tnt_a", { lat, lon: 0 }, beyond, lat, 0), true, "the clamped key is still its own key");
});

test("an absurd radius is capped rather than filed somewhere unfindable", () => {
  const key = keyForMemory("tnt_a", { lat: 25, lon: 55 }, 1e12);
  assert.ok(typeof key === "string" && key.length > 0);
  assert.ok(isReachable("tnt_a", { lat: 25, lon: 55 }, MAX_INDEXED_RADIUS_M, 25, 55), "and the cap is itself reachable");
});

/* ── robustness ─────────────────────────────────────────────────────────── */

test("it never throws and refuses what it cannot index", () => {
  for (const t of [null, undefined, "", "   ", 5]) {
    assert.equal(keyForMemory(t, { lat: 1, lon: 1 }, 100), null, "a memory with no tenant has no key");
    assert.deepEqual(keysToQuery(t, 1, 1), [], "and no cells to search");
  }
  for (const loc of [null, undefined, {}, { lat: "x", lon: 1 }, { lat: NaN, lon: 1 }]) {
    assert.equal(keyForMemory("tnt_a", loc, 100), null);
  }
  for (const [lat, lon] of [[NaN, 0], [0, NaN], ["1", 0], [null, null]]) {
    assert.deepEqual(keysToQuery("tnt_a", lat, lon), []);
  }
  assert.equal(cellKey("tnt_a", null), null);
  assert.equal(cellIndex(NaN, 0, 0), null);
});

test("keys are stable and readable", () => {
  const k = keyForMemory("tnt_a", { lat: 25.2697, lon: 55.3095 }, 100);
  assert.match(k, /^mira:xm:cell:tnt_a:\d+:-?\d+:-?\d+$/, "a key an operator can read in a store dump");
  assert.equal(k, keyForMemory("tnt_a", { lat: 25.2697, lon: 55.3095 }, 100), "and the same input always gives the same key");
});
