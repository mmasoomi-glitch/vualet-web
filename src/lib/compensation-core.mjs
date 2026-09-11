/**
 * Service credit — the policy engine.
 *
 * When a customer's assistant was unavailable, somebody has to decide whether
 * they are owed something. Today that gets decided in a chat message and
 * forgotten.
 *
 * THIS ENGINE CONSUMES EVIDENCE. It never guesses, and it always names the
 * rule that fired. A system that hard-codes a conclusion about money is both
 * wrong and indefensible; one that maps evidence to an auditable outcome can
 * be argued with, corrected, and changed by policy without touching code.
 *
 * It decides a POLICY OUTCOME and nothing else. Legal conclusions are not
 * software's to make, and a test asserts the explanation never reaches for
 * that vocabulary.
 *
 * PURE: no imports, no I/O, no clock. Facts arrive as parameters.
 */

export const OUTCOMES = Object.freeze({
  NOT_ELIGIBLE: 'NOT_ELIGIBLE',
  AUTO_CREDIT: 'AUTO_CREDIT',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
});

export const REASON_CODES = Object.freeze({
  CUSTOMER_INITIATED_UNPAIR: 'CUSTOMER_INITIATED_UNPAIR',
  VERIFIED_PLATFORM_OUTAGE: 'VERIFIED_PLATFORM_OUTAGE',
  PROVIDER_OUTAGE_ABSORBED: 'PROVIDER_OUTAGE_ABSORBED',
  SECURITY_ACTION_TAKEN: 'SECURITY_ACTION_TAKEN',
  BELOW_THRESHOLD: 'BELOW_THRESHOLD',
  EVIDENCE_AMBIGUOUS: 'EVIDENCE_AMBIGUOUS',
  EVIDENCE_MISSING: 'EVIDENCE_MISSING',
  RECOVERY_WAS_AVAILABLE: 'RECOVERY_WAS_AVAILABLE',
  REPEAT_CREDIT: 'REPEAT_CREDIT',
  DURATION_EXCEPTIONAL: 'DURATION_EXCEPTIONAL',
});

/**
 * minCreditableMs is thirty minutes; exceptionalMs is twenty-four hours.
 *
 * The nested offers are frozen individually because Object.freeze is shallow —
 * without it, POLICY.autoOffer.value could be reassigned at runtime and every
 * later decision would quietly use the new number.
 */
export const POLICY = Object.freeze({
  minCreditableMs: 1800000,
  exceptionalMs: 86400000,
  maxAutoCreditsPerYear: 2,
  autoOffer: Object.freeze({ kind: 'percent_off', value: 10 }),
  fallbackOffer: Object.freeze({ kind: 'free_days', value: 15 }),
});

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** A COPY. Handing out the policy object itself invites a caller to edit it. */
const copyOffer = (offer) => ({ kind: offer.kind, value: offer.value });

export function assessCompensation(input) {
  const i = input && typeof input === 'object' ? input : {};
  const { fault, outageMs, recoveryOfferedMs, recoveryCompleted, priorAutoCreditsThisYear, confident, serviceTier } = i;

  const tier = typeof serviceTier === 'string' && serviceTier.trim().length > 0 ? serviceTier.trim() : null;

  // Never the words legal, liable, liability, owe or obligation. This reports a
  // policy outcome; what follows from it is a business and legal question.
  const explain = () => {
    const minutes = isNum(outageMs) ? Math.floor(outageMs / 60000) : 0;
    const base = `Cause ${String(fault)}, unavailable for ${minutes} minute${minutes === 1 ? '' : 's'}.`;
    return tier ? `${base} Plan: ${tier}.` : base;
  };

  const verdict = (outcome, reasonCode, offer) => ({
    outcome,
    reasonCode,
    offer: offer ? copyOffer(offer) : null,
    why: explain(),
  });

  // A missing measurement is a reason to LOOK, not a reason to decide. It must
  // neither auto-credit nor auto-refuse: both would be inventing the fact.
  if (!isNum(outageMs) || outageMs < 0) {
    return {
      outcome: OUTCOMES.REVIEW_REQUIRED,
      reasonCode: REASON_CODES.EVIDENCE_MISSING,
      offer: null,
      why: 'No usable measurement of how long the service was unavailable.',
    };
  }

  // Removing your own linked device is a normal re-authentication event, not a
  // service failure.
  if (fault === 'CUSTOMER_CAUSED') {
    return verdict(OUTCOMES.NOT_ELIGIBLE, REASON_CODES.CUSTOMER_INITIATED_UNPAIR, null);
  }

  // Ending a session to protect an account is the service working, not failing.
  if (fault === 'SECURITY_ACTION') {
    return verdict(OUTCOMES.NOT_ELIGIBLE, REASON_CODES.SECURITY_ACTION_TAKEN, null);
  }

  // A confident guess here ends up deciding somebody's money on no evidence.
  if (fault === 'UNKNOWN' || confident === false || fault === 'SHARED_OR_AMBIGUOUS') {
    return verdict(OUTCOMES.REVIEW_REQUIRED, REASON_CODES.EVIDENCE_AMBIGUOUS, null);
  }

  // A brief blip that recovery covered is not a billing event, and crediting
  // for every one of them would make the credit mean nothing.
  if (outageMs < POLICY.minCreditableMs) {
    return verdict(OUTCOMES.NOT_ELIGIBLE, REASON_CODES.BELOW_THRESHOLD, null);
  }

  // Too big for an automatic rule to settle.
  if (outageMs >= POLICY.exceptionalMs) {
    return verdict(OUTCOMES.REVIEW_REQUIRED, REASON_CODES.DURATION_EXCEPTIONAL, null);
  }

  // Being credited repeatedly is a signal about the service, not a routine
  // payout, and a human should be the one to see it.
  if (isNum(priorAutoCreditsThisYear) && priorAutoCreditsThisYear >= POLICY.maxAutoCreditsPerYear) {
    return verdict(OUTCOMES.REVIEW_REQUIRED, REASON_CODES.REPEAT_CREDIT, null);
  }

  if (fault === 'PROVIDER_CAUSED') {
    // The upstream provider failing is still OUR customer's outage, so it is
    // absorbed rather than passed on — unless recovery really was immediate,
    // in which case they lost almost nothing.
    const recoveredImmediately =
      recoveryCompleted === true && isNum(recoveryOfferedMs) && recoveryOfferedMs <= POLICY.minCreditableMs;
    if (recoveredImmediately) {
      return verdict(OUTCOMES.NOT_ELIGIBLE, REASON_CODES.RECOVERY_WAS_AVAILABLE, null);
    }
    return verdict(OUTCOMES.AUTO_CREDIT, REASON_CODES.PROVIDER_OUTAGE_ABSORBED, POLICY.autoOffer);
  }

  if (fault === 'PLATFORM_CAUSED') {
    return verdict(OUTCOMES.AUTO_CREDIT, REASON_CODES.VERIFIED_PLATFORM_OUTAGE, POLICY.autoOffer);
  }

  return verdict(OUTCOMES.REVIEW_REQUIRED, REASON_CODES.EVIDENCE_AMBIGUOUS, null);
}

/**
 * Which offer to actually make.
 *
 * The fallback exists because a percentage discount is not always applicable —
 * a customer mid-period on a plan with no upcoming charge cannot be given ten
 * percent off it — whereas free days always can be.
 */
export function offerFor(outcome, difficulty) {
  if (outcome !== OUTCOMES.AUTO_CREDIT) return null;
  return copyOffer(difficulty === 'HARD' ? POLICY.fallbackOffer : POLICY.autoOffer);
}
