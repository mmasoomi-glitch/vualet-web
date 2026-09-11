// Changing a customer's WhatsApp number — the pure state machine.
//
// The directive's failure matrix items 19-27 live here: migration during an
// active run, duplicate events, service restarts mid-migration, and commits
// that half-succeed.

import test from "node:test";
import assert from "node:assert/strict";
import {
  MIGRATION_STATES,
  RISK_LEVELS,
  MIGRATION_STEPS,
  buildMigration,
  canTransition,
  nextStates,
  advance,
  isCommitted,
  assessRisk,
  entitlementUnchangedBy,
} from "../src/lib/number-migration-core.mjs";

const T0 = 1_000_000;
const ALL_STATES = Object.values(MIGRATION_STATES);

const base = (over = {}) => ({
  migrationId: "mig_1",
  accountId: "acct_1",
  oldBindingId: "bnd_old",
  newIdentifierHash: "hash_new",
  nowMs: T0,
  ...over,
});

/** A verified migration, ready for cutover. */
function verified() {
  const { record } = buildMigration(base());
  return { ...record, state: MIGRATION_STATES.VERIFIED, verifiedAt: T0 + 100 };
}

/** Run the cutover through to the given step index. */
function runTo(index) {
  let record = verified();
  for (let i = 0; i <= index; i++) {
    const r = advance(record, MIGRATION_STEPS[i], T0 + 200 + i);
    assert.equal(r.ok, true, `step ${MIGRATION_STEPS[i]} should apply`);
    record = r.record;
  }
  return record;
}

/* ── the cutover order ─────────────────────────────────────────────────── */

test("REVOKING THE OLD NUMBER COMES BEFORE ACTIVATING THE NEW ONE", () => {
  const revoke = MIGRATION_STEPS.indexOf("REVOKE_OLD_BINDING");
  const activate = MIGRATION_STEPS.indexOf("ACTIVATE_NEW_BINDING");
  assert.ok(revoke >= 0 && activate >= 0, "both steps exist");
  assert.ok(
    revoke < activate,
    "a crash between them must leave the customer briefly disconnected, which is recoverable — the other order leaves two live numbers on one account, which is an account-takeover window",
  );
});

test("authority is committed last", () => {
  assert.equal(
    MIGRATION_STEPS[MIGRATION_STEPS.length - 1],
    "COMMIT_AUTHORITY",
    "the field the engine reads is the real cutover; everything before it is preparation",
  );
});

/* ── building ──────────────────────────────────────────────────────────── */

test("a migration starts requested and claims nothing", () => {
  const { record } = buildMigration(base());
  assert.equal(record.state, MIGRATION_STATES.REQUESTED, "nothing has happened yet");
  assert.deepEqual(record.stepsDone, [], "no step has run");
  assert.equal(record.completedAt, null, "and it is not complete");
  assert.equal(record.newBindingId, null, "the new binding does not exist yet");
  assert.equal(record.riskLevel, RISK_LEVELS.NORMAL, "risk defaults to normal");
});

test("A RAW PHONE NUMBER NEVER ENTERS THE MIGRATION RECORD", () => {
  const { record } = buildMigration(base({ newIdentifierHash: "sha256-of-the-new-number" }));
  const serialised = JSON.stringify(record);
  for (const leak of ["+971", "+44", "@s.whatsapp.net", "msisdn"]) {
    assert.ok(!serialised.includes(leak), `a raw identifier (${leak}) reached the migration record`);
  }
  assert.ok(record.newIdentifierHash, "only the hash is kept, which is all an equality check needs");
});

test("an incomplete migration request is refused", () => {
  for (const over of [
    { migrationId: "" }, { migrationId: "   " }, { migrationId: 5 },
    { accountId: "" }, { newIdentifierHash: "" },
    { nowMs: NaN }, { nowMs: "now" },
    { riskLevel: "SEVERE" },
  ]) {
    const r = buildMigration(base(over));
    assert.equal(r.ok, false, `${JSON.stringify(over)} must be refused`);
    assert.ok(typeof r.reason === "string" && r.reason.length > 0, "with a reason");
  }
});

test("buildMigration never throws", () => {
  for (const input of [null, undefined, "nope", 7, []]) {
    assert.equal(buildMigration(input).ok, false, `${String(input)} is refused, not thrown on`);
  }
});

/* ── transitions ───────────────────────────────────────────────────────── */

test("COMPLETED, FAILED AND CANCELLED ARE TERMINAL", () => {
  for (const terminal of [MIGRATION_STATES.COMPLETED, MIGRATION_STATES.FAILED, MIGRATION_STATES.CANCELLED]) {
    for (const to of ALL_STATES) {
      assert.equal(canTransition(terminal, to), false, `${terminal} -> ${to} must be impossible`);
    }
    assert.deepEqual(nextStates(terminal), [], `${terminal} has nowhere to go`);
  }
});

test("A COMMITTING MIGRATION CANNOT PRETEND IT NEVER STARTED", () => {
  assert.equal(
    canTransition(MIGRATION_STATES.COMMITTING, MIGRATION_STATES.VERIFIED),
    false,
    "the old binding may already be revoked, so claiming a pre-commit state would be a lie",
  );
  assert.equal(canTransition(MIGRATION_STATES.COMMITTING, MIGRATION_STATES.COMPLETED), true, "it can finish");
  assert.equal(canTransition(MIGRATION_STATES.COMMITTING, MIGRATION_STATES.FAILED), true, "or fail");
  assert.equal(
    canTransition(MIGRATION_STATES.COMMITTING, MIGRATION_STATES.REVIEW_REQUIRED),
    true,
    "or go to a human",
  );
});

test("a no-op is not a transition, and unknown states go nowhere", () => {
  for (const state of ALL_STATES) {
    assert.equal(canTransition(state, state), false, `${state} -> ${state}`);
  }
  assert.equal(canTransition("GARBAGE", MIGRATION_STATES.VERIFIED), false, "unknown source");
  assert.deepEqual(nextStates("GARBAGE"), [], "unknown states have no next states");
  assert.deepEqual(nextStates(undefined), [], "nor does undefined");
});

/* ── the cutover ───────────────────────────────────────────────────────── */

test("the cutover runs in order and completes", () => {
  const done = runTo(MIGRATION_STEPS.length - 1);
  assert.equal(done.state, MIGRATION_STATES.COMPLETED, "it finishes");
  assert.deepEqual(done.stepsDone, [...MIGRATION_STEPS], "every step ran, in order");
  assert.ok(isCommitted(done), "and it is genuinely committed");
});

test("A RETRIED STEP IS A NO-OP, NOT A SECOND REVOCATION", () => {
  const afterRevoke = runTo(2);
  const again = advance(afterRevoke, "REVOKE_OLD_BINDING", T0 + 999);
  assert.equal(again.ok, true, "a duplicate delivery succeeds");
  assert.deepEqual(
    again.record.stepsDone,
    afterRevoke.stepsDone,
    "and changes nothing — a duplicate event must not revoke twice",
  );
  assert.equal(again.record, afterRevoke, "the same record is returned untouched");
});

test("STEPS CANNOT BE SKIPPED", () => {
  const ready = verified();
  // Jumping straight to activation would leave the old number live.
  const skip = advance(ready, "ACTIVATE_NEW_BINDING", T0 + 1);
  assert.equal(skip.ok, false, "skipping ahead is refused");
  assert.ok(/REVOKE_OLD_BINDING|VERIFY_NEW|PREPARE/.test(skip.reason), "and names what has not run");

  const commitEarly = advance(ready, "COMMIT_AUTHORITY", T0 + 1);
  assert.equal(commitEarly.ok, false, "committing authority before revoking is refused");
});

test("the cutover cannot start before verification", () => {
  const { record } = buildMigration(base());
  for (const state of [
    MIGRATION_STATES.REQUESTED,
    MIGRATION_STATES.VERIFICATION_REQUIRED,
    MIGRATION_STATES.CANCELLED,
    MIGRATION_STATES.FAILED,
    MIGRATION_STATES.REVIEW_REQUIRED,
  ]) {
    const r = advance({ ...record, state }, "VERIFY_NEW", T0 + 1);
    assert.equal(r.ok, false, `${state} must not be able to run the cutover`);
  }
});

test("advance never throws on a corrupt record", () => {
  for (const record of [null, undefined, "nope", 5, []]) {
    assert.equal(advance(record, "VERIFY_NEW", T0).ok, false, `${String(record)} refused`);
  }
  // A record with no stepsDone array at all must not crash the cutover.
  const noSteps = { state: MIGRATION_STATES.VERIFIED };
  const r = advance(noSteps, "VERIFY_NEW", T0);
  assert.equal(r.ok, true, "a missing stepsDone is treated as no steps run");
  assert.deepEqual(r.record.stepsDone, ["VERIFY_NEW"], "and the first step applies");
  assert.equal(advance(verified(), "MADE_UP_STEP", T0).ok, false, "an unknown step is refused");
  assert.equal(advance(verified(), "VERIFY_NEW", NaN).ok, false, "a broken clock is refused");
});

/* ── half-committed records ────────────────────────────────────────────── */

test("A RECORD CLAIMING COMPLETED WITHOUT EVERY STEP IS NOT TRUSTED", () => {
  const liar = { state: MIGRATION_STATES.COMPLETED, stepsDone: ["VERIFY_NEW"] };
  assert.equal(
    isCommitted(liar),
    false,
    "that combination means something wrote the state directly instead of running the cutover, and the old number may still be live",
  );
  assert.equal(isCommitted({ state: MIGRATION_STATES.COMPLETED }), false, "no steps at all is not committed");
  assert.equal(isCommitted({ state: MIGRATION_STATES.COMPLETED, stepsDone: "all" }), false, "nor is a corrupt field");
});

test("a partially run cutover is not committed", () => {
  for (let i = 0; i < MIGRATION_STEPS.length - 1; i++) {
    assert.equal(isCommitted(runTo(i)), false, `stopping after ${MIGRATION_STEPS[i]} is not a commit`);
  }
});

test("isCommitted never throws", () => {
  for (const record of [null, undefined, "nope", 5, [], {}]) {
    assert.equal(isCommitted(record), false, `${String(record)} is not committed`);
  }
});

/* ── SIM-swap risk ─────────────────────────────────────────────────────── */

test("A KNOWN COMPROMISED SESSION IS ALWAYS HIGH RISK", () => {
  const r = assessRisk({ knownCompromisedSession: true });
  assert.equal(r.level, RISK_LEVELS.HIGH, "nothing else matters once the session is known compromised");
  assert.equal(r.requiresStrongAuth, true, "and it demands a stronger factor");
});

test("risk escalates with the number of signals", () => {
  assert.equal(assessRisk({}).level, RISK_LEVELS.NORMAL, "no signals is normal");
  assert.equal(assessRisk({ newDevice: true }).level, RISK_LEVELS.ELEVATED, "one signal is elevated");
  assert.equal(
    assessRisk({ newDevice: true, recentMfaReset: true }).level,
    RISK_LEVELS.HIGH,
    "a new device plus a recent MFA reset is the shape of a SIM-swap takeover",
  );
  assert.deepEqual(
    assessRisk({ newDevice: true, recentMfaReset: true }).reasons,
    ["newDevice", "recentMfaReset"],
    "and the reasons are named for the reviewer",
  );
});

test("AUTOMATION DOES NOT MEAN WEAK SECURITY", () => {
  assert.equal(assessRisk({}).requiresStrongAuth, false, "the ordinary case stays self-service");
  for (const signal of ["newDevice", "recentPasswordReset", "recentMfaReset", "repeatedRecoveryAttempts", "bothNumbersChangedRapidly"]) {
    assert.equal(
      assessRisk({ [signal]: true }).requiresStrongAuth,
      true,
      `${signal} must demand a stronger factor before the number moves`,
    );
  }
});

test("assessRisk never throws and ignores non-true values", () => {
  for (const signals of [null, undefined, "nope", 5, []]) {
    assert.equal(assessRisk(signals).level, RISK_LEVELS.NORMAL, `${String(signals)} is normal`);
  }
  assert.equal(
    assessRisk({ newDevice: "yes", recentMfaReset: 1 }).level,
    RISK_LEVELS.NORMAL,
    "only a real boolean true counts, so a truthy string cannot silently raise risk",
  );
});

/* ── the entitlement invariant ─────────────────────────────────────────── */

test("A MIGRATION NEVER RESTARTS OR ENDS THE SUBSCRIPTION", () => {
  for (const record of [verified(), runTo(4), null, undefined, {}, "nope"]) {
    assert.equal(
      entitlementUnchangedBy(record),
      true,
      "the subscription belongs to the account, never to the number — a customer who migrates on day 12 of 30 keeps exactly the 18 days they had, not 30 new ones and not zero",
    );
  }
});
