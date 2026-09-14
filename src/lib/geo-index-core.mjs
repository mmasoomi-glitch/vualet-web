/**
 * Finding the memories near a point, in a store that cannot search.
 *
 * "Query nearby active experience memories" is one line in a design document
 * and the hardest thing in this feature to build here. This app's key-value
 * store offers get, set and delete. There is no geospatial query, no range
 * scan worth relying on, and no index to lean on. Scanning every memory to
 * measure its distance would work for ten memories and fall over long before
 * it mattered.
 *
 * So the position decides the key. Space is cut into a fixed grid, a memory is
 * filed under the cell it falls in, and a lookup reads the cell the user is
 * standing in plus the eight around it. Nine reads, always, whether the tenant
 * has ten memories or ten million. Nothing is scanned because nothing needs to
 * be: the key is computable from the coordinates on both sides.
 *
 * ── WHY SEVERAL GRID SIZES ────────────────────────────────────────────────
 * A reminder about a shop needs a fence of about a hundred metres. "Traffic
 * around Deira is bad in the evening" needs kilometres. One grid cannot serve
 * both: cells sized for the city would put every shop in a district into one
 * key, and cells sized for a shop would need thousands of reads to cover a
 * district. Each memory is filed at the level matching its own reach, and a
 * lookup reads every level — thirty-six reads, still constant.
 *
 * ── THE PROPERTY THAT MUST HOLD ───────────────────────────────────────────
 * A memory must be findable from ANY point inside its own trigger radius. If
 * that fails the memory still exists, still looks correct in the UI, and simply
 * never fires — the worst kind of bug, because nothing reports it. The grid
 * level is therefore chosen so that the nine-cell block always reaches at least
 * as far as the memory's radius, with longitude convergence accounted for.
 *
 * PURE: no imports, no I/O, no clock.
 */

/**
 * Cell sizes in degrees of latitude.
 *
 * 0.01 deg ~ 1.1 km, 0.1 deg ~ 11 km, 1 deg ~ 111 km, 10 deg ~ 1100 km. Four
 * levels span a shop doorway to a region without any level being wasteful.
 *
 * The coarsest exists only because meridians converge: at 45 degrees a 1 degree
 * cell is ~79 km wide, so a 100 km fence filed there would NOT be found from
 * its own edge. A sweep caught exactly that, in 105 of 15552 probed positions.
 */
export const GRID_LEVELS = Object.freeze([0.01, 0.1, 1, 10]);

/** Metres per degree of latitude. Constant enough everywhere for this purpose. */
const M_PER_DEG_LAT = 111_320;

/** Largest radius we will index at all. Beyond this, a fence is not a place. */
export const MAX_INDEXED_RADIUS_M = 150_000;

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * Metres covered per degree of longitude at a given latitude.
 *
 * Meridians converge toward the poles, so a degree of longitude in Dubai is
 * about 101 km and in Reykjavik about 55 km. Ignoring this would make cells
 * narrower than assumed at high latitude and silently break the coverage
 * property the whole index depends on.
 */
export function metresPerDegreeLon(lat) {
  if (!num(lat)) return NaN;
  return Math.max(1, Math.cos(Math.min(89.9, Math.abs(lat)) * (Math.PI / 180)) * M_PER_DEG_LAT);
}

/**
 * The coarsest-to-finest level whose nine-cell block reaches `radiusM`.
 *
 * Returns the FINEST level that still covers the radius, so that a small fence
 * is filed in a small cell and lookups stay selective.
 */
export function levelForRadius(radiusM, lat) {
  if (!num(radiusM) || radiusM <= 0) return 0;
  const mPerLon = metresPerDegreeLon(num(lat) ? lat : 0);

  for (let i = 0; i < GRID_LEVELS.length; i++) {
    const deg = GRID_LEVELS[i];
    // A 3x3 block reaches at least one whole cell in every direction.
    const reachLatM = deg * M_PER_DEG_LAT;
    const reachLonM = deg * mPerLon;
    if (Math.min(reachLatM, reachLonM) >= radiusM) return i;
  }
  return GRID_LEVELS.length - 1;
}

/**
 * The largest radius the grid can genuinely cover at this latitude.
 *
 * Exists so the limit is a value a caller can read and assert on, rather than
 * something that degrades silently. Before this existed, a fence larger than
 * the coarsest cell was filed at the coarsest level anyway and simply could not
 * be found from its own edge — the index reported success and the memory never
 * fired.
 */
export function maxIndexableRadiusM(lat) {
  const coarsest = GRID_LEVELS[GRID_LEVELS.length - 1];
  return Math.min(MAX_INDEXED_RADIUS_M, Math.floor(coarsest * Math.min(M_PER_DEG_LAT, metresPerDegreeLon(num(lat) ? lat : 0))));
}

/** Number of longitude cells around the world at a level; used for wrapping. */
const lonCellCount = (deg) => Math.round(360 / deg);

/**
 * Grid coordinates for a position at a level.
 *
 * Latitude is clamped rather than wrapped: there is no cell north of the pole.
 * Longitude wraps, because 179.999 and -179.999 are neighbours and a memory
 * filed either side of the antimeridian must still be found from the other.
 */
export function cellIndex(lat, lon, level) {
  const deg = GRID_LEVELS[level] ?? GRID_LEVELS[0];
  if (!num(lat) || !num(lon)) return null;

  const clampedLat = Math.min(90, Math.max(-90, lat));
  let wrappedLon = ((lon + 180) % 360 + 360) % 360 - 180;
  if (wrappedLon === 180) wrappedLon = -180;

  return {
    level,
    latIdx: Math.floor(clampedLat / deg),
    lonIdx: Math.floor(wrappedLon / deg),
  };
}

/** The KV key a cell is stored under. Tenant is part of the key, not a filter. */
export function cellKey(tenantId, cell) {
  if (!str(tenantId) || !cell) return null;
  return `mira:xm:cell:${tenantId.trim()}:${cell.level}:${cell.latIdx}:${cell.lonIdx}`;
}

/**
 * The single key a memory is filed under.
 *
 * A memory lives in exactly one cell at exactly one level, chosen from its own
 * radius. Filing it in several would multiply the writes and, worse, make
 * deletion a multi-key operation this store cannot perform atomically.
 */
export function keyForMemory(tenantId, location, radiusM) {
  if (!str(tenantId) || !location || !num(location.lat) || !num(location.lon)) return null;
  // Clamped to what the grid can actually cover HERE, so the key we return is
  // one that a lookup from inside that radius will genuinely visit.
  const radius = Math.min(num(radiusM) ? radiusM : 100, maxIndexableRadiusM(location.lat));
  const level = levelForRadius(radius, location.lat);
  return cellKey(tenantId, cellIndex(location.lat, location.lon, level));
}

/**
 * Every key that could hold a memory relevant to this position.
 *
 * Nine cells per level, every level. The count is constant and known ahead of
 * time, which is what makes this safe to run on every location event.
 */
export function keysToQuery(tenantId, lat, lon) {
  if (!str(tenantId) || !num(lat) || !num(lon)) return [];

  const keys = [];
  const seen = new Set();

  for (let level = 0; level < GRID_LEVELS.length; level++) {
    const deg = GRID_LEVELS[level];
    const centre = cellIndex(lat, lon, level);
    if (!centre) continue;
    const lonCells = lonCellCount(deg);
    const maxLatIdx = Math.floor(90 / deg);
    const minLatIdx = Math.floor(-90 / deg);

    for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dLon = -1; dLon <= 1; dLon++) {
        const latIdx = centre.latIdx + dLat;
        // Past the pole there is nothing; do not fabricate a cell.
        if (latIdx > maxLatIdx || latIdx < minLatIdx) continue;
        // Longitude is a circle: the cell east of the antimeridian is the one
        // west of it, so a memory filed at +179.99 is found from -179.99.
        const lonIdx = ((centre.lonIdx + dLon) % lonCells + lonCells) % lonCells;
        const normalised = lonIdx >= lonCells / 2 ? lonIdx - lonCells : lonIdx;

        const key = cellKey(tenantId, { level, latIdx, lonIdx: normalised });
        if (key && !seen.has(key)) {
          seen.add(key);
          keys.push(key);
        }
      }
    }
  }
  return keys;
}

/** Upper bound on reads per lookup, so the cost is knowable in advance. */
export const MAX_KEYS_PER_QUERY = GRID_LEVELS.length * 9;

/**
 * Would a memory at `memLoc` with `radiusM` be found from `fromLat/fromLon`?
 *
 * Exposed so the property can be asserted in tests and, if it ever fails in
 * production, checked directly rather than inferred from a silent non-event.
 */
export function isReachable(tenantId, memLoc, radiusM, fromLat, fromLon) {
  const key = keyForMemory(tenantId, memLoc, radiusM);
  if (!key) return false;
  return keysToQuery(tenantId, fromLat, fromLon).includes(key);
}
