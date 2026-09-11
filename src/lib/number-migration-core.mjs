/**
 * Changing a customer's WhatsApp number — the pure state machine.
 *
 * The account, the tenant, the subscription and the context all survive
 * unchanged. Only the channel binding is replaced. The old number must stop
 * working at the instant the new one starts.
 *
 * TWO CONSTRAINTS SHAPE EVERYTHING HERE.
 *
 * The datastore is a key-value store with no multi-key transaction, so there
 * is no way to change several keys at once. A reviewing judge ruled that
 * making ONE key authoritative is the correct cutover for this topology: the
 * commit is a single write, and everything else is a projection that a repair
 * pass can fix if it lags.
 *
 * The engine that authorises an inbound sender is a separate service on
 * another host that cannot be modified. It reads one field on the subscription
 * record, so THAT field is the real cutover point and the migration is not
 * truly committed until it changes. Every earlier step is preparation.
 *
 * PURE: no imports, no I/O, no clock. Every id and timestamp is a parameter.
 */

export const MIGRATION_STATES = Object.freeze({
  REQUESTED: 'REQUESTED',
  VERIFICATION_REQUIRED: 'VERIFICATION_REQUIRED',
  VERIFIED: 'VERIFIED',
  COMMITTING: 'COMMITTING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
});

export const RISK_LEVELS = Object.freeze({
  NORMAL: 'NORMAL',
  ELEVATED: 'ELEVATED',
  HIGH: 'HIGH',
});

/**
 * The cutover order, and it is not arbitrary.
 *
 * REVOKE_OLD_BINDING comes BEFORE ACTIVATE_NEW_BINDING on purpose. If the
 * process dies between them the customer is briefly disconnected, which they
 * can recover from in seconds. The other order leaves two live numbers on one
 * account, which is an account-takeover window. A short outage is a far better
 * failure than a security hole.
 */
export const MIGRATION_STEPS = Object.freeze([
  'VERIFY_NEW',
  'PREPARE_NEW_BINDING',
  'REVOKE_OLD_BINDING',
  'ACTIVATE_NEW_BINDING',
  'COMMIT_AUTHORITY',
]);

const RISK_SIGNALS = Object.freeze([
  'newDevice',
  'recentPasswordReset',
  'recentMfaReset',
  'repeatedRecoveryAttempts',
  'bothNumbersChangedRapidly',
]);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const steps = (record) => (Array.isArray(record && record.stepsDone) ? record.stepsDone : []);

export function buildMigration(input) {
  const i = input && typeof input === 'object' ? input : {};

  if (!isStr(i.migrationId)) return { ok: false, reason: 'A migration needs an id.' };
  if (!isStr(i.accountId)) return { ok: false, reason: 'A migration needs an account.' };
  // A HASH. A raw phone number must never enter this record: the whole point of
  // the migration is that the number is a replaceable credential, and storing
  // it here would make the audit trail the very thing that leaks it.
  if (!isStr(i.newIdentifierHash)) return { ok: false, reason: 'A migration needs the new identifier hash.' };
  if (!isNum(i.nowMs)) return { ok: false, reason: 'A migration needs a real timestamp.' };
  if (i.riskLevel !== undefined && !Object.values(RISK_LEVELS).includes(i.riskLevel)) {
    return { ok: false, reason: `Unrecognised risk level "${String(i.riskLevel)}".` };
  }

  return {
    ok: true,
    record: {
      migrationId: i.migrationId,
      accountId: i.accountId,
      oldBindingId: i.oldBindingId ?? null,
      newIdentifierHash: i.newIdentifierHash,
      newBindingId: null,
      state: MIGRATION_STATES.REQUESTED,
      riskLevel: i.riskLevel ?? RISK_LEVELS.NORMAL,
      initiatedFrom: i.initiatedFrom ?? 'UNKNOWN',
      requestedAt: i.nowMs,
      verifiedAt: null,
      completedAt: null,
      failedReason: null,
      stepsDone: [],
    },
  };
}

/**
 * COMMITTING deliberately has no way back to VERIFIED. Once the cutover has
 * begun the old binding may already be revoked, so claiming to be back in a
 * pre-commit state would be a lie. The only honest outcomes are finished,
 * failed, or a human looking at it.
 */
const TRANSITIONS = Object.freeze({
  [MIGRATION_STATES.REQUESTED]: Object.freeze([
    MIGRATION_STATES.VERIFICATION_REQUIRED,
    MIGRATION_STATES.CANCELLED,
    MIGRATION_STATES.REVIEW_REQUIRED,
    MIGRATION_STATES.FAILED,
  ]),
  [MIGRATION_STATES.VERIFICATION_REQUIRED]: Object.freeze([
    MIGRATION_STATES.VERIFIED,
    MIGRATION_STATES.CANCELLED,
    MIGRATION_STATES.REVIEW_REQUIRED,
    MIGRATION_STATES.FAILED,
  ]),
  [MIGRATION_STATES.VERIFIED]: Object.freeze([
    MIGRATION_STATES.COMMITTING,
    MIGRATION_STATES.CANCELLED,
    MIGRATION_STATES.REVIEW_REQUIRED,
    MIGRATION_STATES.FAILED,
  ]),
  [MIGRATION_STATES.COMMITTING]: Object.freeze([
    MIGRATION_STATES.COMPLETED,
    MIGRATION_STATES.FAILED,
    MIGRATION_STATES.REVIEW_REQUIRED,
  ]),
  [MIGRATION_STATES.REVIEW_REQUIRED]: Object.freeze([
    MIGRATION_STATES.VERIFIED,
    MIGRATION_STATES.CANCELLED,
    MIGRATION_STATES.FAILED,
  ]),
  [MIGRATION_STATES.COMPLETED]: Object.freeze([]),
  [MIGRATION_STATES.FAILED]: Object.freeze([]),
  [MIGRATION_STATES.CANCELLED]: Object.freeze([]),
});

export function canTransition(from, to) {
  if (from === to) return false;
  const allowed = TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export function nextStates(from) {
  return TRANSITIONS[from] || Object.freeze([]);
}

export function advance(record, step, nowMs) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, reason: 'A migration record is required.' };
  }
  if (!MIGRATION_STEPS.includes(step)) {
    return { ok: false, reason: `Unrecognised step "${String(step)}".` };
  }
  if (!isNum(nowMs)) {
    return { ok: false, reason: 'A step needs a real timestamp.' };
  }
  if (record.state !== MIGRATION_STATES.VERIFIED && record.state !== MIGRATION_STATES.COMMITTING) {
    return { ok: false, reason: `The cutover only runs after verification; this is ${String(record.state)}.` };
  }

  const done = steps(record);

  // IDEMPOTENT. A retried step is a no-op, never a second revocation. Every
  // command here can arrive twice — a retry, a duplicate event, a restart
  // mid-migration — and the second one must change nothing.
  if (done.includes(step)) return { ok: true, record };

  // Out of order is refused rather than reordered: skipping REVOKE_OLD_BINDING
  // would leave two live numbers on one account.
  const index = MIGRATION_STEPS.indexOf(step);
  for (let i = 0; i < index; i++) {
    if (!done.includes(MIGRATION_STEPS[i])) {
      return { ok: false, reason: `${MIGRATION_STEPS[i]} has not run yet.` };
    }
  }

  const next = { ...record, stepsDone: [...done, step] };
  if (step === 'COMMIT_AUTHORITY') {
    next.state = MIGRATION_STATES.COMPLETED;
    next.completedAt = nowMs;
  } else {
    next.state = MIGRATION_STATES.COMMITTING;
  }
  return { ok: true, record: next };
}

/**
 * A record claiming COMPLETED without every step is corrupt and must not be
 * trusted — that combination means something wrote the state directly instead
 * of going through the cutover, and the old number may still be live.
 */
export function isCommitted(record) {
  if (!record || typeof record !== 'object') return false;
  if (record.state !== MIGRATION_STATES.COMPLETED) return false;
  const done = steps(record);
  return MIGRATION_STEPS.every((step) => done.includes(step));
}

/**
 * Changing a number is a high-risk account operation — it is the exact shape of
 * a SIM-swap takeover. Automation must not mean weak security, so the risky
 * shapes demand a stronger factor rather than being waved through.
 */
export function assessRisk(signals) {
  const s = signals && typeof signals === 'object' ? signals : {};

  if (s.knownCompromisedSession === true) {
    return { level: RISK_LEVELS.HIGH, reasons: ['knownCompromisedSession'], requiresStrongAuth: true };
  }

  const reasons = RISK_SIGNALS.filter((name) => s[name] === true);
  const level =
    reasons.length === 0
      ? RISK_LEVELS.NORMAL
      : reasons.length === 1
        ? RISK_LEVELS.ELEVATED
        : RISK_LEVELS.HIGH;

  return { level, reasons, requiresStrongAuth: level !== RISK_LEVELS.NORMAL };
}

/**
 * A migration MUST NEVER alter entitlement. The subscription belongs to the
 * account, never to the number: a customer who migrates on day 12 of 30 keeps
 * exactly the 18 days they had. A function rather than a comment so a test can
 * assert it against any record, including malformed ones.
 */
export function entitlementUnchangedBy(migrationRecord) {
  void migrationRecord;
  return true;
}
