// Goodwill ledger — the record of what the business owes after an outage.
//
// The module is pure and moves no money: applying the credit is a manual
// operator action against the processor admin, because there is no verified
// discount API here and crediting wrongly is worse than crediting late.

import test from "node:test";
import assert from "node:assert/strict";
import {
  OFFER_LIMITS,
  describeOffer,
  validateOffer,
  createEntry,
  applyEntry,
  waiveEntry,
  outstanding,
} from "../src/lib/goodwill.ts";

const BASE = {
  id: "gw_1",
  nowIso: "2026-09-11T10:00:00.000Z",
  subjectRef: "tnt_643a07b0fe36d215",
  reason: "WhatsApp outage 2026-09-07",
  kind: "percent_off",
  value: 10,
};

/** Build a valid entry, varying only what the test cares about. */
function mk(over) {
  const r = createEntry({ ...BASE, ...over });
  assert.equal(r.ok, true, "baseline createEntry must succeed");
  return r.entry;
}

/** Create with a full valid baseline EXCEPT the field under test, so the
 *  refusal can only be caused by that field and not by a missing one. */
function refuseCreate(over, label) {
  refuse(createEntry({ ...BASE, ...over }), label);
}

function refuse(result, label) {
  assert.equal(result.ok, false, `${label} must be refused`);
  assert.ok(
    typeof result.reason === "string" && result.reason.length > 0,
    `${label} must carry a reason`,
  );
}

test("describeOffer renders each kind, and 1 day is singular", () => {
  assert.equal(describeOffer("percent_off", 10), "10% off the next month", "percent_off 10");
  assert.equal(describeOffer("free_days", 1), "1 free day", "one day must not be pluralised");
  assert.equal(describeOffer("free_days", 15), "15 free days", "free_days 15");
});

test("validateOffer accepts the owner's two approved offers", () => {
  assert.equal(validateOffer("percent_off", 10).ok, true, "10% off next month is approved");
  assert.equal(validateOffer("free_days", 15).ok, true, "15 free days is the approved fallback");
});

test("validateOffer refuses a bad kind", () => {
  refuse(validateOffer("free_month", 10), "free_month");
  refuse(validateOffer("", 10), "empty kind");
  refuse(validateOffer(null, 10), "null kind");
});

test("validateOffer refuses values that are not whole numbers above zero", () => {
  for (const v of [0, -1, 1.5, NaN, Infinity, "10", null]) {
    refuse(validateOffer("percent_off", v), `value ${String(v)}`);
  }
});

test("validateOffer enforces the ceilings, and the boundary itself is allowed", () => {
  refuse(validateOffer("percent_off", OFFER_LIMITS.maxPercent + 1), "51% off");
  assert.equal(validateOffer("percent_off", OFFER_LIMITS.maxPercent).ok, true, "exactly 50% must be allowed");
  refuse(validateOffer("free_days", OFFER_LIMITS.maxDays + 1), "91 free days");
  assert.equal(validateOffer("free_days", OFFER_LIMITS.maxDays).ok, true, "exactly 90 days must be allowed");
});

test("createEntry produces an owed entry", () => {
  const e = mk({});
  assert.equal(e.status, "owed", "a new obligation starts owed");
  assert.equal(e.appliedAt, null, "appliedAt starts null");
  assert.equal(e.appliedBy, null, "appliedBy starts null");
  assert.equal(e.note, null, "note starts null");
  assert.equal(e.incidentId, null, "incidentId defaults to null");
  assert.equal(e.createdAt, BASE.nowIso, "createdAt is the caller's clock, not a hidden one");
});

test("createEntry carries an incidentId when given", () => {
  assert.equal(mk({ incidentId: "inc_123" }).incidentId, "inc_123", "incidentId is carried");
});

test("PRIVACY: createEntry refuses a raw phone or email as the subject", () => {
  // Everything else is valid, so only the subjectRef can be causing the refusal.
  refuseCreate({ subjectRef: "+971554292699" }, "a raw phone with +");
  refuseCreate({ subjectRef: "971554292699" }, "a raw digit string");
  refuseCreate({ subjectRef: "someone@example.com" }, "an email address");
});

test("createEntry refuses empty id, subjectRef and reason", () => {
  for (const blank of ["", "   "]) {
    refuseCreate({ id: blank }, `id "${blank}"`);
    refuseCreate({ subjectRef: blank }, `subjectRef "${blank}"`);
    refuseCreate({ reason: blank }, `reason "${blank}"`);
  }
});

test("applyEntry records who and when, and does not mutate the input", () => {
  const e = mk({});
  const at = "2026-09-12T10:00:00.000Z";
  const r = applyEntry(e, at, "ops@vualet", "credited in Dodo admin");
  assert.equal(r.ok, true, "applying an owed entry succeeds");
  assert.equal(r.entry.status, "applied", "status becomes applied");
  assert.equal(r.entry.appliedAt, at, "appliedAt is recorded");
  assert.equal(r.entry.appliedBy, "ops@vualet", "an audit record needs the actor");
  assert.equal(r.entry.note, "credited in Dodo admin", "the note is kept");
  assert.equal(e.status, "owed", "the ORIGINAL entry must not be mutated");
  assert.equal(e.appliedBy, null, "the ORIGINAL entry must not gain an actor");
});

test("an obligation cannot be discharged twice", () => {
  const at = "2026-09-12T10:00:00.000Z";
  const applied = applyEntry(mk({}), at, "ops@vualet").entry;
  const again = applyEntry(applied, at, "ops@vualet");
  assert.equal(again.ok, false, "a discharged obligation cannot be discharged again");
  assert.ok(/applied/.test(again.reason), `the reason should name the current status, got: ${again.reason}`);
});

test("applyEntry refuses an empty operator", () => {
  const e = mk({});
  const at = "2026-09-12T10:00:00.000Z";
  refuse(applyEntry(e, at, ""), "an empty operator");
  refuse(applyEntry(e, at, "   "), "a whitespace operator");
});

test("waiveEntry requires a note", () => {
  const e = mk({});
  const at = "2026-09-12T10:00:00.000Z";
  refuse(waiveEntry(e, at, "ops@vualet", ""), "waiving with no note");
  refuse(waiveEntry(e, at, "ops@vualet", "   "), "waiving with a blank note");
  const r = waiveEntry(e, at, "ops@vualet", "duplicate of gw_0");
  assert.equal(r.ok, true, "waiving with a real note succeeds");
  assert.equal(r.entry.status, "waived", "status becomes waived");
  assert.equal(r.entry.note, "duplicate of gw_0", "the explanation is kept on the record");
});

test("outstanding returns only owed entries, newest first", () => {
  const oldest = mk({ id: "a", nowIso: "2026-09-01T00:00:00.000Z" });
  const middle = mk({ id: "b", nowIso: "2026-09-05T00:00:00.000Z" });
  const newest = mk({ id: "c", nowIso: "2026-09-09T00:00:00.000Z" });
  // applyEntry does not mutate, so the APPLIED copy must go into the list.
  const middleApplied = applyEntry(middle, "2026-09-06T00:00:00.000Z", "ops@vualet").entry;

  const list = outstanding([oldest, middleApplied, newest]);
  assert.equal(list.length, 2, "the applied entry must drop out of the outstanding list");
  assert.equal(list[0].id, "c", "newest owed entry comes first");
  assert.equal(list[1].id, "a", "oldest owed entry comes last");
});

test("outstanding is defensive", () => {
  assert.deepEqual(outstanding(null), [], "null returns an empty list");
  assert.deepEqual(outstanding(undefined), [], "undefined returns an empty list");
  assert.deepEqual(outstanding("nope"), [], "a non-array returns an empty list");
});
