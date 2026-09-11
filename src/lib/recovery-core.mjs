/**
 * Automatic reconnection — the pure decision layer.
 *
 * When a customer's WhatsApp binding is broken and they message the assistant,
 * the system answers with a unique, single-use link that expires in ten
 * minutes. Nobody issues it by hand. If it expires, nothing else happens: the
 * next message mints a brand new one. An expired link is never extended and
 * never reactivated, because a link that can be revived is a link an attacker
 * can revive.
 *
 * THE RECORD NEVER CONTAINS THE TOKEN — only its hash. A stolen database dump
 * must not hand anybody a working reconnect link. For the same reason no phone
 * number and no raw channel identifier belongs in here; the account is
 * referenced by its opaque id.
 *
 * PURE: no imports, no I/O, no clock, no randomness. The caller does the crypto
 * and the storage and passes in every timestamp.
 */

export const RECOVERY_TTL_MS = 600000;

export const TOKEN_STATES = Object.freeze({
  VALID: 'VALID',
  EXPIRED: 'EXPIRED',
  USED: 'USED',
  REVOKED: 'REVOKED',
  NOT_FOUND: 'NOT_FOUND',
  MISMATCHED: 'MISMATCHED',
});

export const RECOVERY_PURPOSES = Object.freeze({
  RECONNECT_SAME_NUMBER: 'RECONNECT_SAME_NUMBER',
  NUMBER_MIGRATION: 'NUMBER_MIGRATION',
  DEVICE_REPLACEMENT: 'DEVICE_REPLACEMENT',
});

export const RATE_LIMITS = Object.freeze({
  minIntervalMs: 60000,
  maxPerHour: 5,
  maxPerDay: 10,
});

const HOUR_MS = 3600000;
const DAY_MS = 86400000;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;

export function buildRecovery(input) {
  const i = input && typeof input === 'object' ? input : {};

  if (!isStr(i.recoveryId)) return { ok: false, reason: 'A recovery needs an id.' };
  if (!isStr(i.tokenHash)) return { ok: false, reason: 'A recovery needs a token hash.' };
  if (!isStr(i.accountId)) return { ok: false, reason: 'A recovery needs an account.' };
  if (!isNum(i.nowMs)) return { ok: false, reason: 'A recovery needs a real timestamp.' };
  if (!Object.values(RECOVERY_PURPOSES).includes(i.purpose)) {
    return { ok: false, reason: `Unrecognised recovery purpose "${String(i.purpose)}".` };
  }

  return {
    ok: true,
    record: {
      recoveryId: i.recoveryId,
      // The HASH. Never the token, and never a phone number.
      tokenHash: i.tokenHash,
      accountId: i.accountId,
      oldBindingId: i.oldBindingId ?? null,
      purpose: i.purpose,
      createdAt: i.nowMs,
      expiresAt: i.nowMs + RECOVERY_TTL_MS,
      usedAt: null,
      revokedAt: null,
      requestSource: i.requestSource ?? 'UNKNOWN',
      riskState: i.riskState ?? 'NORMAL',
    },
  };
}

/**
 * What state is this token in?
 *
 * THE ORDER IS THE SECURITY PROPERTY, and the clock-independent checks come
 * first on purpose: a replayed token must report as REPLAYED even when the
 * clock is broken. "Used" and "expired" mean very different things in an
 * incident timeline — one is an attacker or a double click, the other is a
 * customer who walked away — and collapsing them destroys that evidence.
 */
export function evaluateToken(record, nowMs, expectedPurpose) {
  // A forged or guessed token looks exactly like this. The tokenHash check is
  // what makes the test meaningful: an array or a stray object is truthy and
  // typeof 'object', so without it a malformed value would fall through to the
  // clock branch and be reported as EXPIRED — as though it had once been real.
  if (!record || typeof record !== 'object' || Array.isArray(record) || !isStr(record.tokenHash)) {
    return { state: TOKEN_STATES.NOT_FOUND, reason: 'No such recovery token.', record: null };
  }
  if (isNum(record.revokedAt)) {
    return { state: TOKEN_STATES.REVOKED, reason: 'This link was revoked.', record };
  }
  if (isNum(record.usedAt)) {
    return { state: TOKEN_STATES.USED, reason: 'This link was already used.', record };
  }
  // Only now does the clock matter. A broken clock can never yield VALID.
  if (!isNum(nowMs) || !isNum(record.expiresAt) || nowMs >= record.expiresAt) {
    return { state: TOKEN_STATES.EXPIRED, reason: 'This link has expired.', record };
  }
  // A link minted to reconnect the same number must not be usable to move the
  // account onto a different one.
  if (expectedPurpose != null && record.purpose !== expectedPurpose) {
    return { state: TOKEN_STATES.MISMATCHED, reason: 'This link is for a different operation.', record };
  }
  return { state: TOKEN_STATES.VALID, reason: 'Valid.', record };
}

/** Burning the token is what makes a double click safe. */
export function consumeToken(record, nowMs, expectedPurpose) {
  const verdict = evaluateToken(record, nowMs, expectedPurpose);
  if (verdict.state !== TOKEN_STATES.VALID) {
    return { ok: false, state: verdict.state, reason: verdict.reason };
  }
  // A copy: the caller decides whether the write lands, and a mutated input
  // would mark the token used even on a write that failed.
  return { ok: true, record: { ...record, usedAt: nowMs } };
}

export function decideIssuance(input) {
  const i = input && typeof input === 'object' ? input : {};
  const limits = i.limits && typeof i.limits === 'object' ? i.limits : RATE_LIMITS;
  const nowMs = i.nowMs;

  // Never mint a link off a broken clock: the expiry would be meaningless.
  if (!isNum(nowMs)) {
    return { allow: false, reason: 'No usable clock.', retryAfterMs: 0 };
  }

  const history = Array.isArray(i.history) ? i.history : [];
  // A null entry in the history must not crash the decision that protects the
  // customer's phone from being spammed.
  const records = history.filter((r) => r && typeof r === 'object' && isNum(r.createdAt));

  // THE ANTI-SPAM RULE. Without it an attacker pumps a victim's phone with
  // reconnect links until they tap one out of irritation.
  let newest = -Infinity;
  for (const r of records) {
    const age = nowMs - r.createdAt;
    if (age >= 0 && age < limits.minIntervalMs && r.createdAt > newest) newest = r.createdAt;
  }
  if (newest > -Infinity) {
    return {
      allow: false,
      reason: 'A link was issued moments ago.',
      retryAfterMs: limits.minIntervalMs - (nowMs - newest),
    };
  }

  const since = (ms) => records.filter((r) => r.createdAt >= nowMs - ms).length;

  if (since(HOUR_MS) >= limits.maxPerHour) {
    return { allow: false, reason: `Hourly recovery limit of ${limits.maxPerHour} reached.`, retryAfterMs: 0 };
  }
  if (since(DAY_MS) >= limits.maxPerDay) {
    return { allow: false, reason: `Daily recovery limit of ${limits.maxPerDay} reached.`, retryAfterMs: 0 };
  }
  return { allow: true, reason: 'Within limits.', retryAfterMs: 0 };
}

/**
 * The most recent still-valid link, if any.
 *
 * A customer who sends "hi" twice in ten seconds should get the SAME live link
 * rather than a second one that quietly invalidates the first and confuses
 * them about which to tap.
 */
export function activeTokenIn(history, nowMs) {
  if (!isNum(nowMs) || !Array.isArray(history)) return null;
  const sorted = history
    .filter((r) => r && typeof r === 'object' && isNum(r.createdAt))
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt);
  for (const record of sorted) {
    if (evaluateToken(record, nowMs).state === TOKEN_STATES.VALID) return record;
  }
  return null;
}
