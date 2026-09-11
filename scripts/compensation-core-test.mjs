// The service-credit policy engine.
//
// The directive's rule is that compensation consumes evidence rather than
// guesses, and that software does not conclude liability. Both are asserted
// here, along with the integration with the goodwill ledger that actually
// records what was offered.

import test from "node:test";
import assert from "node:assert/strict";
import {
  OUTCOMES,
  REASON_CODES,
  POLICY,
  assessCompensation,
  offerFor,
} from "../src/lib/compensation-core.mjs";
import { validateOffer, createEntry } from "../src/lib/goodwill.ts";

const MIN = POLICY.minCreditableMs;
const ok = (over = {}) => ({
  fault: "PLATFORM_CAUSED",
  outageMs: MIN + 60000,
  confident: true,
  priorAutoCreditsThisYear: 0,
  ...over,
});

/* ── evidence, not guesses ─────────────────────────────────────────────── */

test("A MISSING MEASUREMENT IS A REASON TO LOOK, NOT A REASON TO DECIDE", () => {
  for (const outageMs of [undefined, null, NaN, Infinity, "20 minutes", -1]) {
    const r = assessCompensation(ok({ outageMs }));
    assert.equal(
      r.outcome,
      OUTCOMES.REVIEW_REQUIRED,
      `outage ${String(outageMs)} must go to a human`,
    );
    assert.equal(r.reasonCode, REASON_CODES.EVIDENCE_MISSING, "and say the evidence is missing");
    assert.equal(
      r.offer,
      null,
      "it must neither auto-credit nor auto-refuse on an absent fact — both would be inventing it",
    );
  }
});

test("AMBIGUOUS EVIDENCE GOES TO A HUMAN", () => {
  for (const over of [
    { fault: "UNKNOWN" },
    { fault: "SHARED_OR_AMBIGUOUS" },
    { fault: "PLATFORM_CAUSED", confident: false },
    { fault: "SOMETHING_NEW" },
  ]) {
    const r = assessCompensation(ok(over));
    assert.equal(
      r.outcome,
      OUTCOMES.REVIEW_REQUIRED,
      `${JSON.stringify(over)} must not be settled automatically — a confident guess here decides somebody's money on no evidence`,
    );
    assert.equal(r.offer, null, "and offers nothing on its own");
  }
});

/* ── the clear cases ───────────────────────────────────────────────────── */

test("A CUSTOMER UNPAIRING THEIR OWN DEVICE IS NOT A SERVICE FAILURE", () => {
  const r = assessCompensation(ok({ fault: "CUSTOMER_CAUSED", outageMs: 3 * 3600000 }));
  assert.equal(r.outcome, OUTCOMES.NOT_ELIGIBLE, "removing your own device is a re-authentication event");
  assert.equal(r.reasonCode, REASON_CODES.CUSTOMER_INITIATED_UNPAIR, "and is named as such");
  assert.ok(
    r.why.includes("180 minute"),
    "the duration is still recorded, because the fact is true regardless of who caused it",
  );
});

test("A SECURITY REVOCATION IS THE SERVICE WORKING", () => {
  const r = assessCompensation(ok({ fault: "SECURITY_ACTION" }));
  assert.equal(r.outcome, OUTCOMES.NOT_ELIGIBLE, "ending a session to protect an account is not a failure");
  assert.equal(r.reasonCode, REASON_CODES.SECURITY_ACTION_TAKEN, "and says so");
});

test("OUR OWN OUTAGE CREDITS AUTOMATICALLY", () => {
  const r = assessCompensation(ok({ fault: "PLATFORM_CAUSED" }));
  assert.equal(r.outcome, OUTCOMES.AUTO_CREDIT, "a verified platform outage is ours");
  assert.equal(r.reasonCode, REASON_CODES.VERIFIED_PLATFORM_OUTAGE, "named plainly");
  assert.deepEqual(r.offer, { kind: "percent_off", value: 10 }, "with the approved offer");
});

test("A PROVIDER OUTAGE IS ABSORBED, NOT PASSED ON", () => {
  const r = assessCompensation(ok({ fault: "PROVIDER_CAUSED" }));
  assert.equal(
    r.outcome,
    OUTCOMES.AUTO_CREDIT,
    "the upstream provider failing is still our customer's outage; they did not choose the provider",
  );
  assert.equal(r.reasonCode, REASON_CODES.PROVIDER_OUTAGE_ABSORBED, "and is recorded as absorbed");
});

test("but a provider blip that recovery covered immediately is not credited", () => {
  const r = assessCompensation(
    ok({ fault: "PROVIDER_CAUSED", recoveryCompleted: true, recoveryOfferedMs: 60000 }),
  );
  assert.equal(r.outcome, OUTCOMES.NOT_ELIGIBLE, "they lost almost nothing");
  assert.equal(r.reasonCode, REASON_CODES.RECOVERY_WAS_AVAILABLE, "because recovery was there");

  const slow = assessCompensation(
    ok({ fault: "PROVIDER_CAUSED", recoveryCompleted: true, recoveryOfferedMs: MIN + 1 }),
  );
  assert.equal(slow.outcome, OUTCOMES.AUTO_CREDIT, "recovery that took too long does not excuse it");
});

/* ── thresholds ────────────────────────────────────────────────────────── */

test("A BRIEF BLIP IS NOT A BILLING EVENT", () => {
  const r = assessCompensation(ok({ outageMs: MIN - 1 }));
  assert.equal(r.outcome, OUTCOMES.NOT_ELIGIBLE, "under the threshold");
  assert.equal(
    r.reasonCode,
    REASON_CODES.BELOW_THRESHOLD,
    "crediting for every momentary blip would make the credit mean nothing",
  );
  assert.equal(assessCompensation(ok({ outageMs: MIN })).outcome, OUTCOMES.AUTO_CREDIT, "the boundary credits");
});

test("AN EXCEPTIONAL OUTAGE IS TOO BIG FOR A RULE", () => {
  const r = assessCompensation(ok({ outageMs: POLICY.exceptionalMs }));
  assert.equal(r.outcome, OUTCOMES.REVIEW_REQUIRED, "a day-long outage is not settled by an automatic rule");
  assert.equal(r.reasonCode, REASON_CODES.DURATION_EXCEPTIONAL, "and is flagged as exceptional");
});

test("REPEATED CREDITS ARE A SIGNAL, NOT A ROUTINE PAYOUT", () => {
  const r = assessCompensation(ok({ priorAutoCreditsThisYear: POLICY.maxAutoCreditsPerYear }));
  assert.equal(
    r.outcome,
    OUTCOMES.REVIEW_REQUIRED,
    "a customer being credited again and again says something about the service that a human should see",
  );
  assert.equal(r.reasonCode, REASON_CODES.REPEAT_CREDIT, "and is named");
  assert.equal(
    assessCompensation(ok({ priorAutoCreditsThisYear: POLICY.maxAutoCreditsPerYear - 1 })).outcome,
    OUTCOMES.AUTO_CREDIT,
    "one below the ceiling still credits",
  );
});

/* ── the vocabulary rule ───────────────────────────────────────────────── */

test("THE ENGINE NEVER REACHES FOR LEGAL VOCABULARY", () => {
  const forbidden = ["legal", "liable", "liability", "owe", "obligation", "compensation due", "entitled to"];
  const cases = [
    ok({ fault: "CUSTOMER_CAUSED" }),
    ok({ fault: "PLATFORM_CAUSED" }),
    ok({ fault: "PROVIDER_CAUSED" }),
    ok({ fault: "SECURITY_ACTION" }),
    ok({ fault: "UNKNOWN" }),
    ok({ outageMs: NaN }),
    null,
  ];
  for (const c of cases) {
    const why = assessCompensation(c).why.toLowerCase();
    for (const word of forbidden) {
      assert.ok(
        !why.includes(word),
        `"${word}" appeared in a policy explanation — this engine decides a policy outcome, and what follows from it is a business and legal question, not software's`,
      );
    }
  }
});

/* ── the policy cannot be edited at runtime ────────────────────────────── */

test("THE POLICY AND ITS OFFERS ARE DEEPLY FROZEN", () => {
  assert.ok(Object.isFrozen(POLICY), "the policy is frozen");
  assert.ok(
    Object.isFrozen(POLICY.autoOffer),
    "and so is the nested offer — Object.freeze is shallow, so without this a stray write could change what every later decision pays out",
  );
  assert.ok(Object.isFrozen(POLICY.fallbackOffer), "including the fallback");
});

test("A RETURNED OFFER IS A COPY", () => {
  const first = assessCompensation(ok({ fault: "PLATFORM_CAUSED" }));
  first.offer.value = 99;
  const second = assessCompensation(ok({ fault: "PLATFORM_CAUSED" }));
  assert.equal(
    second.offer.value,
    10,
    "handing out the policy object itself would let one caller's mutation change everybody else's payout",
  );
});

/* ── it never throws ───────────────────────────────────────────────────── */

test("assessCompensation never throws", () => {
  for (const input of [null, undefined, "nope", 5, [], {}]) {
    const r = assessCompensation(input);
    assert.ok(Object.values(OUTCOMES).includes(r.outcome), `${String(input)} still yields an outcome`);
    assert.ok(typeof r.why === "string" && r.why.length > 0, "and an explanation");
  }
});

/* ── offerFor ──────────────────────────────────────────────────────────── */

test("only an auto-credit produces an offer", () => {
  assert.equal(offerFor(OUTCOMES.NOT_ELIGIBLE, "EASY"), null, "a refusal offers nothing");
  assert.equal(offerFor(OUTCOMES.REVIEW_REQUIRED, "EASY"), null, "nor does a review");
  assert.deepEqual(offerFor(OUTCOMES.AUTO_CREDIT, "EASY"), { kind: "percent_off", value: 10 }, "the normal offer");
  assert.deepEqual(
    offerFor(OUTCOMES.AUTO_CREDIT, "HARD"),
    { kind: "free_days", value: 15 },
    "and the fallback, because a percentage discount is not always applicable but free days always are",
  );
});

/* ── it feeds the ledger that actually records the promise ─────────────── */

test("EVERY OFFER THE ENGINE MAKES IS ONE THE LEDGER ACCEPTS", () => {
  for (const difficulty of ["EASY", "HARD"]) {
    const offer = offerFor(OUTCOMES.AUTO_CREDIT, difficulty);
    assert.equal(
      validateOffer(offer.kind, offer.value).ok,
      true,
      `${difficulty} produced an offer the goodwill ledger would refuse, so the promise could never be recorded`,
    );

    const entry = createEntry({
      id: `gw_${difficulty}`,
      nowIso: "2026-09-12T10:00:00.000Z",
      subjectRef: "tnt_abc123",
      reason: "WhatsApp outage",
      kind: offer.kind,
      value: offer.value,
    });
    assert.equal(entry.ok, true, "and the obligation is recordable rather than living in a chat message");
    assert.equal(entry.entry.status, "owed", "starting as owed until an operator discharges it");
  }
});
