/**
 * What the assistant learned from something that happened to you.
 *
 * "The pizza here was terrible, remind me never to buy from here again" is not
 * a note. It is an experience, a judgement, a future preference, a place, a
 * business, and an instruction to bring it back later — six things, and a
 * system that stores only the sentence has stored almost none of it.
 *
 * This module is the model and the rules around it. It is deliberately NOT
 * about GPS: location is one way a memory becomes relevant again, and the
 * architecture must not be built as though it were the only one. Triggers live
 * in context-trigger-core.mjs precisely so that a memory can later be recalled
 * by time, by a person, by a calendar event or by a topic without any of this
 * being rewritten.
 *
 * ── THE RULE THAT MATTERS MOST ────────────────────────────────────────────
 * A memory about one branch of a chain is not a memory about the chain. Being
 * warned off every Tom's Pizza in the country because one branch was bad is a
 * worse failure than saying nothing: it is confidently wrong, repeatedly, in a
 * place the user cannot correct it. Branch identity is therefore checked before
 * coordinates, and widening to a whole brand requires the user to have said so.
 *
 * ── THE SECOND RULE ───────────────────────────────────────────────────────
 * Experience is not immutable. "I tried it again and it was good now" must be
 * able to retire the old warning instead of sitting beside it forever. Storing
 * both and warning anyway is how a memory system becomes something people
 * switch off.
 *
 * PURE: no imports, no I/O, no clock, no randomness. Time arrives as a NUMBER.
 * Nothing throws; bad input is refused with a reason.
 */

export const SCOPES = Object.freeze({
  THIS_EXACT_POSITION: 'THIS_EXACT_POSITION',
  THIS_VENUE: 'THIS_VENUE',
  THIS_BRANCH: 'THIS_BRANCH',
  THIS_BUILDING: 'THIS_BUILDING',
  THIS_AREA: 'THIS_AREA',
  ALL_BRANCHES_OF_ENTITY: 'ALL_BRANCHES_OF_ENTITY',
  CITY: 'CITY',
  CUSTOM_RADIUS: 'CUSTOM_RADIUS',
});

export const IMPORTANCE = Object.freeze({ LOW: 'LOW', NORMAL: 'NORMAL', HIGH: 'HIGH', CRITICAL: 'CRITICAL' });

export const SENTIMENTS = Object.freeze({
  STRONG_NEGATIVE: 'strong_negative',
  NEGATIVE: 'negative',
  NEUTRAL: 'neutral',
  POSITIVE: 'positive',
  STRONG_POSITIVE: 'strong_positive',
});

export const STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  SUPERSEDED: 'SUPERSEDED',
  ARCHIVED: 'ARCHIVED',
  DISABLED: 'DISABLED',
});

/**
 * How precisely a memory's position is stored.
 *
 * "Traffic around Deira is terrible in the evening" does not need to record
 * where the user was standing when they said it. Precision is reduced at the
 * point of storage, not at the point of display — a coarse label over exact
 * coordinates is not privacy, it is exact coordinates with a label.
 */
export const PRECISION = Object.freeze({
  EXACT: 'EXACT',
  VENUE: 'VENUE',
  APPROXIMATE: 'APPROXIMATE',
  NEIGHBOURHOOD: 'NEIGHBOURHOOD',
  CITY: 'CITY',
});

/** Decimal places kept per precision. 4dp ~ 11 m, 3dp ~ 111 m, 2dp ~ 1.1 km, 1dp ~ 11 km. */
const PRECISION_DP = Object.freeze({ EXACT: 7, VENUE: 4, APPROXIMATE: 3, NEIGHBOURHOOD: 2, CITY: 1 });

/** Default fence per scope, in metres, before importance widens it. */
const SCOPE_RADIUS_M = Object.freeze({
  THIS_EXACT_POSITION: 30,
  THIS_VENUE: 75,
  THIS_BRANCH: 100,
  THIS_BUILDING: 120,
  THIS_AREA: 500,
  ALL_BRANCHES_OF_ENTITY: 100,
  CITY: 15_000,
  CUSTOM_RADIUS: 100,
});

/** Importance widens the fence so a serious warning arrives before you commit. */
const IMPORTANCE_RADIUS_FACTOR = Object.freeze({ LOW: 0.8, NORMAL: 1, HIGH: 1.4, CRITICAL: 2 });

export const IMPORTANCE_RANK = Object.freeze({ LOW: 0, NORMAL: 1, HIGH: 2, CRITICAL: 3 });

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v) => typeof v === 'string' && v.trim().length > 0;
const clean = (v) => (str(v) ? v.trim() : '');

/** Case- and punctuation-insensitive key for comparing names and ids. */
function keyOf(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function roundTo(value, dp) {
  if (!num(value)) return NaN;
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

/**
 * Reduce a position to the precision the memory actually needs.
 *
 * Returns a NEW location. The original is not retained anywhere by this
 * function — that is the point.
 */
export function redactToPrecision(location, precision) {
  if (!location || typeof location !== 'object') return null;
  const dp = PRECISION_DP[precision] ?? PRECISION_DP.EXACT;
  if (!num(location.lat) || !num(location.lon)) return null;

  const outLoc = { lat: roundTo(location.lat, dp), lon: roundTo(location.lon, dp), precision: PRECISION[precision] ? precision : PRECISION.EXACT };
  // Accuracy finer than the precision we kept would be a false claim.
  const implied = dp >= 7 ? 0 : 111_320 / 10 ** dp;
  if (num(location.accuracyM)) outLoc.accuracyM = Math.max(location.accuracyM, implied);
  else if (implied > 0) outLoc.accuracyM = implied;
  return outLoc;
}

/** The fence radius this memory should use. */
export function radiusForScope(scope, importance, customRadiusM) {
  if (scope === SCOPES.CUSTOM_RADIUS && num(customRadiusM) && customRadiusM > 0) {
    return Math.min(customRadiusM, 100_000);
  }
  const base = SCOPE_RADIUS_M[scope] ?? SCOPE_RADIUS_M.THIS_BRANCH;
  const factor = IMPORTANCE_RADIUS_FACTOR[importance] ?? 1;
  return Math.round(base * factor);
}

/**
 * Build a validated ExperienceMemory.
 *
 * Refuses rather than guessing: a memory with no subject and no place cannot
 * ever be recalled usefully, and storing it would only make the user believe
 * something was captured when nothing was.
 */
export function buildExperienceMemory(input) {
  const i = input && typeof input === 'object' ? input : {};

  if (!str(i.tenantId)) return { ok: false, reason: 'A memory must belong to a tenant.' };
  if (!str(i.userId)) return { ok: false, reason: 'A memory must belong to a user.' };
  if (!str(i.experience)) return { ok: false, reason: 'A memory needs the experience itself.' };

  const entityName = clean(i.entity?.name);
  const placeId = clean(i.entity?.placeId);
  const hasPlace = i.location && num(i.location.lat) && num(i.location.lon);
  if (!entityName && !placeId && !hasPlace) {
    return { ok: false, reason: 'A memory needs somewhere or something to attach to, or it can never come back.' };
  }

  const scope = SCOPES[i.scope] ?? (placeId || entityName ? SCOPES.THIS_BRANCH : SCOPES.THIS_VENUE);
  const importance = IMPORTANCE[i.importance] ?? IMPORTANCE.NORMAL;
  const precision = PRECISION[i.precision] ?? PRECISION.EXACT;

  // Confidence governs how loudly we are willing to act, so it is clamped and
  // defaulted low rather than assumed.
  const confidence = num(i.confidence) ? Math.min(1, Math.max(0, i.confidence)) : 0.5;
  const sentiment = Object.values(SENTIMENTS).includes(i.sentiment) ? i.sentiment : SENTIMENTS.NEUTRAL;

  const location = hasPlace ? redactToPrecision(i.location, precision) : null;

  return {
    ok: true,
    memory: {
      id: clean(i.id) || null,
      tenantId: clean(i.tenantId),
      userId: clean(i.userId),
      type: 'experience_memory',
      category: clean(i.category) || null,
      entity: entityName || placeId ? { name: entityName || null, placeId: placeId || null } : null,
      experience: clean(i.experience),
      preference: clean(i.preference) || null,
      sentiment,
      importance,
      confidence,
      scope,
      status: STATUS[i.status] ?? STATUS.ACTIVE,
      source: clean(i.source) || 'assistant_conversation',
      location,
      trigger: {
        entryRadiusM: radiusForScope(scope, importance, i.customRadiusM),
        exitRadiusM: Math.round(radiusForScope(scope, importance, i.customRadiusM) * 1.4),
        dwellMs: num(i.dwellMs) ? i.dwellMs : 30_000,
        cooldownMs: num(i.cooldownMs) ? i.cooldownMs : 43_200_000,
        enabled: i.enabled !== false,
        maxFires: num(i.maxFires) && i.maxFires > 0 ? Math.floor(i.maxFires) : null,
      },
      createdAtMs: num(i.createdAtMs) ? i.createdAtMs : null,
      updatedAtMs: num(i.updatedAtMs) ? i.updatedAtMs : null,
      supersedesId: clean(i.supersedesId) || null,
    },
  };
}

/**
 * Does this memory apply where the user now is?
 *
 * Identity beats geometry. Two branches of a chain can sit 200 m apart in one
 * mall, and coordinates alone would fire the wrong warning at the wrong shop.
 * So a known place id that DISAGREES is a refusal, not a fallback to distance.
 */
export function matchesScope(memory, place, options = {}) {
  if (!memory || typeof memory !== 'object' || !place || typeof place !== 'object') return false;

  // Tenant isolation is enforced here, not only in the query layer, so a bug in
  // a caller cannot surface one tenant's experience to another.
  if (str(options.tenantId) && keyOf(memory.tenantId) !== keyOf(options.tenantId)) return false;
  if (str(options.userId) && str(memory.userId) && keyOf(memory.userId) !== keyOf(options.userId)) return false;

  if (memory.status && memory.status !== STATUS.ACTIVE) return false;

  const memPlaceId = keyOf(memory.entity?.placeId);
  const atPlaceId = keyOf(place.placeId);
  const memName = keyOf(memory.entity?.name);
  const atName = keyOf(place.name);

  if (memory.scope === SCOPES.ALL_BRANCHES_OF_ENTITY) {
    // The user explicitly widened this to the brand, so the brand is the test
    // and a different branch id is expected rather than disqualifying.
    return Boolean(memName && atName && memName === atName);
  }

  if (memPlaceId && atPlaceId) {
    // Both sides know exactly which place this is. Anything else is a guess.
    return memPlaceId === atPlaceId;
  }

  if (memory.scope === SCOPES.CITY) {
    const memCity = keyOf(memory.location?.city ?? place.city);
    const atCity = keyOf(place.city);
    if (memCity && atCity && memCity !== atCity) return false;
  }

  // Fall back to geometry, but only when identity could not decide.
  if (!memory.location || !num(memory.location.lat) || !num(place.lat)) {
    // No coordinates either side: a shared name is the only evidence left, and
    // it is only good enough for a same-name match.
    return Boolean(memName && atName && memName === atName);
  }

  const r = radiusForScope(memory.scope, memory.importance, memory.trigger?.entryRadiusM);
  const d = haversine(memory.location.lat, memory.location.lon, place.lat, place.lon);
  if (!num(d) || d > r) return false;

  // Within range AND a conflicting name means a different business at the same
  // spot — a unit that changed hands, or a neighbour. Do not fire.
  if (memName && atName && memName !== atName) return false;
  return true;
}

function haversine(aLat, aLon, bLat, bLon) {
  if (!num(aLat) || !num(aLon) || !num(bLat) || !num(bLon)) return NaN;
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

const OPPOSED = Object.freeze({
  strong_negative: ['positive', 'strong_positive'],
  negative: ['positive', 'strong_positive'],
  positive: ['negative', 'strong_negative'],
  strong_positive: ['negative', 'strong_negative'],
  neutral: [],
});

/**
 * Does the newer memory contradict and therefore replace the older one?
 *
 * Only within the same tenant, the same subject and the same place — a bad
 * meal at one branch says nothing about another, and a positive experience of
 * the coffee does not retire a warning about the parking.
 */
export function detectSupersession(previous, next) {
  const no = (reason) => ({ supersedes: false, contradicts: false, reason });

  if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object') {
    return no('Two memories are needed to compare.');
  }
  if (keyOf(previous.tenantId) !== keyOf(next.tenantId)) return no('Different tenants never interact.');
  if (previous.status !== STATUS.ACTIVE) return no('The earlier memory is not active.');

  // Branch identity first, and DECISIVELY. Two branches of a chain share a
  // name, so matching on "same place id OR same name" would let a good meal at
  // one branch retire the warning about another — the precise confusion this
  // module exists to prevent. Known, differing ids end the comparison; the name
  // is only evidence when at least one side has no id to check.
  const prevId = keyOf(previous.entity?.placeId);
  const nextId = keyOf(next.entity?.placeId);
  if (prevId && nextId) {
    if (prevId !== nextId) return no('These are different branches, whatever they are called.');
  } else {
    const prevName = keyOf(previous.entity?.name);
    const nextName = keyOf(next.entity?.name);
    if (!prevName || prevName !== nextName) return no('These are about different places.');
  }

  // A memory about the pizza should not retire one about the parking.
  const prevCat = keyOf(previous.category);
  const nextCat = keyOf(next.category);
  if (prevCat && nextCat && prevCat !== nextCat) return no('These are about different things at the same place.');

  if (!num(previous.createdAtMs) || !num(next.createdAtMs)) return no('Without times, newer cannot be established.');
  if (next.createdAtMs <= previous.createdAtMs) return no('The candidate is not newer.');

  const contradicts = (OPPOSED[previous.sentiment] ?? []).includes(next.sentiment);
  if (contradicts) {
    return { supersedes: true, contradicts: true, reason: 'A later experience of the same place reverses the earlier judgement.' };
  }
  // Same direction, same subject: a refinement, so the newer one stands.
  if (previous.sentiment === next.sentiment) {
    return { supersedes: true, contradicts: false, reason: 'A later experience of the same place restates the earlier one.' };
  }
  return no('The later experience neither repeats nor reverses the earlier one.');
}

/** Apply a supersession, returning both updated records. Inputs are not mutated. */
export function applySupersession(previous, next, nowMs) {
  const verdict = detectSupersession(previous, next);
  if (!verdict.supersedes) return { changed: false, previous, next, verdict };
  return {
    changed: true,
    verdict,
    previous: { ...previous, status: STATUS.SUPERSEDED, updatedAtMs: num(nowMs) ? nowMs : previous.updatedAtMs },
    next: { ...next, supersedesId: previous.id ?? null },
  };
}

/**
 * The memories that currently apply, strongest first.
 *
 * Superseded and archived entries are dropped rather than ranked low: a retired
 * warning that merely sorts last is still a warning waiting to be shown.
 */
export function effectiveMemories(memories, options = {}) {
  const list = Array.isArray(memories) ? memories : [];
  const minConfidence = num(options.minConfidence) ? options.minConfidence : 0;

  return list
    .filter((m) => m && typeof m === 'object')
    .filter((m) => m.status === STATUS.ACTIVE)
    .filter((m) => !str(options.tenantId) || keyOf(m.tenantId) === keyOf(options.tenantId))
    .filter((m) => (num(m.confidence) ? m.confidence : 0) >= minConfidence)
    .slice()
    .sort((a, b) => {
      const imp = (IMPORTANCE_RANK[b.importance] ?? 1) - (IMPORTANCE_RANK[a.importance] ?? 1);
      if (imp !== 0) return imp;
      const conf = (b.confidence ?? 0) - (a.confidence ?? 0);
      if (conf !== 0) return conf;
      return (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0);
    });
}

/**
 * How loudly may we act on this?
 *
 * A guess should not interrupt anybody. Low-confidence memories are kept —
 * further evidence may raise them — but they stay out of proactive alerts and
 * surface only when the user asks a question that makes them relevant.
 */
export function deliveryPolicy(memory) {
  const confidence = num(memory?.confidence) ? memory.confidence : 0;
  const rank = IMPORTANCE_RANK[memory?.importance] ?? 1;

  if (confidence < 0.5) return { proactive: false, onRecall: true, reason: 'Too uncertain to interrupt, kept for when it is asked about.' };
  if (confidence < 0.7 && rank < IMPORTANCE_RANK.HIGH) {
    return { proactive: false, onRecall: true, reason: 'Plausible but unconfirmed, and not important enough to risk being wrong out loud.' };
  }
  return { proactive: true, onRecall: true, reason: 'Confident enough to raise unprompted.' };
}
