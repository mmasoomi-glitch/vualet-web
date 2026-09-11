// Automatic reconnection — the pure decision layer.
//
// The directive's failure matrix items 4-9 live here: link used, link expired,
// link clicked twice, old link used after a new one was issued, attacker
// modifies the URL, attacker requests many links.

import test from "node:test";
import assert from "node:assert/strict";
import {
  RECOVERY_TTL_MS,
  TOKEN_STATES,
  RECOVERY_PURPOSES,
  RATE_LIMITS,
  buildRecovery,
  evaluateToken,
  consumeToken,
  decideIssuance,
  activeTokenIn,
} from "../src/lib/recovery-core.mjs";

const T0 = 1_000_000;

const base = (over = {}) => ({
  recoveryId: "rec_1",
  tokenHash: "hash_abc",
  accountId: "acct_1",
  oldBindingId: "bnd_1",
  purpose: RECOVERY_PURPOSES.RECONNECT_SAME_NUMBER,
  nowMs: T0,
  ...over,
});

/** A built record, for evaluation tests. */
const rec = (over = {}) => {
  const r = buildRecovery(base());
  assert.equal(r.ok, true, "baseline must build");
  return { ...r.record, ...over };
};

/* ── the ten-minute rule ───────────────────────────────────────────────── */

test("THE LINK EXPIRES IN EXACTLY TEN MINUTES", () => {
  assert.equal(RECOVERY_TTL_MS, 600000, "ten minutes, as the directive requires");
  const { record } = buildRecovery(base());
  assert.equal(record.expiresAt - record.createdAt, 600000, "the record encodes that span");
});

test("a new recovery starts unused and unrevoked", () => {
  const { record } = buildRecovery(base());
  assert.equal(record.usedAt, null, "nothing has consumed it");
  assert.equal(record.revokedAt, null, "and nothing has revoked it");
  assert.equal(record.riskState, "NORMAL", "risk defaults to normal");
  assert.equal(record.requestSource, "UNKNOWN", "source defaults rather than lying");
});

test("THE RECORD NEVER CONTAINS THE TOKEN OR A PHONE NUMBER", () => {
  const { record } = buildRecovery(base({ tokenHash: "sha256-of-the-secret" }));
  const serialised = JSON.stringify(record);
  assert.ok(record.tokenHash, "the hash is kept, because lookup needs it");
  assert.ok(!("token" in record), "the token itself must never be stored");
  for (const leak of ["+971", "@s.whatsapp.net", "phone", "msisdn"]) {
    assert.ok(!serialised.includes(leak), `a raw identifier (${leak}) reached the recovery record`);
  }
});

test("a recovery without an id, a hash, an account, a clock or a purpose is refused", () => {
  for (const over of [
    { recoveryId: "" }, { recoveryId: "  " }, { recoveryId: 5 },
    { tokenHash: "" }, { accountId: "" },
    { nowMs: NaN }, { nowMs: "now" }, { nowMs: Infinity },
    { purpose: "SOMETHING_ELSE" }, { purpose: null },
  ]) {
    const r = buildRecovery(base(over));
    assert.equal(r.ok, false, `${JSON.stringify(over)} must be refused`);
    assert.ok(typeof r.reason === "string" && r.reason.length > 0, "with a reason");
  }
});

test("buildRecovery never throws", () => {
  for (const input of [null, undefined, "nope", 7, []]) {
    assert.equal(buildRecovery(input).ok, false, `${String(input)} is refused, not thrown on`);
  }
});

/* ── evaluating a token ────────────────────────────────────────────────── */

test("a fresh token is valid, and one millisecond past expiry is not", () => {
  assert.equal(evaluateToken(rec(), T0 + 1).state, TOKEN_STATES.VALID, "fresh");
  assert.equal(evaluateToken(rec(), T0 + RECOVERY_TTL_MS - 1).state, TOKEN_STATES.VALID, "just inside");
  assert.equal(
    evaluateToken(rec(), T0 + RECOVERY_TTL_MS).state,
    TOKEN_STATES.EXPIRED,
    "the boundary itself expires — a link valid AT its expiry is a link valid past it",
  );
});

test("A FORGED OR GUESSED TOKEN IS NOT_FOUND", () => {
  for (const record of [null, undefined, "", "a-token", 0, []]) {
    assert.equal(
      evaluateToken(record, T0).state,
      TOKEN_STATES.NOT_FOUND,
      `${String(record)} must not resolve to anything`,
    );
  }
});

test("A REPLAY REPORTS AS REPLAYED, NOT AS STALE", () => {
  const used = rec({ usedAt: T0 + 10 });
  assert.equal(evaluateToken(used, T0 + 20).state, TOKEN_STATES.USED, "used while still fresh");
  assert.equal(
    evaluateToken(used, T0 + RECOVERY_TTL_MS * 10).state,
    TOKEN_STATES.USED,
    "still USED long after expiry — collapsing it to EXPIRED would erase the evidence that somebody replayed it",
  );
});

test("A BROKEN CLOCK CAN NEVER YIELD VALID", () => {
  for (const now of [NaN, Infinity, "now", null, undefined]) {
    assert.notEqual(evaluateToken(rec(), now).state, TOKEN_STATES.VALID, `clock ${String(now)}`);
  }
  assert.equal(
    evaluateToken(rec({ usedAt: T0 }), NaN).state,
    TOKEN_STATES.USED,
    "and a replay is still reported as a replay even then",
  );
  assert.equal(
    evaluateToken(rec({ revokedAt: T0 }), NaN).state,
    TOKEN_STATES.REVOKED,
    "as is a revocation",
  );
});

test("revocation beats expiry and use", () => {
  assert.equal(evaluateToken(rec({ revokedAt: T0 }), T0 + 1).state, TOKEN_STATES.REVOKED, "revoked");
  assert.equal(
    evaluateToken(rec({ revokedAt: T0, usedAt: T0 }), T0 + 1).state,
    TOKEN_STATES.REVOKED,
    "a revoked token reports revoked even if also marked used",
  );
});

test("A LINK CANNOT BE USED FOR A DIFFERENT OPERATION", () => {
  const r = evaluateToken(rec(), T0 + 1, RECOVERY_PURPOSES.NUMBER_MIGRATION);
  assert.equal(
    r.state,
    TOKEN_STATES.MISMATCHED,
    "a link minted to reconnect the same number must not be usable to move the account onto a different one",
  );
  assert.equal(
    evaluateToken(rec(), T0 + 1, RECOVERY_PURPOSES.RECONNECT_SAME_NUMBER).state,
    TOKEN_STATES.VALID,
    "the matching purpose still works",
  );
});

/* ── consuming ─────────────────────────────────────────────────────────── */

test("CLICKING THE LINK TWICE IS SAFE", () => {
  const first = consumeToken(rec(), T0 + 5);
  assert.equal(first.ok, true, "the first click works");
  assert.equal(first.record.usedAt, T0 + 5, "and burns the token");

  const second = consumeToken(first.record, T0 + 6);
  assert.equal(second.ok, false, "the second click does not");
  assert.equal(second.state, TOKEN_STATES.USED, "and says exactly why");
});

test("consuming does not mutate the caller's record", () => {
  const original = rec();
  consumeToken(original, T0 + 5);
  assert.equal(
    original.usedAt,
    null,
    "a mutated input would mark the token used even on a write that then failed",
  );
});

test("an expired or revoked token cannot be consumed", () => {
  assert.equal(consumeToken(rec(), T0 + RECOVERY_TTL_MS).state, TOKEN_STATES.EXPIRED, "expired");
  assert.equal(consumeToken(rec({ revokedAt: T0 }), T0 + 1).state, TOKEN_STATES.REVOKED, "revoked");
  assert.equal(consumeToken(null, T0).state, TOKEN_STATES.NOT_FOUND, "forged");
});

/* ── rate limiting ─────────────────────────────────────────────────────── */

test("AN ATTACKER CANNOT PUMP A VICTIM'S PHONE WITH LINKS", () => {
  const justNow = [{ createdAt: T0 - 1000 }];
  const r = decideIssuance({ history: justNow, nowMs: T0 });
  assert.equal(r.allow, false, "a second link one second later is refused");
  assert.equal(r.retryAfterMs, RATE_LIMITS.minIntervalMs - 1000, "and the caller is told how long to wait");
});

test("the hourly and daily ceilings bind", () => {
  const spaced = (n, gapMs) =>
    Array.from({ length: n }, (_, k) => ({ createdAt: T0 - RATE_LIMITS.minIntervalMs - k * gapMs }));

  const hourly = decideIssuance({ history: spaced(RATE_LIMITS.maxPerHour, 5 * 60000), nowMs: T0 });
  assert.equal(hourly.allow, false, "the hourly ceiling refuses");
  assert.ok(/hour/i.test(hourly.reason), "and says which ceiling");

  const daily = decideIssuance({ history: spaced(RATE_LIMITS.maxPerDay, 90 * 60000), nowMs: T0 });
  assert.equal(daily.allow, false, "the daily ceiling refuses");
  assert.ok(/dail/i.test(daily.reason), "and says which ceiling");
});

test("a normal customer is never blocked from recovering", () => {
  // One link an hour ago is the ordinary case: it must not stop them.
  const r = decideIssuance({ history: [{ createdAt: T0 - 2 * 3600000 }], nowMs: T0 });
  assert.equal(r.allow, true, "recovery must not require contacting support");

  assert.equal(decideIssuance({ history: [], nowMs: T0 }).allow, true, "a first-ever recovery is allowed");
});

test("ISSUANCE IS REFUSED ON A BROKEN CLOCK", () => {
  for (const nowMs of [NaN, undefined, "now", Infinity]) {
    assert.equal(
      decideIssuance({ history: [], nowMs }).allow,
      false,
      `clock ${String(nowMs)} must not mint a link whose expiry would be meaningless`,
    );
  }
});

test("a corrupt history does not crash the rate limiter", () => {
  for (const history of [null, "nope", 5, [null, undefined, {}, { createdAt: "x" }, 7]]) {
    const r = decideIssuance({ history, nowMs: T0 });
    assert.ok(typeof r.allow === "boolean", `${JSON.stringify(history)} still yields a decision`);
  }
  assert.equal(decideIssuance(null).allow, false, "a null input refuses rather than throwing");
});

/* ── reusing a live link ───────────────────────────────────────────────── */

test("A CUSTOMER WHO SAYS HI TWICE GETS THE SAME LIVE LINK", () => {
  const live = rec();
  const found = activeTokenIn([live], T0 + 1000);
  assert.equal(
    found && found.recoveryId,
    "rec_1",
    "issuing a second link would silently invalidate the first and leave them unsure which to tap",
  );
});

test("activeTokenIn ignores dead links and prefers the newest", () => {
  const old = { ...rec(), recoveryId: "rec_old", createdAt: T0 - 1000, expiresAt: T0 + RECOVERY_TTL_MS };
  const newer = { ...rec(), recoveryId: "rec_new", createdAt: T0, expiresAt: T0 + RECOVERY_TTL_MS };
  assert.equal(activeTokenIn([old, newer], T0 + 1).recoveryId, "rec_new", "the newest live link wins");

  const dead = [rec({ usedAt: T0 }), rec({ revokedAt: T0 })];
  assert.equal(activeTokenIn(dead, T0 + 1), null, "used and revoked links are not offered again");
  assert.equal(activeTokenIn([rec()], T0 + RECOVERY_TTL_MS), null, "nor are expired ones");
});

test("AN EXPIRED LINK IS NEVER REVIVED — a new one must be minted", () => {
  const expired = rec();
  const now = T0 + RECOVERY_TTL_MS + 1;
  assert.equal(activeTokenIn([expired], now), null, "there is no live link to reuse");
  assert.equal(evaluateToken(expired, now).state, TOKEN_STATES.EXPIRED, "and it stays expired forever");
  assert.equal(
    decideIssuance({ history: [expired], nowMs: now }).allow,
    true,
    "so the next message is free to mint a brand new one, which is the whole recovery loop",
  );
});

test("activeTokenIn never throws", () => {
  for (const h of [null, undefined, "nope", 5, [null, 7, {}]]) {
    assert.equal(activeTokenIn(h, T0), null, `${String(h)} yields no token`);
  }
  assert.equal(activeTokenIn([rec()], NaN), null, "a broken clock yields no token");
});
