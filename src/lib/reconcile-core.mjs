/**
 * RECONCILE CORE — pure, env-free reconciliation of LOCAL subscription records
 * against DODO, the source of truth. All I/O injected.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * Every revocation in this product is delivered by ONE mechanism — the Dodo
 * webhook at /api/webhooks/dodo — and that mechanism has NO production track
 * record whatsoever. verifications#413: 60 days of journalctl show only local
 * failed probes, and `grep api/webhooks/dodo` across every retained AND rotated
 * nginx log returns 0 lines. No Dodo webhook has ever reached this endpoint
 * through the edge. Not one.
 *
 * Three separate rulings have now converged on that single point of failure:
 *
 *   1. CANCEL ENFORCEMENT. The cancel route deliberately stops confiscating
 *      paid days and leaves the actual revocation to `subscription.cancelled` /
 *      `.expired`. That is the right trade — provided the webhook lands. If it
 *      never does, a cancelled subscriber keeps entitlement INDEFINITELY, not
 *      until period end. That is an unbounded leak, not the documented trade.
 *
 *   2. DUNNING STALL. `payment.failed` and `dunning.started` flag `pastDue` and
 *      deliberately do NOT revoke, waiting for `subscription.on_hold`. If
 *      dunning stalls, or on_hold is simply never delivered, that is a live
 *      path to indefinite paid access for a non-payer.
 *
 *   3. ZERO DELIVERY. Both of the above assume the webhook works at all. It has
 *      never once been observed to.
 *
 * So this sweep is the safety net under all three: it ASKS Dodo what is true
 * and repairs local records that disagree, without needing a single webhook to
 * have been delivered.
 *
 * ── ONE TABLE OF MEANINGS, NOT TWO ─────────────────────────────────────────
 *
 * The single most dangerous thing this module could do is decide, on its own,
 * what a provider state MEANS. `DODO_EVENT_EFFECTS` in dodo-webhook-core.mjs
 * already encodes that — which states revoke, which merely flag, which restore
 * and from what. A second table here that disagreed with it would be a worse
 * bug than having no sweep at all: the webhook and the sweep would fight, and
 * whichever ran last would win.
 *
 * So this module contains NO lifecycle meanings. It contains only a NAMING
 * convention that turns a provider snapshot back into the event type that would
 * have produced it —
 *
 *      subscription.status "on_hold"        -> "subscription.on_hold"
 *      payment.dispute_status "dispute_won" -> "dispute.won"
 *      payment.refund_status "succeeded"    -> "refund.succeeded"
 *
 * — and then hands that string to `dodoEventEffect()` and the resulting effect
 * to `applyDodoOutcome()`. The effects table is therefore also the ALLOWLIST: a
 * provider status with no row in it produces no effect and no write, which is
 * exactly the behaviour we want for a state we do not understand. When someone
 * adds a lifecycle rule to the webhook, the sweep inherits it with no edit here.
 *
 * ── THE GOVERNING CONSTRAINT [decisions#344, owner-ruled and binding] ──────
 *
 * Everything below is subordinate to this. Quoted verbatim:
 *
 *   "Reconciliation may remove access only when the provider identity, local
 *   identity, subscription identity, and revocation condition all match
 *   unambiguously. It may never grant access. Ambiguous or contradictory states
 *   become incidents for the normal entitlement pipeline to resolve."
 *
 * The four-way match is `revocationClearance()` — one function, one branch per
 * clause, named after the clause. The write authority is `SWEEP_APPLIES`, an
 * allowlist of exactly {revoke, flag, period}. `evaluate()` is the only place
 * in this module that produces a mutated record, and it refuses anything the
 * clearance does not pass. So "this sweep is one direction of write" is checked
 * by reading two functions, not inferred from the behaviour of a table.
 *
 * ── WHAT IT DELIBERATELY WILL NOT DO ───────────────────────────────────────
 *
 * A. IT NEVER GRANTS ACCESS. Not on `activate`, not on `restore`, not under any
 *    table authority, not for any reason. Dodo saying `active` while the local
 *    record says otherwise is REPORTED (`review_grant`) and never applied. The
 *    asymmetry is deliberate and it is about who notices: a missed ACTIVATION is
 *    loud — the customer paid, has no access, and opens a ticket within the
 *    hour. A missed REVOCATION is silent forever, which is why it needs a robot.
 *
 *    THIS FILE ONCE ARGUED OTHERWISE, AND THE ARGUMENT IS RECORDED HERE BECAUSE
 *    IT WAS WRONG IN AN INSTRUCTIVE WAY. It used to honour `restore` rows from
 *    the effects table (dispute.won, dispute.cancelled, dunning.recovered,
 *    subscription.unpaused) on the grounds that each carries an explicit `from`
 *    list and so can only lift the one revocation it has authority over. That is
 *    true, and it is not enough. A from-guarded restore is still A WRITE THAT
 *    INCREASES ACCESS, executed by the component with the broadest visibility
 *    and the weakest identity guarantees in the system. Four lines up, this same
 *    file justifies never granting by observing that "a join bug could hand paid
 *    access to a stranger; auto-revoking wrongly is guarded everywhere below,
 *    but granting wrongly has no guard at all" — and the `from` list NARROWS
 *    that exposure without removing it. A wrong join plus a genuine dispute.won
 *    at the provider still lands access on the wrong record. Restores are now
 *    `review_restore` findings: reported, never applied.
 *
 *    THE COST OF THIS, STATED PLAINLY AND ACCEPTED. A missed `dispute.won` or
 *    `dunning.recovered` leaves A PAYING CUSTOMER REVOKED until a human acts on
 *    the finding. That is a real person, locked out, who did nothing wrong. It
 *    is accepted because it is the LOUD failure — they notice within the hour
 *    and open a ticket, and the finding is already sitting in the operator's
 *    queue explaining exactly what happened — and because the alternative is a
 *    silent hidden write path that can grant access to the wrong person with
 *    nobody ever knowing. Granting belongs in the verified payment/webhook path,
 *    not in a sweep.
 *
 *    `review_restore` is kept DISTINCT from `review_grant` on purpose: "we may
 *    be wrongly withholding from someone who won a dispute" and "we may be
 *    wrongly withholding from someone who paid" are different incidents needing
 *    different human responses, and an operator must be able to sort them
 *    without reading prose.
 *
 * B. A 404 NEVER REVOKES ANYONE — see `planOrphans` below. verifications#412
 *    caught this exact mistake once already.
 *
 * C. NOTHING IS WRITTEN WHEN THE SWEEP IS INCOMPLETE. One failed page, one
 *    rate-limit, one unreachable read anywhere, and the ENTIRE repair phase
 *    refuses. See `applySweep`.
 *
 * @typedef {import("./store").ConnectRecord} ConnectRecord
 */

import { dodoEventEffect, applyDodoOutcome, periodFieldsFromDodo } from "./dodo-webhook-core.mjs";
import { LIVE_DODO_STATUS } from "./entitlement-core.mjs";

/**
 * Work caps. A sweep that can run unbounded is a sweep that can hammer the
 * provider into rate-limiting us, and a rate-limited sweep is an INCOMPLETE
 * sweep, which (by C above) does nothing at all. Bounding it is not politeness,
 * it is what makes it able to finish.
 *
 * `maxRepairs` IS THE BLAST RADIUS, AND HERE IS WHERE THE NUMBER COMES FROM.
 * The live account holds 18 subscriptions (verifications#413). 50 is ~2.8x
 * that: comfortable headroom for the book to triple before an operator has to
 * think about this number again, while still being far below "every record I
 * know about disagrees with the provider at once". That second thing is not a
 * busy week — it is the signature of a broken assumption in this sweep (wrong
 * DODO_MODE, a key pointed at the other environment, a join that stopped
 * joining), and the correct response is to stop and show a human, not to
 * rewrite the whole book on the strength of it.
 *
 * OVERFLOW IS NOT SILENT. Going over the cap refuses the ENTIRE repair phase —
 * not the first 50 — and the run reports it and exits with the "incomplete,
 * more remains" code rather than looking like a clean sweep. A partial repair
 * that exits 0 is the worst of both worlds: work left undone AND a green light
 * saying otherwise. See `exitCodeFor` below.
 */
export const SWEEP_LIMITS = Object.freeze({
  pageSize: 100,
  maxSubscriptionPages: 20,
  maxPaymentPages: 20,
  maxOrphanChecks: 500,
  maxRepairs: 50,
  requestTimeoutMs: 15000,
  totalTimeoutMs: 300000,
});

// ---------------------------------------------------------------------------
// Redaction. Nothing in this module ever emits a whole email, payment id or
// key. Operators need enough to grep the provider dashboard, not enough to leak
// a customer list into a log aggregator.
// ---------------------------------------------------------------------------

/**
 * `ada.lovelace@example.co.uk` -> `a…e@….co.uk`. Enough to recognise a customer
 * you already know, useless as a harvested address.
 * @param {unknown} email
 * @returns {string}
 */
export function redactEmail(email) {
  if (typeof email !== "string" || !email.includes("@")) return "(none)";
  const at = email.lastIndexOf("@");
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, 1) || "?";
  const tail = local.length > 1 ? local.slice(-1) : "";
  const dot = domain.lastIndexOf(".");
  const tld = dot > -1 ? domain.slice(dot) : "";
  return `${head}…${tail}@…${tld}`;
}

/**
 * Keep the last 6 characters of an identifier. Dodo ids are long and their
 * suffix is the part an operator pastes into a dashboard search; the prefix is
 * the part that turns a log line into a customer list.
 * @param {unknown} id
 * @returns {string}
 */
export function redactId(id) {
  if (typeof id !== "string" || !id) return "(none)";
  return id.length <= 6 ? `…${id}` : `…${id.slice(-6)}`;
}

/**
 * A finding, safe to emit anywhere.
 *
 * Findings carry RAW identifiers internally because the repair needs them to
 * key a write. The moment one leaves the process — a JSON dump, a log line, a
 * paste into a ticket — those identifiers are a customer list, so every exit
 * path goes through here. `effect` is dropped as well: it is the effects-table
 * row, useful in-process and pure noise in a report.
 *
 * @param {any} f
 * @returns {any}
 */
export function redactFinding(f) {
  const { effect, customerId, subscriptionId, paymentId, ...rest } = f ?? {};
  const out = { ...rest };
  if (customerId !== undefined) out.customerId = redactId(customerId);
  if (subscriptionId !== undefined) out.subscriptionId = redactId(subscriptionId);
  if (paymentId !== undefined) out.paymentId = redactId(paymentId);
  return out;
}

// ---------------------------------------------------------------------------
// Provenance — the guard that stops this sweep repeating verifications#412
// ---------------------------------------------------------------------------

/**
 * WHOSE RECORD IS THIS? The whole reason this function exists is that the
 * answer used to be unknowable.
 *
 * The Stripe webhook and the Dodo webhook write the SAME `mira:sub:<customerId>`
 * key space with nothing to tell them apart. A legacy Stripe-era row was once
 * probed against the Dodo API, came back unknown, and was written up as an
 * orphaned Dodo subscription. It was nothing of the kind — it was a perfectly
 * healthy Stripe customer, and a sweep acting on that diagnosis would have
 * revoked a paying one.
 *
 * `ConnectRecord.provider` now records this, but store.ts is explicit that it
 * is OPTIONAL AND OFTEN ABSENT and that nothing backfills it, because a
 * backfill would have to guess the provider of exactly the rows whose provider
 * is unknowable. So `undefined` means "written before we tagged", NOT "Stripe"
 * and NOT "Dodo" — and this function refuses to turn it into either.
 *
 * For an UNTAGGED record there is exactly one way to earn a Dodo verdict, and
 * it is not inference: DODO ITSELF must have named it. When we are looking at a
 * Dodo API object whose `metadata.connect_token` or `subscription_id` matches
 * what the local row already holds, the provider has positively identified the
 * row as its own. That is evidence, not a guess. Anything less is `unprovable`,
 * and an unprovable row is only ever reported.
 *
 * @param {any} rec  local record (may be null)
 * @param {{ connectToken?: string, subscriptionId?: string }} [evidence]
 *        identifiers carried by the DODO-side object we matched this record to
 * @returns {"no_record"|"foreign"|"dodo"|"dodo_by_token"|"dodo_by_subscription"|"unprovable"}
 */
export function providerVerdict(rec, evidence = {}) {
  if (!rec || typeof rec !== "object") return "no_record";
  if (rec.provider === "dodo") return "dodo";
  // Any explicit non-Dodo tag: not ours to touch. Written as "not dodo" rather
  // than "=== stripe" so a third provider added later is excluded by default
  // instead of being silently swept.
  if (typeof rec.provider === "string" && rec.provider) return "foreign";

  if (evidence.connectToken && typeof rec.token === "string" && rec.token === evidence.connectToken) {
    return "dodo_by_token";
  }
  if (
    evidence.subscriptionId &&
    typeof rec.subscriptionId === "string" &&
    rec.subscriptionId === evidence.subscriptionId
  ) {
    return "dodo_by_subscription";
  }
  return "unprovable";
}

/**
 * THE SWEEP'S ENTIRE WRITE AUTHORITY, AS AN ALLOWLIST [decisions#344].
 *
 * An allowlist rather than a denylist, and that is the whole point: an effect
 * kind added to DODO_EVENT_EFFECTS tomorrow is NOT applied by this sweep until
 * somebody deliberately adds it here. The default for anything new is "report,
 * do not write", which is the only default that cannot leak access by
 * omission.
 *
 *   revoke  removes access          — the reason this sweep exists
 *   flag    records evidence        — entitlement-neutral by construction
 *   period  syncs billing dates     — entitlement-neutral by construction
 *
 * Conspicuously absent, permanently:
 *   activate  would GRANT access
 *   restore   would GRANT access (see the header; the `from` guard is not enough)
 */
export const SWEEP_APPLIES = Object.freeze(new Set(["revoke", "flag", "period"]));

/**
 * THE FOUR-WAY MATCH — the rule from decisions#344, as one readable function.
 *
 * The owner's rule names four things that must ALL match unambiguously before
 * this sweep may remove access. They were previously enforced, but scattered
 * across two phases and several early returns, so checking that the code
 * implements the rule meant reconstructing it. Here each clause is one branch,
 * named after the clause it enforces, in the order the rule states them.
 *
 * This is the single gate every write passes through: `evaluate()` calls it and
 * refuses anything it does not clear, and `evaluate()` is the only function in
 * this module that produces a mutated record. So "the sweep is one direction of
 * write" is verifiable by reading these two functions, rather than by trusting
 * an effects table to stay correct forever.
 *
 * @param {{ rec?: any, effect?: any, verdict?: string, providerSubscriptionId?: string }} input
 * @returns {{ ok: true } | { ok: false, clause: string, kind: string, why: string }}
 */
export function revocationClearance(input = {}) {
  const { rec, effect, verdict, providerSubscriptionId } = input;

  // ── CLAUSE 1: PROVIDER IDENTITY ────────────────────────────────────────
  // Is this row provably Dodo's? An explicit `provider: "dodo"` tag, or — the
  // point the owner ruled on directly — Dodo's OWN metadata.connect_token (or
  // subscription id) naming it. That is the provider asserting the link, not
  // us inferring it, so it satisfies "identity matches unambiguously". A row
  // with no tag and no provider-side evidence does not, and is skipped.
  if (!isRepairable(String(verdict))) {
    return {
      ok: false,
      clause: "provider identity",
      kind: verdict === "foreign" ? "skipped_foreign_provider" : "skipped_unprovable_provenance",
      why:
        verdict === "foreign"
          ? "the local record is tagged to another provider"
          : "nothing on the provider side proves this record is Dodo's",
    };
  }

  // ── CLAUSE 2: LOCAL IDENTITY ───────────────────────────────────────────
  // There must actually be a record to act on. No record is not a revocation
  // candidate; it is a missing row, which is a different incident entirely.
  if (!rec || typeof rec !== "object") {
    return {
      ok: false,
      clause: "local identity",
      kind: "missing_local_record",
      why: "there is no local record to remove access from",
    };
  }

  // ── CLAUSE 3: SUBSCRIPTION IDENTITY ────────────────────────────────────
  // When both sides name a subscription, they must name the SAME one. A refund
  // or dispute against a subscription the customer has already replaced would
  // otherwise revoke the one they are paying for today. A record that names no
  // subscription cannot contradict one, so it does not fail this clause.
  if (
    providerSubscriptionId &&
    typeof rec.subscriptionId === "string" &&
    rec.subscriptionId &&
    rec.subscriptionId !== providerSubscriptionId
  ) {
    return {
      ok: false,
      clause: "subscription identity",
      kind: "review_subscription_mismatch",
      why: "the provider object belongs to a different subscription than the local record tracks",
    };
  }

  // ── CLAUSE 4: REVOCATION CONDITION ─────────────────────────────────────
  // The effect must be one this sweep has authority to apply — and that
  // authority is removal only. `activate` and `restore` both INCREASE access
  // and are therefore never cleared, whatever the effects table says about
  // them, because the table's authority is the webhook's, not this sweep's.
  if (!effect || typeof effect !== "object" || !effect.kind) {
    return {
      ok: false,
      clause: "revocation condition",
      kind: "no_effect",
      why: "no entry in DODO_EVENT_EFFECTS, so no meaning is assumed",
    };
  }
  if (!SWEEP_APPLIES.has(effect.kind)) {
    return {
      ok: false,
      clause: "revocation condition",
      kind: effect.kind === "restore" ? "review_restore" : "review_grant",
      why:
        effect.kind === "restore"
          ? "this event would RESTORE access; reconciliation may never grant, so it is reported"
          : "this event would GRANT access; reconciliation may never grant, so it is reported",
    };
  }

  return { ok: true };
}

/**
 * Verdicts that permit acting on a record. Everything else is report-only.
 * @param {string} verdict
 * @returns {boolean}
 */
export function isRepairable(verdict) {
  return verdict === "dodo" || verdict === "dodo_by_token" || verdict === "dodo_by_subscription";
}

// ---------------------------------------------------------------------------
// Snapshot -> event type. NAMING ONLY. No meanings live here.
// ---------------------------------------------------------------------------

/**
 * The event type a Dodo subscription STATUS corresponds to.
 *
 * Pure string construction on purpose. Dodo's subscription statuses and our
 * event names share a namespace (`on_hold` -> `subscription.on_hold`), so the
 * mapping needs no table, and having no table is the point: there is nothing
 * here to drift out of step with DODO_EVENT_EFFECTS. A status with no row in
 * that table — `pending`, or anything Dodo adds tomorrow — resolves to null and
 * is reported rather than acted on.
 *
 * @param {unknown} status
 * @returns {string|null}
 */
export function subscriptionEventType(status) {
  if (typeof status !== "string" || !status) return null;
  const type = `subscription.${status.trim().toLowerCase()}`;
  return dodoEventEffect(type) ? type : null;
}

/**
 * The event type a payment's `dispute_status` corresponds to.
 * Dodo spells these `dispute_won` / `dispute_lost` / …; the prefix is stripped
 * and the rest re-namespaced, then validated against the effects table.
 * @param {unknown} disputeStatus
 * @returns {string|null}
 */
export function disputeEventType(disputeStatus) {
  if (typeof disputeStatus !== "string" || !disputeStatus) return null;
  const bare = disputeStatus.trim().toLowerCase().replace(/^dispute[_.-]?/, "");
  if (!bare) return null;
  const type = `dispute.${bare}`;
  return dodoEventEffect(type) ? type : null;
}

/**
 * The event type a payment's `refund_status` corresponds to.
 *
 * NARROWER THAN THE OTHERS, AND DELIBERATELY SO. `refund.succeeded` is a
 * REVOCATION, and refund payloads are the one shape nobody in this codebase has
 * ever seen live (dodo-webhook-core.mjs says so, and /refunds is empty). So
 * this does not pattern-match its way to a revocation: only a value that
 * unambiguously means the money went back is accepted, and everything else —
 * `pending`, `review`, `failed`, or a spelling we have not met — resolves to
 * null and is reported. A refund that did NOT happen must not revoke anything.
 *
 * @param {unknown} refundStatus
 * @returns {string|null}
 */
export function refundEventType(refundStatus) {
  if (typeof refundStatus !== "string" || !refundStatus) return null;
  const v = refundStatus.trim().toLowerCase();
  if (v === "succeeded" || v === "success" || v === "refunded" || v === "fully_refunded") {
    return dodoEventEffect("refund.succeeded") ? "refund.succeeded" : null;
  }
  return null;
}

/**
 * A period-only pseudo-effect: sync `cancelAtPeriodEnd` / `currentPeriodEnd`
 * and touch NOTHING else.
 *
 * This carries no `status`, no `disputed`, no `pastDue` and no `from` list —
 * it encodes no lifecycle meaning at all, which is why it is allowed to live
 * outside DODO_EVENT_EFFECTS without being the "second table" this module
 * exists to avoid. `applyDodoOutcome` applies period fields before its switch
 * and its default branch does nothing else, so this is entitlement-neutral by
 * construction rather than by promise.
 *
 * It matters because of judge condition 1: when a customer cancels at period
 * end, the record is supposed to stay `active` and carry the end date. If that
 * event never arrived, the account page tells a cancelling customer their
 * subscription is renewing. Wrong, visible to them, and entirely fixable
 * without going anywhere near the entitlement gate.
 */
export const PERIOD_ONLY_EFFECT = Object.freeze({
  kind: "period",
  why: "billing-period fields only; entitlement is not touched",
});

// ---------------------------------------------------------------------------
// Finding construction
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   phase: "subscriptions"|"payments"|"orphans",
 *   kind: string,
 *   customerId?: string,
 *   subscriptionId?: string,
 *   paymentId?: string,
 *   eventType?: string,
 *   effect?: any,
 *   verdict?: string,
 *   from?: string|null,
 *   to?: string|null,
 *   entitlementLoss?: boolean,
 *   applicable: boolean,
 *   note: string,
 *   at?: string,
 * }} Finding
 */

/**
 * @param {any} f
 * @returns {Finding}
 */
function finding(f) {
  return /** @type {Finding} */ ({ applicable: false, note: "", ...f });
}

/**
 * Does this local status grant web access? Read from the ONE gate
 * (entitlement-core.LIVE_DODO_STATUS), never re-spelled here.
 * @param {unknown} status
 * @returns {boolean}
 */
function grants(status) {
  return typeof status === "string" && LIVE_DODO_STATUS.has(status);
}

/**
 * Structural equality for records. Both sides are produced by spreading the
 * same base, so key order is stable and a JSON compare is exact — and it is
 * what makes idempotence a PROPERTY rather than a hope: nothing is written
 * unless the record genuinely differs from the one on disk.
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
function sameRecord(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Build the finding for one (record, effect) pair by DRY-RUNNING the exact
 * mutation the webhook would perform. `applyDodoOutcome` is pure, so calling it
 * here costs nothing and guarantees the dry-run report and the repair cannot
 * disagree — the report IS the repair, minus the write.
 *
 * ── THE ALREADY-REVOKED GUARD, AND WHY A SWEEP NEEDS ONE THE WEBHOOK DOES NOT
 *
 * The webhook sees events IN ORDER, one at a time, moments after each happens.
 * A sweep sees a whole SNAPSHOT at once, with no ordering information at all —
 * and that difference has teeth. A customer whose subscription is `cancelled`
 * at Dodo AND whose last payment carries `dispute_status: dispute_lost` yields
 * two revocations from one snapshot, in whatever order the phases happen to run
 * in. Applied naively they relabel each other: the subscription phase writes
 * "cancelled", the payment phase overwrites it with "chargeback", and on the
 * NEXT run the subscription phase writes "cancelled" again. Two revocations,
 * fighting, forever, each run reporting a change and rewriting the record.
 *
 * The guard is simply this: ONCE A RECORD NO LONGER ENTITLES, THE SWEEP WILL
 * NOT CHANGE WHICH KIND OF NOT-ENTITLED IT IS. Access is already gone, so
 * re-labelling buys nothing that could justify the churn — and it is precisely
 * the churn that would make this tool untrustworthy to run on a schedule.
 * Ancillary bookkeeping (`disputed`, `disputeStatus`, `pastDue`, the period
 * fields) is still recorded, because that is what an operator reads to find out
 * WHY. Only the entitlement-bearing `status` is pinned.
 *
 * Note the guard cannot mask a leak: it only ever declines to move a record
 * that ALREADY denies access. The active -> revoked transition, which is the
 * entire reason this file exists, is untouched by it.
 *
 * @param {any} base
 * @param {any} rec
 * @param {any} effect
 * @param {{ now?: string, period?: any }} ctx
 * @returns {{ finding: Finding, rec: any }}
 */
function evaluate(base, rec, effect, ctx, clearanceInput = {}) {
  // THE GATE [decisions#344]. Every mutated record in this module comes out of
  // this function, so this one check is the whole write authority. It is
  // deliberately redundant with the richer, better-worded refusals the phases
  // raise earlier: those exist to explain, this exists to be impossible to get
  // past. A future edit that adds a new call site inherits the rule for free.
  const clearance = revocationClearance({
    rec,
    effect,
    verdict: clearanceInput.verdict ?? "dodo",
    providerSubscriptionId: clearanceInput.providerSubscriptionId,
  });
  if (!clearance.ok) {
    const held = rec?.status ?? null;
    return {
      finding: finding({
        ...base,
        kind: clearance.kind,
        from: held,
        to: held,
        applicable: false,
        entitlementLoss: false,
        note:
          `${base.note ? base.note + " — " : ""}NOT APPLIED (${clearance.clause}): ${clearance.why}. ` +
          `Reconciliation may remove access or report, and nothing else [decisions#344].`,
      }),
      rec,
    };
  }

  const outcome = applyDodoOutcome(rec, effect, ctx);
  const before = rec?.status ?? null;
  let next = outcome.rec;
  let action = outcome.action;
  let note = outcome.note;

  if (effect?.kind === "revoke" && before != null && !grants(before) && next?.status !== before) {
    next = { ...next, status: before };
    action = "already_revoked";
    note =
      `local status "${before}" already denies access, so the sweep left it alone rather than ` +
      `re-labelling one revocation as another; flags and dates were still recorded ` +
      `(the underlying effect said: ${outcome.note})`;
  }

  const after = next?.status ?? null;
  // `changed` is recomputed STRUCTURALLY rather than taken from the effect,
  // because the guard above can undo the only thing the effect changed.
  const changed = !sameRecord(rec, next);

  /**
   * The reported kind describes what actually happened, not what the effect
   * intended: a `revoke` that moved no status is not a revocation, and a
   * refused restore must never read as a restore.
   */
  let kind;
  if (action === "restore_refused" || action === "already_revoked") kind = action;
  else if (!changed) kind = "already_correct";
  else if ((action === "revoke" || action === "restore") && before === after) kind = "period";
  else kind = action ?? base.kind;

  return {
    finding: finding({
      ...base,
      effect,
      from: before,
      to: after,
      applicable: changed,
      entitlementLoss: grants(before) && !grants(after),
      kind,
      note: note || base.note,
    }),
    rec: next,
  };
}

// ---------------------------------------------------------------------------
// Phase 1 — Dodo subscriptions -> local records
// ---------------------------------------------------------------------------

/**
 * Page `/subscriptions` and compare each one against our record.
 *
 * THIS IS THE PHASE THAT CATCHES CONDITIONS 1 AND 2. A subscription Dodo calls
 * `cancelled` or `on_hold` while our record still says `active` is precisely
 * the indefinite-access leak both judges described, and it surfaces here as a
 * one-line status disagreement.
 *
 * @param {any} deps
 * @param {any} state
 */
async function planSubscriptions(deps, state) {
  const { limits, now } = state;
  for (let page = 0; page < limits.maxSubscriptionPages; page++) {
    state.checkDeadline();
    const res = await deps.dodo.listSubscriptions({ pageNumber: page, pageSize: limits.pageSize });
    const items = Array.isArray(res && res.items) ? res.items : [];
    state.stats.subscriptionsSeen += items.length;

    for (const item of items) {
      const customerId = item?.customer?.customer_id ?? item?.customer_id;
      const subscriptionId = item?.subscription_id;
      const connectToken = item?.metadata?.connect_token;
      if (customerId) state.matchedCustomers.add(customerId);

      if (!customerId) {
        state.findings.push(
          finding({
            phase: "subscriptions",
            kind: "unidentifiable",
            subscriptionId,
            note: `subscription ${redactId(subscriptionId)} names no customer; skipped`,
          }),
        );
        continue;
      }

      const rec = await state.loadLocal(customerId);
      const verdict = providerVerdict(rec, { connectToken, subscriptionId });
      const idNote = `customer ${redactId(customerId)} / sub ${redactId(subscriptionId)}`;

      if (verdict === "no_record") {
        // Dodo knows this subscription and we do not. Never a revocation —
        // there is nothing to revoke — and never an activation either (rule A).
        state.findings.push(
          finding({
            phase: "subscriptions",
            kind: "missing_local_record",
            customerId,
            subscriptionId,
            verdict,
            note:
              `${idNote}: Dodo holds status "${item?.status}" but there is NO local record. ` +
              `Nothing was written. If this customer paid, their activation webhook never landed ` +
              `and this needs a human — the sweep does not mint entitlement.`,
          }),
        );
        continue;
      }
      if (!isRepairable(verdict)) {
        state.findings.push(
          finding({
            phase: "subscriptions",
            kind: verdict === "foreign" ? "skipped_foreign_provider" : "skipped_unprovable_provenance",
            customerId,
            subscriptionId,
            verdict,
            note:
              verdict === "foreign"
                ? `${idNote}: local record is tagged provider="${rec.provider}", not Dodo's to repair.`
                : `${idNote}: local record carries NO provider tag and Dodo named neither its ` +
                  `connect token nor its subscription id, so nothing proves this row is Dodo's. ` +
                  `Reported, not touched (verifications#412).`,
          }),
        );
        continue;
      }

      const period = periodFieldsFromDodo(item);
      const type = subscriptionEventType(item?.status);

      if (!type) {
        // No row in the effects table for this provider status (e.g. "pending").
        // Sync the period fields, which are entitlement-neutral, and report the
        // status as unhandled rather than inventing a meaning for it.
        const ev = evaluate(
          {
            phase: "subscriptions",
            kind: "period",
            customerId,
            subscriptionId,
            verdict,
            note:
              `${idNote}: provider status "${item?.status}" has no entry in DODO_EVENT_EFFECTS, ` +
              `so no lifecycle meaning was assumed; billing-period fields only`,
          },
          rec,
          PERIOD_ONLY_EFFECT,
          { now, period },
          { verdict },
        );
        state.stage(customerId, ev.finding, ev.rec);
        continue;
      }

      const effect = dodoEventEffect(type);

      if (effect.kind === "restore") {
        // [decisions#344] A provider state that would RESTORE access. Reported
        // with the local status attached, because the operator's next question
        // is always "restore them from what?".
        const held = rec?.status ?? null;
        state.findings.push(
          finding({
            phase: "subscriptions",
            kind: "review_restore",
            customerId,
            subscriptionId,
            verdict,
            eventType: type,
            from: held,
            to: held,
            note:
              `${idNote}: Dodo says "${item?.status}", which would RESTORE access from local status ` +
              `"${held ?? "none"}". The sweep may remove access or report, never grant [decisions#344], ` +
              `so nothing was written. If this customer is entitled, a human must reinstate them — ` +
              `and until then they are locked out.`,
          }),
        );
        continue;
      }

      if (effect.kind === "activate") {
        // RULE A. Dodo is happy; we may not be. Report, never apply.
        const local = rec?.status ?? null;
        if (grants(local)) {
          const ev = evaluate(
            {
              phase: "subscriptions",
              kind: "period",
              customerId,
              subscriptionId,
              verdict,
              eventType: type,
              note: `${idNote}: provider and local agree on access; billing-period fields only`,
            },
            rec,
            PERIOD_ONLY_EFFECT,
            { now, period },
            { verdict },
          );
          state.stage(customerId, ev.finding, ev.rec);
        } else {
          state.findings.push(
            finding({
              phase: "subscriptions",
              kind: "review_grant",
              customerId,
              subscriptionId,
              verdict,
              eventType: type,
              from: local,
              to: local,
              note:
                `${idNote}: Dodo says "${item?.status}" but the local record says "${local ?? "none"}", ` +
                `so this customer is being REFUSED access they may be paying for. The sweep does not ` +
                `grant entitlement (rule A) — a human must confirm and fix this one.`,
            }),
          );
        }
        continue;
      }

      const ev = evaluate(
        {
          phase: "subscriptions",
          kind: effect.kind,
          customerId,
          subscriptionId,
          verdict,
          eventType: type,
          note: `${idNote}: provider status "${item?.status}"`,
        },
        rec,
        effect,
        { now, period },
        { verdict, providerSubscriptionId: subscriptionId },
      );
      state.stage(customerId, ev.finding, ev.rec);
    }

    // A short page is the last page. Anything else and we keep going until a
    // cap stops us — and a cap stopping us marks the sweep truncated, which is
    // treated as incomplete, which refuses every repair.
    if (items.length < limits.pageSize) return;
  }
  state.truncated.subscriptions = true;
}

// ---------------------------------------------------------------------------
// Phase 2 — Dodo payments -> local records
// ---------------------------------------------------------------------------

/**
 * Page `/payments` and read `refund_status` / `dispute_status` off each one.
 *
 * THIS IS THE CHEAPEST COVERAGE WE HAVE. Both fields sit on the payment object
 * itself (verified against the live API), so a single pass over /payments
 * catches every refund and every dispute outcome whose webhook was missed —
 * without a second pass over /refunds and /disputes, and without needing the
 * webhook to have ever worked once.
 *
 * @param {any} deps
 * @param {any} state
 */
async function planPayments(deps, state) {
  const { limits, now } = state;
  for (let page = 0; page < limits.maxPaymentPages; page++) {
    state.checkDeadline();
    const res = await deps.dodo.listPayments({ pageNumber: page, pageSize: limits.pageSize });
    const items = Array.isArray(res && res.items) ? res.items : [];
    state.stats.paymentsSeen += items.length;

    for (const item of items) {
      const customerId = item?.customer?.customer_id ?? item?.customer_id;
      const paymentId = item?.payment_id;
      const subscriptionId = item?.subscription_id;
      const connectToken = item?.metadata?.connect_token;

      const types = [refundEventType(item?.refund_status), disputeEventType(item?.dispute_status)].filter(Boolean);
      if (types.length === 0) continue; // an ordinary payment; nothing to reconcile

      if (!customerId) {
        state.findings.push(
          finding({
            phase: "payments",
            kind: "unidentifiable",
            paymentId,
            note: `payment ${redactId(paymentId)} carries an outcome but names no customer; skipped`,
          }),
        );
        continue;
      }

      const rec = await state.loadLocal(customerId);
      const verdict = providerVerdict(rec, { connectToken, subscriptionId });
      const idNote = `customer ${redactId(customerId)} / payment ${redactId(paymentId)}`;

      if (verdict === "no_record" || !isRepairable(verdict)) {
        state.findings.push(
          finding({
            phase: "payments",
            kind:
              verdict === "no_record"
                ? "missing_local_record"
                : verdict === "foreign"
                  ? "skipped_foreign_provider"
                  : "skipped_unprovable_provenance",
            customerId,
            paymentId,
            verdict,
            note:
              `${idNote}: ${types.join(", ")} seen at Dodo but the local record is ` +
              `${verdict === "no_record" ? "absent" : `not provably Dodo's (${verdict})`}; nothing written.`,
          }),
        );
        continue;
      }

      /**
       * THE WRONG-SUBSCRIPTION GUARD — stricter than the webhook, on purpose.
       *
       * The webhook resolves a refund or dispute to a CUSTOMER and acts on
       * whatever record that customer has. That is fine when events arrive in
       * order, moments after the fact. A sweep is different: it reads the whole
       * back catalogue at once, so a refund against a subscription the customer
       * ALREADY replaced would revoke the one they are paying for today.
       * A mismatch is ambiguous, and ambiguity is reported, never applied.
       */
      if (
        subscriptionId &&
        typeof rec.subscriptionId === "string" &&
        rec.subscriptionId &&
        rec.subscriptionId !== subscriptionId
      ) {
        state.findings.push(
          finding({
            phase: "payments",
            kind: "review_subscription_mismatch",
            customerId,
            paymentId,
            subscriptionId,
            verdict,
            note:
              `${idNote}: this payment belongs to subscription ${redactId(subscriptionId)} but the ` +
              `local record tracks ${redactId(rec.subscriptionId)}. Acting would risk revoking a ` +
              `DIFFERENT, live subscription, so nothing was written. Needs a human.`,
          }),
        );
        continue;
      }

      for (const type of types) {
        const effect = dodoEventEffect(type);

        if (effect.kind === "restore") {
          // [decisions#344] The commonest real instance of the rule: a dispute
          // we WON. The money stayed with us and the customer is very likely
          // entitled — and this sweep still will not write it, because the same
          // code path, given a bad join, would hand access to a stranger.
          const held = rec?.status ?? null;
          state.findings.push(
            finding({
              phase: "payments",
              kind: "review_restore",
              customerId,
              paymentId,
              subscriptionId,
              verdict,
              eventType: type,
              from: held,
              to: held,
              note:
                `${idNote}: dispute_status="${item?.dispute_status}" would RESTORE access from local ` +
                `status "${held ?? "none"}". Reconciliation may remove access or report, never grant ` +
                `[decisions#344], so nothing was written. THIS MAY BE A PAYING CUSTOMER WHO IS ` +
                `CURRENTLY LOCKED OUT — route it to the entitlement pipeline for a human decision.`,
            }),
          );
          continue;
        }

        // Chain onto whatever this customer's record has already become in this
        // run, so two outcomes on one customer compose exactly as two webhooks
        // would have — and a restore still meets the status a revoke just set,
        // where the table's own `from` guard can rule on it.
        const slot = state.pending.get(customerId);
        const current = slot ? slot.rec : rec;
        const ev = evaluate(
          {
            phase: "payments",
            kind: effect.kind,
            customerId,
            paymentId,
            subscriptionId,
            verdict,
            eventType: type,
            // TOLERATED, NOT VERIFIED. `created_at` is NOT among the payment
            // fields verifications#413 actually observed on the live API, so it
            // is read defensively and used for NOTHING but an operator-facing
            // timestamp on the finding. No decision reads it, and a payload
            // without it behaves identically (proved in the test file).
            at: typeof item?.created_at === "string" ? item.created_at : undefined,
            note:
              `${idNote}: refund_status="${item?.refund_status ?? "none"}" ` +
              `dispute_status="${item?.dispute_status ?? "none"}"`,
          },
          current,
          effect,
          { now },
          { verdict, providerSubscriptionId: subscriptionId },
        );
        state.stage(customerId, ev.finding, ev.rec);
      }
    }

    if (items.length < limits.pageSize) return;
  }
  state.truncated.payments = true;
}

// ---------------------------------------------------------------------------
// Phase 3 — local records -> Dodo (orphan detection, REPORT ONLY)
// ---------------------------------------------------------------------------

/**
 * For every local record Dodo's own listings did NOT mention, ask
 * `GET /subscriptions/{id}` directly.
 *
 * A 404 NEVER REVOKES. Not for an untagged record, not for a Dodo-tagged one,
 * not in repair mode, not ever. Three independent reasons, any one of which
 * would be enough on its own:
 *
 *   1. verifications#412 IS THIS EXACT MISTAKE. The one record that looked like
 *      an orphan was a legacy Stripe-era row living in the shared
 *      `mira:sub:<customerId>` key space. Revoking on 404 would have cut off a
 *      paying Stripe customer to fix a Dodo problem they were never part of.
 *
 *   2. A 404 IS AN ABSENCE OF EVIDENCE, NOT AN OUTCOME. It is equally
 *      consistent with a test-mode key pointed at live data, a subscription id
 *      we recorded wrong, a provider-side deletion, and a genuine cancellation.
 *      Only one of those four is a revocation.
 *
 *   3. DODO_EVENT_EFFECTS HAS NO ROW FOR "no longer exists" — and inventing one
 *      here is precisely the second, divergent table this module refuses to be.
 *
 * So this phase produces `orphan_review` findings, and an operator decides.
 *
 * @param {any} deps
 * @param {any} state
 */
async function planOrphans(deps, state) {
  const { limits } = state;
  if (typeof deps.store.listSubscriptionCustomerIds !== "function") {
    state.findings.push(
      finding({
        phase: "orphans",
        kind: "phase_unavailable",
        note: "the store adapter cannot enumerate mira:sub:* keys, so the local->Dodo direction was skipped",
      }),
    );
    return;
  }
  const ids = (await deps.store.listSubscriptionCustomerIds()) ?? [];
  state.stats.localRecords = ids.length;

  let checked = 0;
  for (const customerId of ids) {
    if (state.matchedCustomers.has(customerId)) continue;
    if (checked >= limits.maxOrphanChecks) {
      state.truncated.orphans = true;
      return;
    }
    state.checkDeadline();
    checked++;

    const rec = await state.loadLocal(customerId);
    const verdict = providerVerdict(rec, {});
    if (verdict === "no_record") continue;

    if (verdict === "foreign") {
      state.findings.push(
        finding({
          phase: "orphans",
          kind: "skipped_foreign_provider",
          customerId,
          verdict,
          note: `customer ${redactId(customerId)}: provider="${rec.provider}" — not Dodo's, not probed, not touched.`,
        }),
      );
      continue;
    }

    const subscriptionId = typeof rec.subscriptionId === "string" ? rec.subscriptionId : "";
    if (!subscriptionId) {
      state.findings.push(
        finding({
          phase: "orphans",
          kind: "orphan_review",
          customerId,
          verdict,
          from: rec.status ?? null,
          to: rec.status ?? null,
          note:
            `customer ${redactId(customerId)} (${redactEmail(rec.email)}): local status "${rec.status}" but ` +
            `the record holds no subscription id, so there is nothing to probe. Reported only.`,
        }),
      );
      continue;
    }

    const probe = await deps.dodo.getSubscription(subscriptionId);
    if (probe && probe.found) {
      // Present at Dodo but absent from the listing — a filtered or paged-past
      // row. Reported so a truncated listing can never masquerade as an orphan.
      state.findings.push(
        finding({
          phase: "orphans",
          kind: "listing_gap",
          customerId,
          subscriptionId,
          verdict,
          note:
            `customer ${redactId(customerId)}: subscription ${redactId(subscriptionId)} EXISTS at Dodo but did ` +
            `not appear in the swept listing. Not an orphan. Widen the sweep before trusting phase 1 as complete.`,
        }),
      );
      continue;
    }

    state.findings.push(
      finding({
        phase: "orphans",
        kind: verdict === "unprovable" ? "orphan_review_untagged" : "orphan_review",
        customerId,
        subscriptionId,
        verdict,
        from: rec.status ?? null,
        to: rec.status ?? null,
        note:
          verdict === "unprovable"
            ? `customer ${redactId(customerId)} (${redactEmail(rec.email)}): subscription ` +
              `${redactId(subscriptionId)} is UNKNOWN to Dodo, and this record carries NO provider tag. ` +
              `This is the exact shape of verifications#412 — a legacy Stripe-era row in a ` +
              `provider-agnostic key. NOTHING was revoked. Identify the provider by hand.`
            : `customer ${redactId(customerId)} (${redactEmail(rec.email)}): Dodo-tagged subscription ` +
              `${redactId(subscriptionId)} returns 404. A 404 is an absence of evidence, not a lifecycle ` +
              `outcome, so NOTHING was revoked. Confirm in the Dodo dashboard.`,
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// planSweep / applySweep
// ---------------------------------------------------------------------------

/**
 * Read everything, decide nothing irreversible.
 *
 * `planSweep` NEVER writes. It is not given a write path at all — `deps.store`
 * is only ever read from here, and `putSubscription` is reached exclusively
 * from `applySweep`. That separation is what makes the "a provider error
 * revokes nobody" guarantee structural rather than a promise: repairs are
 * applied FROM A PLAN, and a plan that hit an error is marked incomplete and
 * refused wholesale.
 *
 * @param {{
 *   dodo: {
 *     listSubscriptions: (p: {pageNumber:number,pageSize:number}) => Promise<{items:any[]}>,
 *     listPayments: (p: {pageNumber:number,pageSize:number}) => Promise<{items:any[]}>,
 *     getSubscription: (id: string) => Promise<{found:boolean,item?:any}>,
 *   },
 *   store: {
 *     getSubscription: (customerId: string) => Promise<any>,
 *     listSubscriptionCustomerIds?: () => Promise<string[]>,
 *   },
 * }} deps
 * @param {{ limits?: any, now?: string, monotonicNow?: () => number }} [opts]
 */
export async function planSweep(deps, opts = {}) {
  const limits = { ...SWEEP_LIMITS, ...(opts.limits ?? {}) };
  const now = opts.now ?? new Date().toISOString();
  const clock = typeof opts.monotonicNow === "function" ? opts.monotonicNow : () => Date.now();
  const startedAt = clock();

  /** @type {Map<string, any>} */
  const localCache = new Map();
  /** @type {Map<string, { rec: any, findings: Finding[] }>} */
  const pending = new Map();

  const state = {
    limits,
    now,
    /** @type {Finding[]} */ findings: [],
    /** @type {{phase:string,message:string}[]} */ errors: [],
    /** @type {Set<string>} */ matchedCustomers: new Set(),
    truncated: { subscriptions: false, payments: false, orphans: false },
    stats: { subscriptionsSeen: 0, paymentsSeen: 0, localRecords: 0 },
    pending,
    checkDeadline() {
      if (clock() - startedAt > limits.totalTimeoutMs) {
        throw new Error(`sweep exceeded totalTimeoutMs=${limits.totalTimeoutMs}`);
      }
    },
    /**
     * @param {string} customerId
     * @returns {Promise<any>}
     */
    async loadLocal(customerId) {
      const slot = pending.get(customerId);
      if (slot) return slot.rec;
      if (localCache.has(customerId)) return localCache.get(customerId);
      const rec = (await deps.store.getSubscription(customerId)) ?? null;
      localCache.set(customerId, rec);
      return rec;
    },
    /**
     * Stage a finding, and — when it actually changes something — the record it
     * would produce. Staging by customer is what keeps the write count to one
     * per customer no matter how many findings they attract.
     * @param {string} customerId
     * @param {Finding} f
     * @param {any} nextRec
     */
    stage(customerId, f, nextRec) {
      state.findings.push(f);
      if (!f.applicable) return;
      const slot = pending.get(customerId) ?? {
        // The record as it was BEFORE this run touched anything, kept so the
        // final write can be compared against it and skipped when the net
        // effect of several findings is nil.
        original: localCache.has(customerId) ? localCache.get(customerId) : null,
        rec: nextRec,
        findings: [],
      };
      slot.rec = nextRec;
      slot.findings.push(f);
      pending.set(customerId, slot);
    },
  };

  /** @type {[string, Function][]} */
  const phases = [
    ["subscriptions", planSubscriptions],
    ["payments", planPayments],
    ["orphans", planOrphans],
  ];
  for (const [phase, fn] of phases) {
    try {
      await fn(deps, state);
    } catch (err) {
      // NEVER RETHROWN, NEVER PARTIALLY TRUSTED. The error is recorded, the
      // phase stops where it stood, and `complete` goes false — which makes
      // applySweep refuse EVERY repair, including the ones planned before the
      // failure. A half-read provider is not a source of truth.
      state.errors.push({ phase, message: String(err && err.message ? err.message : err) });
    }
  }

  const truncated = Object.values(state.truncated).some(Boolean);
  const applicable = state.findings.filter((f) => f.applicable);
  // THE LAST IDEMPOTENCE GATE. Several findings can compose to a net no-op —
  // a flag set and cleared, a revoke the guard pinned back. Comparing the final
  // record against the one we read means a run can only write records that
  // genuinely differ from what is on disk, which is what makes "run it twice
  // and the second does nothing" true of the WRITES and not merely of the
  // statuses.
  const repairs = [...pending.entries()]
    .filter(([, slot]) => !sameRecord(slot.original, slot.rec))
    .map(([customerId, slot]) => ({ customerId, rec: slot.rec, findings: slot.findings }));

  return {
    /**
     * COMPLETE means: every page we asked for came back, no read threw, and no
     * cap cut the walk short. Truncation counts as incomplete because a capped
     * listing looks exactly like a shorter one, and we would rather do nothing
     * twice than something wrong once.
     */
    complete: state.errors.length === 0 && !truncated,
    errors: state.errors,
    truncated: state.truncated,
    findings: state.findings,
    applicable,
    repairs,
    stats: {
      ...state.stats,
      findings: state.findings.length,
      applicable: applicable.length,
      customersToRepair: repairs.length,
      entitlementLosses: applicable.filter((f) => f.entitlementLoss).length,
      reviews: state.findings.filter(
        (f) => String(f.kind).startsWith("review") || String(f.kind).startsWith("orphan"),
      ).length,
    },
    now,
    limits,
  };
}

/**
 * Apply a plan. DRY RUN IS THE DEFAULT AND IT TOUCHES NOTHING.
 *
 * `mode` must be the literal string "repair" to write. Not truthy, not
 * `!dryRun`, not a missing flag defaulting the dangerous way — an operator has
 * to type the word. Everything else, including a typo, is a dry run.
 *
 * @param {any} plan  the result of planSweep
 * @param {{ store: { putSubscription?: Function, putConnect?: Function } }} deps
 * @param {{ mode?: string, maxRepairs?: number, log?: Function }} [opts]
 */
export async function applySweep(plan, deps, opts = {}) {
  const mode = opts.mode === "repair" ? "repair" : "dry-run";
  const maxRepairs = opts.maxRepairs ?? plan?.limits?.maxRepairs ?? SWEEP_LIMITS.maxRepairs;
  const log = typeof opts.log === "function" ? opts.log : () => {};
  const result = {
    mode,
    wrote: 0,
    wouldWrite: 0,
    /** @type {string[]} */ refused: [],
    /** @type {any[]} */ applied: [],
  };

  if (!plan || !plan.complete) {
    result.refused.push(
      `INCOMPLETE SWEEP — ${plan?.errors?.length ?? 0} read error(s), truncated=` +
        `${JSON.stringify(plan?.truncated ?? {})}. NOTHING was written and NOBODY was revoked. A partial ` +
        `view of the provider is not a source of truth, so every repair in this plan is refused — not ` +
        `just the ones after the failure.`,
    );
    return result;
  }

  const repairs = plan.repairs ?? [];
  if (repairs.length > maxRepairs) {
    result.refused.push(
      `BLAST-RADIUS STOP — this run wants to change ${repairs.length} records, over the cap of ` +
        `${maxRepairs}. That many simultaneous disagreements is likelier to be a bad assumption in the ` +
        `sweep than that many real lifecycle events. NOTHING was written. Read the dry run, then raise ` +
        `the cap deliberately if it is genuinely correct.`,
    );
    return result;
  }

  for (const r of repairs) {
    result.wouldWrite++;
    if (mode !== "repair") {
      result.applied.push({ customerId: r.customerId, wrote: false, findings: r.findings.length });
      continue;
    }
    try {
      await deps.store.putSubscription(r.customerId, r.rec);
      // Mirror onto the connect record so the bot-facing view agrees with the
      // entitlement-facing one — the same guard applyDodoLifecycle uses: only
      // when the record actually carries a token to key it by.
      if (r.rec && r.rec.token && typeof deps.store.putConnect === "function") {
        await deps.store.putConnect(r.rec);
      }
      result.wrote++;
      result.applied.push({ customerId: r.customerId, wrote: true, findings: r.findings.length });
      log(`[reconcile] repaired ${redactId(r.customerId)} -> status "${r.rec?.status}"`);
    } catch (err) {
      // One store failure does not abort the rest: the records already written
      // are correct, and the ones not yet written are simply still wrong, which
      // is the state we started in. Re-running fixes them (idempotent).
      result.refused.push(
        `write failed for ${redactId(r.customerId)}: ${String(err && err.message ? err.message : err)}`,
      );
    }
  }
  return result;
}

/**
 * Plan then apply. The ONE entry point a caller should need.
 * @param {any} deps
 * @param {{ mode?: string, limits?: any, now?: string, log?: Function, monotonicNow?: () => number }} [opts]
 */
export async function runReconcile(deps, opts = {}) {
  const plan = await planSweep(deps, opts);
  const applied = await applySweep(plan, deps, { mode: opts.mode, log: opts.log });
  return { plan, applied };
}

/**
 * Human-readable report. Redacted by construction: it can only print what the
 * findings already redacted, because it never sees a raw record.
 * @param {any} plan
 * @param {any} applied
 * @returns {string}
 */
export function formatReport(plan, applied) {
  /** @type {string[]} */
  const lines = [];
  lines.push(`DODO RECONCILIATION SWEEP — ${plan.now}`);
  lines.push(`mode: ${applied?.mode ?? "dry-run"}   complete: ${plan.complete}`);
  // THE TRUNCATION BANNER. A capped walk sees a PREFIX of the truth and would
  // otherwise print exactly like a clean sweep of a smaller account. Whoever
  // reads this — or greps it — must not have to infer "incomplete" from a line
  // that is missing, so it is stated, first, in words.
  const cut = Object.entries(plan.truncated ?? {})
    .filter(([, v]) => v)
    .map(([k]) => k);
  if (cut.length) {
    lines.push(
      "",
      `!! TRUNCATED — the ${cut.join(" and ")} walk hit its page cap before reaching the end.`,
      "!! This run saw only PART of the provider's state. Nothing was written, and MORE REMAINS.",
      "!! Raise the relevant limit and re-run before treating this as a clean sweep.",
    );
  }
  lines.push(
    `seen: ${plan.stats.subscriptionsSeen} subscriptions, ${plan.stats.paymentsSeen} payments, ` +
      `${plan.stats.localRecords} local records`,
  );
  lines.push(
    `findings: ${plan.stats.findings} (applicable ${plan.stats.applicable}, ` +
      `entitlement losses ${plan.stats.entitlementLosses}, needing a human ${plan.stats.reviews})`,
  );
  if (plan.errors.length) {
    lines.push("", "ERRORS (these alone refuse the whole repair phase):");
    for (const e of plan.errors) lines.push(`  ! [${e.phase}] ${e.message}`);
  }
  /** @type {Map<string, number>} */
  const byKind = new Map();
  for (const f of plan.findings) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);
  if (byKind.size) {
    lines.push("", "BY KIND:");
    for (const [k, n] of [...byKind].sort()) lines.push(`  ${String(n).padStart(4)}  ${k}`);
  }
  const notable = plan.findings.filter(
    (f) => f.applicable || String(f.kind).startsWith("review") || String(f.kind).startsWith("orphan"),
  );
  if (notable.length) {
    lines.push("", "DETAIL:");
    for (const f of notable) {
      const tag = f.applicable ? (f.entitlementLoss ? "REVOKES" : "changes") : "REVIEW ";
      lines.push(`  [${tag}] ${f.phase}/${f.kind}${f.eventType ? ` (${f.eventType})` : ""}: ${f.note}`);
    }
  }
  lines.push("");
  if (applied?.mode === "repair") {
    lines.push(`WROTE ${applied.wrote} record(s).`);
  } else {
    lines.push(`DRY RUN — nothing was written. ${applied?.wouldWrite ?? 0} record(s) WOULD change.`);
  }
  for (const r of applied?.refused ?? []) lines.push(`  REFUSED: ${r}`);
  const code = exitCodeFor(plan, applied);
  lines.push(`VERDICT: ${EXIT_MEANING[code]} (exit ${code})`);
  return lines.join("\n");
}

/**
 * WHAT EACH EXIT CODE MEANS. Exported so a cron job, a log scraper and this
 * file's own report all read the SAME table rather than three drifting copies.
 */
export const EXIT_MEANING = Object.freeze({
  0: "clean — the provider and our records agree, and nothing needs a human",
  1: "FAILED — a read errored or the run could not proceed; nothing was written",
  2: "findings need a human — nothing is broken, but somebody must look",
  3: "INCOMPLETE — the run stopped short and MORE REMAINS; re-run after fixing the cause",
});

/**
 * The exit code for a finished run.
 *
 * THE FAILURE THIS EXISTS TO PREVENT is a run that left work undone and exited
 * 0 anyway. Two paths used to do exactly that: a walk truncated by a page cap,
 * and a repair phase refused wholesale by the blast-radius cap. Both are
 * "correct" in the sense that nothing wrong was written — and both look
 * identical, to a scheduler, to a sweep that found nothing to do. A green light
 * over undone work is worse than a red one over a real problem, because nobody
 * goes looking.
 *
 * Ordered most-severe first, so a run that is both broken AND incomplete
 * reports the thing that stops you acting on it.
 *
 * @param {any} plan
 * @param {any} applied
 * @returns {0|1|2|3}
 */
export function exitCodeFor(plan, applied) {
  if (!plan) return 1;
  // A read that threw. The provider was not fully readable, so no verdict here
  // is trustworthy — not even "nothing to do".
  if ((plan.errors?.length ?? 0) > 0) return 1;

  // Stopped short: a cap cut the walk, or the repair phase was refused as a
  // whole. Work remains either way, and the operator has to come back.
  const truncated = Object.values(plan.truncated ?? {}).some(Boolean);
  const refused = (applied?.refused?.length ?? 0) > 0;
  if (truncated || refused) return 3;

  // Nothing is wrong; something needs judgement. Reviews are the sweep's own
  // "I will not decide this" pile, and in dry-run mode a pending change is
  // precisely a decision waiting on a human.
  const pendingDryRun = applied?.mode !== "repair" && (applied?.wouldWrite ?? 0) > 0;
  if ((plan.stats?.reviews ?? 0) > 0 || pendingDryRun) return 2;

  return 0;
}
