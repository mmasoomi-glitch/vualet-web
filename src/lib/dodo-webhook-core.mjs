/**
 * DODO WEBHOOK CORE — pure, env-free verification + activation for Dodo events.
 *
 * Dodo follows the Standard Webhooks spec (docs.dodopayments.com/developer-resources/webhooks):
 *   headers:  webhook-id, webhook-timestamp, webhook-signature
 *   signed:   `${id}.${timestamp}.${rawBody}`
 *   sig:      base64(HMAC-SHA256(signedContent, secretBytes)), presented in the
 *             webhook-signature header as a space-separated list of `v1,<b64>`.
 *   secret:   Standard-Webhooks secrets are usually `whsec_<base64>`; the bytes
 *             used for HMAC are base64-decode(secret-without-whsec_-prefix).
 *
 * Kept pure (crypto injected) so scripts/dodo-webhook-test.mjs exercises the
 * EXACT verification + tier-activation code the route runs — mirrors
 * webhook-core.mjs. No env reads, no network.
 *
 * @typedef {import("./store").ConnectRecord} ConnectRecord
 */
import { PAID_PLANS } from "./plan-core.mjs";

/**
 * The LOWEST PAID tier — DERIVED, never spelled out here. plan-core.mjs is the
 * one place that defines the paid slugs and documents them as being "in
 * ascending tier order", so its first element is by definition the cheapest
 * paid tier. A literal "companion" in this file would quietly stop being the
 * lowest tier the day a cheaper plan is added, and the generous fallback below
 * would start OVER-granting without a single test changing colour.
 */
export const LOWEST_PAID_PLAN = PAID_PLANS[0];

/**
 * Decode a Standard-Webhooks secret to the raw HMAC key bytes.
 * @param {string} secret
 * @returns {Buffer}
 */
export function secretKeyBytes(BufferCtor, secret) {
  const b64 = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  return BufferCtor.from(b64, "base64");
}

/**
 * Constant-time-ish check that a computed base64 signature appears in the
 * space-separated `v1,<sig>` list from the webhook-signature header.
 * @param {string} header  raw webhook-signature header value
 * @param {string} expectedB64  our computed base64 signature
 * @param {(a: string, b: string) => boolean} safeEqual  timing-safe string compare
 * @returns {boolean}
 */
export function signatureMatches(header, expectedB64, safeEqual) {
  if (!header) return false;
  for (const part of header.split(" ")) {
    const comma = part.indexOf(",");
    const sig = comma === -1 ? part : part.slice(comma + 1);
    if (sig && safeEqual(sig, expectedB64)) return true;
  }
  return false;
}

/**
 * Verify a Standard-Webhooks delivery. All crypto injected.
 * @param {{ id: string, timestamp: string, signatureHeader: string, rawBody: string, secret: string }} d
 * @param {{
 *   createHmac: (alg: string, key: any) => any,
 *   Buffer: any,
 *   safeEqual: (a: string, b: string) => boolean,
 *   now?: number,
 *   toleranceSeconds?: number,
 * }} crypto
 * @returns {{ ok: boolean, reason?: string }}
 */
export function verifyDodoWebhook(d, crypto) {
  const { id, timestamp, signatureHeader, rawBody, secret } = d;
  const { createHmac, Buffer, safeEqual } = crypto;
  if (!id || !timestamp || !signatureHeader) return { ok: false, reason: "missing_headers" };
  if (!secret) return { ok: false, reason: "no_secret" };

  // Optional replay guard: reject timestamps outside tolerance (default 5 min).
  const tol = crypto.toleranceSeconds ?? 300;
  const now = crypto.now ?? Math.floor(Date.now() / 1000);
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > tol) {
    return { ok: false, reason: "timestamp_out_of_tolerance" };
  }

  const signed = `${id}.${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secretKeyBytes(Buffer, secret)).update(signed).digest("base64");
  return signatureMatches(signatureHeader, expected, safeEqual)
    ? { ok: true }
    : { ok: false, reason: "bad_signature" };
}

/**
 * The Dodo product id the customer ACTUALLY PAID FOR, read defensively from the
 * shapes Dodo's subscription and payment payloads are known to carry it in
 * (`product_id` on a subscription; `product_cart[]` on a payment). Returns
 * undefined when the event names no product at all — a real case, not an
 * error, handled by the ladder in resolveDodoPlan below.
 *
 * Deliberately tolerant about WHERE the id sits and strict about WHAT counts as
 * one: only a non-empty string. A number or an object here would otherwise be
 * handed to the resolver, compared against env strings, silently never match,
 * and drop the customer onto the fallback for a reason nobody could see.
 *
 * @param {any} payload  parsed Dodo event `data` object
 * @returns {string | undefined}
 */
export function productIdFromDodoPayload(payload) {
  const cart = Array.isArray(payload?.product_cart) ? payload.product_cart : null;
  const items = Array.isArray(payload?.items) ? payload.items : null;
  const candidates = [
    payload?.product_id,
    payload?.product?.product_id,
    payload?.subscription?.product_id,
    cart?.[0]?.product_id,
    items?.[0]?.product_id,
    items?.[0]?.product?.product_id,
    payload?.metadata?.product_id,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c) return c;
  }
  return undefined;
}

/**
 * Decide whether a Dodo webhook event is provably for a Mira product.
 *
 * Dodo fans every event on a merchant account out to EVERY configured
 * endpoint and signs each delivery with that endpoint's OWN secret - so a
 * valid signature proves the sender is Dodo, not that the event is ours.
 * This is the check that decides ownership.
 *
 * It fails closed on purpose: ownership must be positively proven through
 * the product-id allowlist; anything unproven (no resolver, no product id,
 * or a product id the allowlist does not know) is treated as not owned.
 *
 * The resolver is injected via `deps` rather than read from env so this
 * module stays pure and testable.
 *
 * @param {object} payload The parsed Dodo event `data` object.
 * @param {object} [deps] Injected collaborators.
 * @param {(id: string) => string | null | undefined} [deps.planForProductId]
 *   Resolves a Dodo product id to a Mira plan, or a falsy value when the
 *   product is not one of ours.
 * @returns {{ owned: boolean, productId: string | undefined, reason: string }}
 */
export function dodoEventIsMiraOwned(payload, deps = {}) {
  const resolver =
    deps && typeof deps.planForProductId === "function"
      ? deps.planForProductId
      : null;
  const productId = productIdFromDodoPayload(payload);
  if (!resolver) {
    return { owned: false, productId, reason: "no_resolver" };
  }
  if (productId === undefined) {
    return { owned: false, productId: undefined, reason: "no_product_id" };
  }
  let plan;
  try {
    plan = resolver(productId);
  } catch {
    // A throwing resolver must not become a webhook Dodo retries forever.
    plan = null;
  }
  if (plan) {
    return { owned: true, productId, reason: "owned" };
  }
  return { owned: false, productId, reason: "foreign_product" };
}

/**
 * Decide WHICH TIER a Dodo payment event grants (decisions#341 Q3 —
 * CALL_PLANFORPRODUCTID, with GRANT_LOWEST_AND_ALERT as the fallback).
 *
 * WHAT THIS REPLACES, and why it was dangerous. The tier used to be
 * `base?.plan ?? meta.plan ?? "companion"` — a chain whose LAST link was a
 * guess. An event carrying a customer id but no connect token (a renewal, a
 * payment made outside our checkout, a replayed event) matched no base and
 * carried no metadata, so the trailing "companion" MINTED AN ACTIVE COMPANION
 * SUBSCRIPTION out of nothing: a tier nobody necessarily bought, from a payment
 * whose product we never looked at. The Stripe path was explicitly hardened
 * against this exact shape ("do NOT fabricate an 'active companion' record from
 * a guess"); this path never received that hardening, and planForProductId()
 * — which exists precisely to answer "what did they pay for?" — was
 * never called from anywhere in the repo.
 *
 * THE LADDER, highest authority first:
 *   1. THE PRODUCT ACTUALLY PAID FOR. `deps.planForProductId` (dodo.ts, backed
 *      by DODO_PRODUCT_COMPANION / _ASSISTANT / _STUDIO) reverses the event's
 *      product id to a plan. Dodo is the merchant of record: the product it
 *      charged for is the fact, and it OUTRANKS both our own stored record and
 *      the metadata we sent, either of which can be stale. A disagreement is
 *      not silently swallowed — the product wins AND the mismatch alerts.
 *   2. THE PLAN THE SERVER ITSELF RECORDED (base.plan, then metadata.plan),
 *      used when the product cannot be resolved, or when the event names no
 *      product / no resolver is wired. This is what stops the ruling's
 *      "generous" fallback from becoming a DOWNGRADE: a studio customer whose
 *      product id is missing from the env mapping must not be dropped to the
 *      cheapest tier when we already hold, in our own store, the tier we sold
 *      them. The alert still fires, so the mapping still gets fixed.
 *   3. THE LOWEST PAID TIER + A LOUD ALERT, only when nothing above answered.
 *      Ruled by the judge: "refusing access would create a support crisis and
 *      chargeback risk. The fallback must be safe and generous, then fix the
 *      mapping urgently." So this never refuses and never throws (a throw here
 *      is a webhook Dodo retries into a paying, unactivated customer): it
 *      grants the CHEAPEST paid tier — the smallest thing that is still
 *      access — and screams. LOWEST_PAID_PLAN is derived, not typed out.
 *
 * `alert` is injected (defaulting to console.error) purely so the tests can
 * PROVE the alert fired rather than watch a console. There is no alerting
 * infrastructure to route it to; a clearly-marked console.error naming the
 * unresolved product id is what the ruling asked for.
 *
 * Env-free like the rest of this module: the resolver is a dependency, so the
 * test injects a fake mapping and the route injects dodo.ts's real, env-backed
 * planForProductId.
 *
 * @param {any} payload  parsed Dodo event `data` object
 * @param {ConnectRecord | null | undefined} base
 * @param {{ planForProductId?: (id: string) => string | null | undefined, alert?: (...a: any[]) => void }} [deps]
 * @returns {{ plan: string, source: string, productId?: string }}
 */
export function resolveDodoPlan(payload, base, deps = {}) {
  const meta = payload?.metadata ?? {};
  const alert = typeof deps.alert === "function" ? deps.alert : (...a) => console.error(...a);
  const resolver = typeof deps.planForProductId === "function" ? deps.planForProductId : null;
  const productId = productIdFromDodoPayload(payload);
  const declared = base?.plan ?? meta.plan ?? undefined;

  if (resolver && productId) {
    const fromProduct = resolver(productId);
    if (fromProduct) {
      if (declared && declared !== fromProduct) {
        alert(
          `[dodo-webhook] ALERT plan mismatch for product_id=${productId}: the product paid for maps ` +
            `to "${fromProduct}" but the recorded plan was "${declared}". ` +
            `Granting the product actually paid for.`,
        );
      }
      return { plan: fromProduct, source: "product", productId };
    }
    // planForProductId ALSO could not resolve it — the ruled fallback.
    const plan = declared ?? LOWEST_PAID_PLAN;
    alert(
      `[dodo-webhook] ALERT unresolved Dodo product_id=${productId} — it matches none of ` +
        `DODO_PRODUCT_COMPANION / DODO_PRODUCT_ASSISTANT / DODO_PRODUCT_STUDIO. Granting "${plan}" ` +
        `(${declared ? "the plan this server recorded" : "the LOWEST PAID tier"}) rather than ` +
        `refusing a paying customer, per decisions#341. FIX THE PRODUCT MAPPING URGENTLY.`,
    );
    return { plan, source: declared ? "fallback_declared" : "fallback_lowest_paid", productId };
  }

  if (declared) {
    return { plan: declared, source: base?.plan ? "base" : "metadata", productId };
  }

  // Nothing named a product (or no resolver is wired) AND we hold no plan for
  // this customer: the exact shape that used to fabricate an active companion.
  alert(
    `[dodo-webhook] ALERT no plan signal on this event (product_id=${productId ?? "none"}, ` +
      `resolver=${resolver ? "wired" : "NOT WIRED"}, no base plan, no metadata plan). Granting the ` +
      `LOWEST PAID tier "${LOWEST_PAID_PLAN}" rather than refusing a paying customer, per ` +
      `decisions#341. FIX THE PRODUCT MAPPING URGENTLY.`,
  );
  return { plan: LOWEST_PAID_PLAN, source: "fallback_lowest_paid", productId };
}

/**
 * THE DODO EVENT CATALOGUE — every event name VERIFIED against two independent
 * Dodo documentation sources AND the live account (ledger gotchas#261, #262).
 *
 * WHY THIS IS A LIST IN CODE AND NOT A COMMENT. The route used to route on
 * string literals typed at the call site, and one of them — `subscription.canceled`,
 * American spelling, one L — was never a Dodo event at all. It sat in the switch
 * looking exactly like coverage: a reviewer scanning the file saw cancellation
 * handled twice and moved on. Dead code that resembles a handler is worse than
 * no handler, because it costs you the search that would have found the gap. A
 * name that is not in this set cannot silently pretend to be an event.
 *
 * THE TRAP THIS ALSO CLOSES. Dodo has NO `invoice.paid` and NO
 * `invoice.payment_failed`. Those are STRIPE names, and this repo runs both
 * providers side by side, so reaching for the familiar one is the natural
 * mistake — it would produce a handler that compiles, tests green against a
 * fixture someone typed by hand, and never fires in production, because Dodo
 * will never send that string. STRIPE_ONLY_EVENT_NAMES below exists so a test
 * can assert those names appear NOWHERE in our Dodo routing.
 *
 * Coverage note, stated honestly: these 26 names are the payment, refund,
 * dispute, subscription and dunning families — the money path. The full Dodo
 * catalogue is larger (licence keys and similar), and those remaining types
 * still arrive here and are still answered `received: true` by the default
 * branch, which is the correct treatment for an event we have no business
 * acting on.
 */
export const DODO_EVENTS = Object.freeze({
  payment: Object.freeze([
    "payment.succeeded",
    "payment.failed",
    "payment.processing",
    "payment.cancelled",
  ]),
  refund: Object.freeze(["refund.succeeded", "refund.failed"]),
  dispute: Object.freeze([
    "dispute.opened",
    "dispute.challenged",
    "dispute.accepted",
    "dispute.cancelled",
    "dispute.expired",
    "dispute.won",
    "dispute.lost",
  ]),
  subscription: Object.freeze([
    "subscription.active",
    "subscription.updated",
    "subscription.on_hold",
    "subscription.paused",
    "subscription.unpaused",
    "subscription.renewed",
    "subscription.plan_changed",
    "subscription.update_payment_method",
    "subscription.cancelled",
    "subscription.failed",
    "subscription.expired",
  ]),
  dunning: Object.freeze(["dunning.started", "dunning.recovered"]),
});

/** Flat set of every verified Dodo event name above. */
export const KNOWN_DODO_EVENTS = Object.freeze(
  new Set(Object.values(DODO_EVENTS).flat()),
);

/**
 * Names that LOOK like they belong here and do not. Kept as data so a test can
 * prove none of them ever creeps into the effect table or the route switch.
 * `subscription.canceled` is the one that already had: American spelling, one
 * L, dead in the switch at webhooks/dodo/route.ts since the route was written.
 */
export const STRIPE_ONLY_EVENT_NAMES = Object.freeze([
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_succeeded",
  "customer.subscription.deleted",
  "customer.subscription.updated",
  "charge.refunded",
  "charge.dispute.created",
  "subscription.canceled",
]);

/**
 * THE RULING, AS DATA (decisions#341 Q1 + decisions#342).
 *
 * Every Dodo event we act on maps to exactly one effect. The point of a table
 * rather than a switch full of bodies is that the POLICY becomes assertable on
 * its own: a test can ask "what does dispute.opened do?" and get an answer
 * without a store, a payload, or a network, and a reviewer can read the whole
 * revocation policy on one screen instead of reconstructing it from ten
 * handlers.
 *
 * THE ONE IDEA BEHIND EVERY ROW: revoke on a FINAL OUTCOME, never on a
 * proceeding. The judge, verbatim: "A dispute opened is not final; many
 * merchants win. Revoking on dispute.opened punishes a customer who may be
 * entirely in the right. Revoke only on dispute lost."
 *
 * Kinds:
 *   "activate"  handled by activateDodo, not here (listed anyway so this table
 *               is a COMPLETE statement of policy rather than a partial one).
 *   "reprice"   re-resolve the TIER from the product actually paid for. Never
 *               touches status: a plan change is not an entitlement change.
 *   "revoke"    write a terminal, access-removing status. Final outcomes only.
 *   "flag"      record something for operators. Access is UNAFFECTED.
 *   "restore"   lift a specific earlier revocation and return to "active" —
 *               and ONLY from the statuses named in `from`. See applyDodoOutcome.
 *   "log"       a real event we deliberately do nothing about.
 */
export const DODO_EVENT_EFFECTS = Object.freeze({
  // ── Activation (executed by activateDodo in the route) ───────────────────
  "subscription.active": Object.freeze({ kind: "activate" }),
  "subscription.renewed": Object.freeze({ kind: "activate" }),
  "payment.succeeded": Object.freeze({ kind: "activate" }),

  // ── Tier changes: the product paid for decides, status is untouched ──────
  "subscription.plan_changed": Object.freeze({ kind: "reprice" }),
  "subscription.updated": Object.freeze({ kind: "reprice" }),

  // ── Final outcomes that REVOKE ───────────────────────────────────────────
  // A refund is final and the money is back with the customer.
  "refund.succeeded": Object.freeze({
    kind: "revoke",
    status: "refunded",
    why: "the payment was refunded and the money is back with the customer",
  }),
  // Money clawed back by the card network. Visa RDR auto-refunds arrive here
  // too, as dispute.lost with is_resolved_by_rdr:true — the same money
  // movement, so the same treatment, and no separate branch to forget.
  "dispute.lost": Object.freeze({
    kind: "revoke",
    status: "chargeback",
    dispute: "lost",
    why: "the dispute was decided against us and the funds were clawed back",
  }),
  "dispute.accepted": Object.freeze({
    kind: "revoke",
    status: "chargeback",
    dispute: "accepted",
    why: "we accepted the dispute, so the funds went back to the cardholder",
  }),
  "dispute.expired": Object.freeze({
    kind: "revoke",
    status: "chargeback",
    dispute: "expired",
    why: "the response window closed without a challenge, which forfeits the funds",
  }),
  // Dunning EXHAUSTED. This — not a single failed charge — is the lapse signal.
  "subscription.on_hold": Object.freeze({
    kind: "revoke",
    status: "on_hold",
    why: "Dodo has stopped retrying the charge; this is the real lapse, not one decline",
  }),
  "subscription.paused": Object.freeze({
    kind: "revoke",
    status: "paused",
    why: "the subscription is paused; subscription.unpaused restores it",
  }),
  "subscription.cancelled": Object.freeze({ kind: "revoke", status: "cancelled", why: "the subscription ended" }),
  "subscription.expired": Object.freeze({ kind: "revoke", status: "cancelled", why: "the subscription expired" }),
  "subscription.failed": Object.freeze({ kind: "revoke", status: "cancelled", why: "the subscription failed to start" }),

  // ── NOT final: flag it, change nothing the customer can feel ─────────────
  "dispute.opened": Object.freeze({
    kind: "flag",
    disputed: true,
    dispute: "opened",
    why: "a dispute is open. The outcome is NOT decided and many merchants win, so access stands",
  }),
  "dispute.challenged": Object.freeze({
    kind: "flag",
    disputed: true,
    dispute: "challenged",
    why: "we are contesting the dispute. Still not an outcome, so access stands",
  }),
  // One decline is a bank event, not a decision to leave. Dodo will retry.
  "payment.failed": Object.freeze({
    kind: "flag",
    pastDue: true,
    why: "a charge failed and will be retried. Revoking on attempt one punishes the customer for their bank",
  }),
  "dunning.started": Object.freeze({
    kind: "flag",
    pastDue: true,
    why: "retries have begun. Access stands until dunning is exhausted (subscription.on_hold)",
  }),

  // ── Reversals: clear the flag and undo a revocation we should not hold ───
  // A dispute we WON must not leave a revoked customer. It normally cannot,
  // because dispute.opened never revoked — but webhook delivery is not ordered,
  // so a late dispute.won after a dispute.lost has to be able to put it right.
  "dispute.won": Object.freeze({
    kind: "restore",
    disputed: false,
    dispute: "won",
    from: Object.freeze(["chargeback"]),
    why: "we won; the funds stayed with us, so the customer keeps what they paid for",
  }),
  "dispute.cancelled": Object.freeze({
    kind: "restore",
    disputed: false,
    dispute: "cancelled",
    from: Object.freeze(["chargeback"]),
    why: "the dispute was withdrawn; there was never an adverse outcome",
  }),
  "subscription.unpaused": Object.freeze({
    kind: "restore",
    from: Object.freeze(["paused"]),
    why: "the pause is over",
  }),
  "dunning.recovered": Object.freeze({
    kind: "restore",
    pastDue: false,
    from: Object.freeze(["on_hold"]),
    why: "a retry succeeded, so a lapsed subscription comes back and the past-due flag clears",
  }),

  // ── Real events we deliberately do nothing about ─────────────────────────
  "payment.processing": Object.freeze({ kind: "log", why: "money has not moved yet" }),
  "payment.cancelled": Object.freeze({ kind: "log", why: "an abandoned attempt; nothing was ever granted" }),
  "refund.failed": Object.freeze({ kind: "log", why: "a refund that did NOT happen must not revoke anything" }),
  "subscription.update_payment_method": Object.freeze({ kind: "log", why: "a card change is not an entitlement change" }),
});

/**
 * The effect for an event type, or null when we do not act on it.
 * @param {string} type
 * @returns {any|null}
 */
export function dodoEventEffect(type) {
  if (typeof type !== "string" || !type) return null;
  return Object.prototype.hasOwnProperty.call(DODO_EVENT_EFFECTS, type)
    ? /** @type {any} */ (DODO_EVENT_EFFECTS)[type]
    : null;
}

/**
 * Every id a Dodo event might name, read defensively across payload shapes.
 *
 * THE SHAPE THAT MAKES THIS NECESSARY (gotchas#262): a dispute payload carries
 * `dispute_id`, `payment_id` and `amount` and NOTHING ELSE that identifies a
 * human — no subscription id, no customer id. So a dispute handler that reads
 * `payload.customer.customer_id` finds undefined every single time and does
 * nothing, silently, forever. The customer id has to be fetched via the
 * payment (see resolvePaymentIdentity in the route).
 *
 * @param {any} payload
 * @returns {{ customerId?: string, subscriptionId?: string, paymentId?: string, disputeId?: string, refundId?: string }}
 */
export function identityFromDodoPayload(payload) {
  const str = (v) => (typeof v === "string" && v ? v : undefined);
  return {
    customerId: str(payload?.customer?.customer_id) ?? str(payload?.customer_id),
    subscriptionId: str(payload?.subscription_id) ?? str(payload?.subscription?.subscription_id),
    paymentId: str(payload?.payment_id) ?? str(payload?.payment?.payment_id),
    disputeId: str(payload?.dispute_id) ?? str(payload?.dispute?.dispute_id),
    refundId: str(payload?.refund_id) ?? str(payload?.refund?.refund_id),
  };
}

/**
 * Billing-period fields, when the event carries them (decisions#342 Q_C).
 *
 * HONEST LIMIT, STATED RATHER THAN HIDDEN. `cancel_at_next_billing_date` is a
 * VERIFIED Dodo field — it is the exact body key cancelDodoSubscription sends
 * (src/lib/dodo.ts:279). The period-end key is NOT verified from a live
 * payload; `next_billing_date` is the documented name and the rest are
 * tolerated spellings. That is why this reads a candidate list, and why it
 * returns NOTHING when it recognises nothing: a wrong-but-present date here
 * either confiscates days the customer paid for or hands out days they did
 * not, so absence is the only safe answer to "I do not recognise this field".
 *
 * Strict about types on purpose. `cancelAtPeriodEnd` is only ever set from a
 * real boolean — a truthy string like "false" must never become `true`.
 *
 * @param {any} payload
 * @returns {{ cancelAtPeriodEnd?: boolean, currentPeriodEnd?: string }}
 */
export function periodFieldsFromDodo(payload) {
  /** @type {{ cancelAtPeriodEnd?: boolean, currentPeriodEnd?: string }} */
  const out = {};
  const flag = payload?.cancel_at_next_billing_date ?? payload?.cancel_at_period_end;
  if (typeof flag === "boolean") out.cancelAtPeriodEnd = flag;

  for (const c of [
    payload?.next_billing_date,
    payload?.current_period_end,
    payload?.subscription_period_end,
    payload?.expires_at,
  ]) {
    if (typeof c === "string" && c) {
      out.currentPeriodEnd = c;
      break;
    }
    // Providers sometimes send unix seconds. Only accept a plausible one.
    if (typeof c === "number" && Number.isFinite(c) && c > 0) {
      out.currentPeriodEnd = new Date(c * 1000).toISOString();
      break;
    }
  }
  return out;
}

/**
 * When the free trial ends, derived from the event (judge condition, writer L
 * handoff). VERIFIED: the live Dodo subscription object carries
 * `trial_period_days: 14`, and all three products are configured
 * `trial_type: "free"`.
 *
 * THE TRAP THIS IS SHAPED AROUND. `trial_period_days` describes the PLAN, not
 * the customer's position in it, so it is present on renewal events too.
 * Computing `now + 14 days` on every activation would therefore re-issue a
 * fresh trial label to a paying customer every single month — the account page
 * would cheerfully tell someone in month nine that their free trial is active.
 * Two things prevent that:
 *
 *   1. AN EXISTING VALUE ALWAYS WINS. The trial end is set once, at the first
 *      activation, and is never recomputed.
 *   2. THE CLOCK STARTS AT THE SUBSCRIPTION, NOT AT THIS EVENT. When there is
 *      no stored value, the window is measured from `base.createdAt` — the
 *      original signup — so a renewal that somehow reaches this path lands on a
 *      date in the PAST, which reads as "not trialing" rather than as a new
 *      trial. `now` is used only when we have never seen this customer before,
 *      which is exactly the case where now IS the subscription start.
 *
 * Returns {} rather than a guess whenever the event says nothing usable: an
 * invented trial date either promises free time we are about to charge for, or
 * denies free time we advertised.
 *
 * @param {any} payload
 * @param {any} base  the existing record, if any
 * @param {string} now  ISO timestamp
 * @returns {{ trialEndsAt?: string }}
 */
export function trialFieldsFromDodo(payload, base, now) {
  // 1. Already recorded — never moves.
  if (typeof base?.trialEndsAt === "string" && base.trialEndsAt) {
    return { trialEndsAt: base.trialEndsAt };
  }
  // 2. An explicit end date from the provider always beats one we compute.
  for (const c of [payload?.trial_end, payload?.trial_ends_at, payload?.trial_end_date]) {
    if (typeof c === "string" && c) return { trialEndsAt: c };
    if (typeof c === "number" && Number.isFinite(c) && c > 0) {
      return { trialEndsAt: new Date(c * 1000).toISOString() };
    }
  }
  // 3. Compute from the verified trial_period_days, anchored to the signup.
  const days = payload?.trial_period_days;
  if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) return {};
  const start = Date.parse(base?.createdAt ?? payload?.created_at ?? now);
  if (!Number.isFinite(start)) return {};
  return { trialEndsAt: new Date(start + days * 86400000).toISOString() };
}

/**
 * Apply one effect to a record. PURE — no I/O, no clock of its own.
 *
 * PRESERVE FIRST, OVERRIDE SECOND, for the same reason activationRecordFromDodo
 * does it (gotchas#257): a record grows fields on a different schedule from any
 * list written here, so preservation has to be structural. A dispute handler
 * that rebuilt the record from the fields it cared about would delete `phone`,
 * `channel` and `consent` exactly the way activation once did.
 *
 * THE RESTORE GUARD IS THE DANGEROUS PART, so it is the narrow part. "restore"
 * does not mean "set active" — it means "lift THIS revocation and only this
 * one", which is why every restore row carries an explicit `from` list.
 * Without it, a dunning.recovered arriving after a refund would hand a refunded
 * customer their subscription back, and a subscription.unpaused after a
 * chargeback would do the same. A restore that cannot lift the status it finds
 * leaves the status alone and says so in the returned note; it never promotes a
 * record it does not understand.
 *
 * @param {any} rec  the stored record (NOT mutated)
 * @param {any} effect  a row from DODO_EVENT_EFFECTS
 * @param {{ now?: string, plan?: string, period?: { cancelAtPeriodEnd?: boolean, currentPeriodEnd?: string } }} [ctx]
 * @returns {{ rec: any, changed: boolean, action: string, note: string }}
 */
export function applyDodoOutcome(rec, effect, ctx = {}) {
  const now = ctx.now ?? new Date().toISOString();
  const before = rec ?? {};
  const next = { ...before };
  const period = ctx.period ?? {};
  let changed = false;
  let action = effect?.kind ?? "log";
  let note = "";

  // Period fields ride along on ANY lifecycle event that carries them: the
  // event that tells us billing stops at period end is not always the event we
  // are acting on for entitlement.
  if (period.cancelAtPeriodEnd !== undefined && next.cancelAtPeriodEnd !== period.cancelAtPeriodEnd) {
    next.cancelAtPeriodEnd = period.cancelAtPeriodEnd;
    changed = true;
  }
  if (period.currentPeriodEnd !== undefined && next.currentPeriodEnd !== period.currentPeriodEnd) {
    next.currentPeriodEnd = period.currentPeriodEnd;
    changed = true;
  }

  // Dispute / dunning bookkeeping, common to flag, revoke and restore rows.
  if (effect?.dispute !== undefined && next.disputeStatus !== effect.dispute) {
    next.disputeStatus = effect.dispute;
    changed = true;
  }
  if (effect?.disputed !== undefined && next.disputed !== effect.disputed) {
    next.disputed = effect.disputed;
    changed = true;
  }
  if (effect?.pastDue !== undefined && next.pastDue !== effect.pastDue) {
    next.pastDue = effect.pastDue;
    if (effect.pastDue) {
      // Keep the FIRST failure time across a run of retries. Overwriting it on
      // every retry would erase how long this has actually been going on,
      // which is the only thing that makes the flag useful to an operator.
      if (!next.pastDueSince) next.pastDueSince = now;
    } else {
      next.pastDueSince = undefined;
    }
    changed = true;
  }

  switch (effect?.kind) {
    case "revoke": {
      // A dispute that is LOST / ACCEPTED / EXPIRED is still a dispute we now
      // hold an outcome for, so mark it disputed even though the row's headline
      // effect is the revocation.
      if (effect.dispute && next.disputed !== true) {
        next.disputed = true;
        changed = true;
      }
      if (next.status !== effect.status) {
        note = `status ${before.status ?? "none"} -> ${effect.status}: ${effect.why}`;
        next.status = effect.status;
        changed = true;
      } else {
        // IDEMPOTENCY. A redelivered refund.succeeded lands here and is a
        // no-op, not a second revocation of an already-revoked record.
        note = `already ${effect.status}; no status change (replay-safe)`;
      }
      break;
    }
    case "flag": {
      note = changed
        ? `flagged WITHOUT touching access (status stays "${next.status ?? "none"}"): ${effect.why}`
        : "already flagged; no change (replay-safe)";
      break;
    }
    case "restore": {
      const from = effect.from ?? [];
      if (before.status === "active") {
        note = `already active; flags updated only: ${effect.why}`;
      } else if (from.includes(before.status)) {
        note = `status ${before.status} -> active: ${effect.why}`;
        next.status = "active";
        changed = true;
        action = "restore";
      } else {
        // The narrow part. We will not promote a record whose current status
        // this event has no authority over.
        action = "restore_refused";
        note =
          `REFUSED to restore access from status "${before.status ?? "none"}" — this event may only ` +
          `lift ${JSON.stringify(from)}. Flags were updated; entitlement was NOT.`;
      }
      break;
    }
    case "reprice": {
      if (ctx.plan && ctx.plan !== next.plan) {
        note = `plan ${before.plan ?? "none"} -> ${ctx.plan} (from the product actually paid for)`;
        next.plan = ctx.plan;
        changed = true;
      } else {
        note = `plan unchanged (${next.plan ?? "none"})`;
      }
      break;
    }
    default: {
      note = effect?.why ?? "no action";
      break;
    }
  }

  return { rec: next, changed, action, note };
}

/**
 * Handle a NON-ACTIVATION Dodo lifecycle event end to end. All I/O injected.
 *
 * NEVER THROWS, AND THAT IS A DELIBERATE, LOAD-BEARING CHOICE. A webhook that
 * throws is a webhook Dodo RETRIES — into a paying customer — so an exception
 * on a dispute event does not become an alert, it becomes an endless
 * redelivery loop against someone who is already having a bad week. Everything
 * is caught, everything is reported in the return value, and the route answers
 * `received: true` regardless. The same reasoning is already written into
 * droppedFields and resolveDodoPlan above.
 *
 * THE PAYMENT-ID HOP (gotchas#262). A dispute payload names no customer, only
 * `payment_id`. `resolvePaymentIdentity` is the injected
 * `GET /payments/{payment_id}` that turns one into the other; it lives in the
 * route because it needs the network and an API key, and this module stays
 * env-free. It is called ONLY when the payload itself named no customer, so an
 * event that already identifies the customer costs no API call.
 *
 * REFUND PAYLOADS ARE UNVERIFIED, AND ARE TREATED THAT WAY. The Dodo refund
 * intent doc is an empty stub and the live /refunds list is empty, so no sample
 * exists. Rather than guess at a customer-identifying field, refunds go through
 * the SAME payment_id hop, which IS verified. If a refund arrives naming
 * neither a customer nor a payment, the result is a LOUD alert and NO state
 * change — a wrong revocation is a locked-out paying customer, and the honest
 * failure is by far the cheaper of the two.
 *
 * @param {any} payload  parsed Dodo event `data`
 * @param {string} type  the Dodo event type
 * @param {{
 *   getSubscription: (c: string) => Promise<any>,
 *   putSubscription: (c: string, r: any) => Promise<void>,
 *   putConnect?: (r: any) => Promise<void>,
 *   resolvePaymentIdentity?: (paymentId: string) => Promise<{ customerId?: string, subscriptionId?: string } | null>,
 *   planForProductId?: (id: string) => string | null | undefined,
 *   now?: string,
 *   alert?: (...a: any[]) => void,
 *   log?: (...a: any[]) => void,
 * }} deps
 * @returns {Promise<{ ok: boolean, action: string, note: string, customerId?: string, changed?: boolean }>}
 */
export async function applyDodoLifecycle(payload, type, deps) {
  const alert = typeof deps?.alert === "function" ? deps.alert : (...a) => console.error(...a);
  const log = typeof deps?.log === "function" ? deps.log : (...a) => console.log(...a);
  try {
    const effect = dodoEventEffect(type);
    if (!effect) return { ok: true, action: "ignored", note: `no effect table entry for ${type}` };
    if (effect.kind === "activate") {
      return { ok: true, action: "activate", note: "handled by activateDodo, not here" };
    }
    if (effect.kind === "log") {
      log(`[dodo-webhook] ${type} — deliberately no state change: ${effect.why}`);
      return { ok: true, action: "log", note: effect.why };
    }

    const ids = identityFromDodoPayload(payload);
    let customerId = ids.customerId;

    // The payment hop, taken only when the event did not identify anyone.
    if (!customerId && ids.paymentId && typeof deps?.resolvePaymentIdentity === "function") {
      const found = await deps.resolvePaymentIdentity(ids.paymentId);
      if (found?.customerId) customerId = found.customerId;
    }

    if (!customerId) {
      alert(
        `[dodo-webhook] ALERT ${type} names no customer and could not be resolved ` +
          `(payment_id=${ids.paymentId ?? "none"}, dispute_id=${ids.disputeId ?? "none"}, ` +
          `refund_id=${ids.refundId ?? "none"}, subscription_id=${ids.subscriptionId ?? "none"}). ` +
          `NO record was changed and NO access was revoked — a wrong revocation locks out a paying ` +
          `customer, so an unresolvable event fails loudly instead of guessing. INVESTIGATE MANUALLY.`,
      );
      return { ok: false, action: "unresolved_customer", note: "no customer id; nothing changed" };
    }

    const rec = await deps.getSubscription(customerId);
    if (!rec) {
      alert(
        `[dodo-webhook] ALERT ${type} resolved to customer ${customerId} but there is NO local ` +
          `subscription record to update, so nothing changed. If this customer should have one, ` +
          `either the activation webhook never landed or the record predates the Dodo migration.`,
      );
      return { ok: false, action: "no_record", note: "no local record", customerId };
    }

    /** @type {any} */
    const ctx = { now: deps?.now, period: periodFieldsFromDodo(payload) };
    if (effect.kind === "reprice") {
      // The product actually paid for decides the tier — writer J's ladder,
      // REUSED rather than re-implemented, so a plan change resolves in exactly
      // the same way an activation does and there is no second tier rule to
      // drift out of step with the first.
      ctx.plan = resolveDodoPlan(payload, rec, { planForProductId: deps?.planForProductId, alert }).plan;
    }

    const outcome = applyDodoOutcome(rec, effect, ctx);
    if (!outcome.changed) {
      log(`[dodo-webhook] ${type} for ${customerId}: ${outcome.note}`);
      return { ok: true, action: outcome.action, note: outcome.note, customerId, changed: false };
    }

    await deps.putSubscription(customerId, outcome.rec);
    // Mirror onto the connect record so the bot-facing view agrees with the
    // entitlement-facing one. Same guard cancelFromDodo used: only when the
    // record actually carries a token to key it by.
    if (outcome.rec.token && typeof deps?.putConnect === "function") {
      await deps.putConnect(outcome.rec);
    }
    log(`[dodo-webhook] ${type} for ${customerId}: ${outcome.note}`);
    return { ok: true, action: outcome.action, note: outcome.note, customerId, changed: true };
  } catch (err) {
    alert(`[dodo-webhook] ALERT ${type} handler failed; nothing was changed and no retry is requested:`, err);
    return { ok: false, action: "error", note: String(err && err.message ? err.message : err) };
  }
}

/**
 * Build an ACTIVATED connect/subscription record from a Dodo subscription-active
 * (or payment-succeeded) event payload. The tier is decided by resolveDodoPlan
 * above — FROM THE PRODUCT ACTUALLY PAID FOR when a resolver is injected,
 * never from a trailing guess. NEVER gates on amount: a $0 / 100%-off order
 * activates like a paid one.
 *
 * @param {any} payload  parsed Dodo event `data` object
 * @param {ConnectRecord | null | undefined} base  existing connect record, if any
 * @param {string} now  ISO timestamp for createdAt when there is no base
 * @param {{ planForProductId?: (id: string) => string | null | undefined, alert?: (...a: any[]) => void }} [deps]
 * @returns {ConnectRecord}
 */
export function activationRecordFromDodo(payload, base, now, deps = {}) {
  const meta = payload?.metadata ?? {};
  const token = meta.connect_token || undefined;
  const customerId = payload?.customer?.customer_id ?? payload?.customer_id ?? undefined;
  const subscriptionId = payload?.subscription_id ?? undefined;
  return /** @type {ConnectRecord} */ ({
    // PRESERVE FIRST, OVERRIDE SECOND (gotchas#257). This used to re-list the
    // fields worth keeping — plan, email, telegramId, persona, role,
    // assistantName, createdAt — and so silently DELETED every field added to
    // the record after that list was written. `phone`, `channel` and `consent`
    // are collected at checkout for decisions#340 (WhatsApp-first), so the
    // record was bindable right up until the customer paid and unbindable the
    // moment they did — and nothing failed, because the write succeeded and the
    // fields merely ceased to exist.
    //
    // The spread is not shorthand for the old list; it is the only shape that
    // CAN be correct here, and `consent` is the proof. It was persisted for a
    // while WITHOUT being a field of ConnectRecord at all — /api/checkout added
    // it by intersection (BoundConnectRecord) because that writer did not own
    // store.ts, and putConnect JSON-serialises the whole object regardless — so
    // during that window no list written against the type could have named it.
    // It has since been promoted onto ConnectRecord (store.ts), which changes
    // nothing about the lesson: a record grows fields on a different schedule
    // from the type and from any list written here, so preservation has to be
    // structural rather than enumerated. This is the same reasoning writer A
    // applied to its anti-drift guard — a hardcoded list is the same defect
    // with a longer list.
    //
    // This is safe, and it is not the "allow-list as a filter" pattern being
    // discarded carelessly: `base` is OUR OWN record, read from OUR store by a
    // token that arrived inside a signature-verified payload, and written by
    // /api/checkout field-by-field from validated input — the request body is
    // never spread into it, so it cannot carry an attacker-chosen key. What a
    // stale base must NOT be allowed to decide is the payment outcome, and it
    // cannot: every payment-authoritative field is assigned BELOW the spread,
    // so an old "cancelled" status or a superseded customer id can never win.
    ...(base ?? {}),

    // ── Payment-authoritative from here down; the base never overrides these.
    // `base?.token` is consulted BEFORE the ids: on a renewal the payload may
    // not echo metadata, and falling straight through to subscriptionId would
    // REWRITE the record's token to the subscription id — orphaning it from the
    // connect record the customer binds through. Matches refreshFromInvoice
    // (webhooks/stripe/route.ts:121).
    token: token ?? base?.token ?? subscriptionId ?? customerId ?? "unknown",
    // TIER: from the PRODUCT ACTUALLY PAID FOR (resolveDodoPlan above). The old
    // `base?.plan ?? meta.plan ?? "companion"` ended in a guess, so a payment
    // event with no token and no metadata minted an active companion tier
    // nobody bought. Assigned BELOW the spread like every other
    // payment-authoritative field, so a stale base cannot reinstate an old tier.
    plan: resolveDodoPlan(payload, base, deps).plan,
    email: base?.email ?? payload?.customer?.email ?? undefined,
    status: "active",
    // WHICH PROCESSOR OWNS THIS ROW (verifications#412). The Stripe webhook and
    // this one write the SAME `mira:sub:<customerId>` key space with nothing to
    // tell them apart, which is how a legacy Stripe-era row came to be probed
    // against the Dodo API, found unknown there, and misdiagnosed as an orphan.
    // The row was fine; the reader had no way to know whose it was. Written on
    // every activation from here on. Deliberately NOT backfilled onto existing
    // rows: a backfill would have to GUESS the provider of exactly the records
    // whose provider is unknowable, which is the original bug with more
    // confidence behind it. Absent therefore means "written before we tagged",
    // never "Stripe".
    provider: "dodo",
    // Billing period, when the event carries it (decisions#342 Q_C). Spread
    // LAST of the payload-derived fields and only ever containing keys the
    // payload actually named, so an event that mentions no period leaves a
    // previously-recorded one alone instead of erasing it with undefined.
    ...periodFieldsFromDodo(payload),
    // The free-trial phase, so a Dodo customer inside their advertised 14 days
    // can finally be TOLD they are (writer L handoff). Note what this does NOT
    // do: `status` above stays "active", because that string is the entitlement
    // gate and a "trialing" status there would lock every trialing customer out.
    ...trialFieldsFromDodo(payload, base, now),
    // The payment event is the authority on payment identity and ALWAYS wins
    // when it names one; the base only fills an ABSENCE. Assigning these bare
    // would overwrite a real held id with `undefined` whenever an event omits
    // it — the same silent structural loss this whole fix exists to prevent,
    // and it would leave droppedFields() below as an invariant with a
    // documented exception instead of a universal one. No misattribution is
    // possible: the base cannot contradict a payment that names a customer,
    // only supply one the payment left out. Adopted from writer I's
    // webhook-core.mjs so the two cores stay the same shape; the norm was
    // already set by refreshFromInvoice (webhooks/stripe/route.ts:124-125).
    customerId: customerId ?? base?.customerId,
    subscriptionId: subscriptionId ?? base?.subscriptionId,
    createdAt: base?.createdAt ?? now,
  });
}

/**
 * Which keys of `base` failed to survive into `rec`? The invariant activation
 * must hold (gotchas#257) is that this is always empty: activation may CHANGE
 * a field's value, but must never make a field cease to exist.
 *
 * Exported as a pure check rather than wired in as an inline throw ON PURPOSE.
 * This code sits on the money path, and a webhook that throws is a webhook Dodo
 * retries into a customer who has paid and never been activated — turning a
 * dropped field into a failed purchase. So the guard fails LOUDLY where loud is
 * free (scripts/dodo-webhook-test.mjs asserts it on every activation shape) and
 * stays out of the way where a false alarm would cost a sale.
 *
 * @param {Record<string, any> | null | undefined} base
 * @param {Record<string, any> | null | undefined} rec
 * @returns {string[]} keys present on base that are missing from rec
 */
export function droppedFields(base, rec) {
  if (!base || typeof base !== "object") return [];
  return Object.keys(base).filter(
    (k) => base[k] !== undefined && (rec == null || rec[k] === undefined),
  );
}

/**
 * Activate from a Dodo event: read any base connect record (by metadata token),
 * build the active record, write it to connect + subscription stores. I/O injected.
 * @param {any} payload
 * @param {{
 *   getConnect: (t: string) => Promise<ConnectRecord | null>,
 *   putConnect: (r: ConnectRecord) => Promise<void>,
 *   putSubscription: (c: string, r: ConnectRecord) => Promise<void>,
 *   getSubscription?: (c: string) => Promise<ConnectRecord | null>,
 *   now?: string,
 *   planForProductId?: (id: string) => string | null | undefined,
 *   alert?: (...a: any[]) => void,
 * }} deps
 *
 * WIRING NOTE (decisions#341 Q3). `planForProductId` is OPTIONAL so every
 * existing caller keeps working unchanged, but it is the whole point of the
 * fix: without it this core cannot cross-check the granted tier against the
 * product Dodo actually charged for, and falls back to the plan the server
 * recorded. The route is meant to inject dodo.ts's env-backed resolver:
 *
 *   import { planForProductId } from "@/lib/dodo";
 *   await activateDodo(data, { getConnect, getSubscription, putConnect,
 *                              putSubscription, planForProductId });
 *
 * That one line lives in src/app/api/webhooks/dodo/route.ts, which this writer
 * does not own; until it is added the ladder degrades safely (step 2/3) and
 * says so in its own alert text ("resolver=NOT WIRED").
 *
 * @returns {Promise<ConnectRecord>}
 */
export async function activateDodo(payload, deps) {
  const { getConnect, getSubscription, putConnect, putSubscription, now, planForProductId, alert } = deps;
  const token = payload?.metadata?.connect_token || undefined;
  const customerId = payload?.customer?.customer_id ?? payload?.customer_id ?? undefined;

  let base = token ? await getConnect(token) : null;

  // RENEWAL RECOVERY (gotchas#258). This route handles subscription.renewed and
  // payment.succeeded as well as the first purchase (webhooks/dodo/route.ts:95-97),
  // and on a RENEWAL the connect record is normally GONE: putConnect stores it
  // under a 7-DAY TTL (store.ts:169) and a monthly subscription renews on day
  // ~30. So `getConnect` returns null, `base` is null, and the rebuild above —
  // however faithfully it preserves a base — has nothing to preserve. The
  // binding fields were then written away over BOTH records at the first
  // renewal, a month after the customer paid, with no error anywhere.
  //
  // The subscription record is the DURABLE one (no TTL, store.ts:198), so it is
  // the correct fallback base, and it already holds the binding fields. This is
  // exactly how the Stripe renewal path recovers its base
  // (refreshFromInvoice, webhooks/stripe/route.ts:92).
  //
  // Optional dep so existing callers that pass only the three stores keep
  // working unchanged; when it is absent the behaviour is exactly as before.
  if (!base && customerId && typeof getSubscription === "function") {
    base = await getSubscription(customerId);
  }

  const rec = activationRecordFromDodo(payload, base, now ?? new Date().toISOString(), { planForProductId, alert });
  // ONE record, BOTH writes: the connect record the customer binds through and
  // the durable subscription record support and entitlement read. gotchas#257
  // cost both of them phone/channel/consent, and preserving them in the builder
  // above is what fixes both — there is no second place to patch.
  if (token) await putConnect(rec);
  if (rec.customerId) await putSubscription(rec.customerId, rec);
  return rec;
}
