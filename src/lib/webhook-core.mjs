/**
 * WEBHOOK CORE — pure, env-free, Stripe-free logic for the Stripe webhook.
 *
 * Single source of truth shared by BOTH the webhook route (route.ts, which
 * injects the live kv + store helpers) AND the runnable test
 * (scripts/webhook-checkout-test.mjs, which injects fakes) — so the EXACT same
 * activation + idempotency code path is exercised, with no env reads and no
 * live Stripe calls in tests. Mirrors the plan-core.mjs / promo-core.mjs pattern.
 *
 * The two properties this core exists to guarantee (jury #68b):
 *   1. A checkout.session.completed activates the tier the SERVER put on the
 *      session — never a silent default — regardless of amount_total. A $0 /
 *      100%-off / trialing order activates identically to a paid one, because
 *      NOTHING here reads amount_total or payment_status.
 *   2. Idempotency: the same delivered event.id is processed exactly once,
 *      via the `mira:evt:` dedupe key.
 *
 * @typedef {import("./store").ConnectRecord} ConnectRecord
 */

// Durable idempotency namespace + TTL. `mira:evt:` can never collide with
// connect tokens (`mira:connect:`) or subscription records (`mira:sub:`).
// TTL comfortably outlives Stripe's retry window (~3 days).
export const EVENT_TTL_SECONDS = 60 * 60 * 24 * 4;

/** @param {string} id */
export const eventKey = (id) => `mira:evt:${id}`;

/**
 * Has this delivered event id already been processed?
 * @param {(key: string) => Promise<unknown>} kvGet
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function wasEventProcessed(kvGet, id) {
  return (await kvGet(eventKey(id))) != null;
}

/**
 * Record that a delivered event id has been processed (call only AFTER success).
 * @param {(key: string, value: unknown, ttlSeconds?: number) => Promise<void>} kvSet
 * @param {string} id
 */
export async function markEventProcessed(kvSet, id) {
  await kvSet(eventKey(id), Date.now(), EVENT_TTL_SECONDS);
}

/**
 * Stripe fields are `id | expanded object | null`; normalise to the id string.
 * @param {string | { id?: string } | null | undefined} v
 * @returns {string | undefined}
 */
export function idOf(v) {
  if (!v) return undefined;
  return typeof v === "string" ? v : v.id;
}

/**
 * Build the ACTIVATED connect/subscription record from a completed checkout
 * session (+ any pre-existing connect record the checkout route stored at
 * "pending"). This is the whole tier decision:
 *   plan = base.plan (set at checkout) ?? session.metadata.plan (set at
 *   checkout) ?? "companion" (last-resort only when the server gave us nothing).
 * There is deliberately NO reference to amount_total / payment_status: a $0
 * order activates exactly like a paid one.
 *
 * @param {any} session  Stripe.Checkout.Session
 * @param {ConnectRecord | null | undefined} base  existing connect record, if any
 * @param {string} now  ISO timestamp for createdAt when there is no base
 * @returns {ConnectRecord}
 */
export function activationRecordFromSession(session, base, now) {
  const token = session.metadata?.connect_token || undefined;
  const customerId = idOf(session.customer);
  const subscriptionId = idOf(session.subscription);
  return /** @type {ConnectRecord} */ ({
    // PRESERVE FIRST, OVERRIDE SECOND (gotchas#257). This used to re-list the
    // fields worth keeping — token, plan, email, status, customerId,
    // subscriptionId, telegramId, persona, role, assistantName, createdAt — and
    // so silently DELETED every field added to the record after that list was
    // written. `phone`, `channel` and `consent` are collected at checkout for
    // decisions#340 (WhatsApp-first) and specs#160 (gate-C1), so the record was
    // bindable right up until the customer paid and unbindable the moment they
    // did — and nothing failed, because the write succeeded and the fields
    // merely ceased to exist.
    //
    // That list was NOT a security filter, and the git history proves it: at
    // 08353f9, the commit that introduced it, ConnectRecord had exactly those
    // eleven fields and no others. It was a complete copy of the type that went
    // stale, not a decision about which fields are safe to carry — no comment
    // here ever claimed otherwise. A record grows fields on a different
    // schedule from any list written against it, so preservation has to be
    // structural rather than enumerated.
    //
    // The spread is safe because `base` is OUR OWN record: read from OUR store
    // by a token that arrived inside a payload Stripe signed and route.ts
    // verified with constructEvent BEFORE this runs, and written field-by-field
    // from validated input by /api/begin (route.ts:196) and /api/checkout
    // (route.ts:203, :260) — the request body is never spread into it, so it
    // cannot carry an attacker-chosen key. What a stale base must NOT be
    // allowed to decide is the payment outcome, and it cannot: every
    // payment-authoritative field is assigned BELOW the spread, so an old
    // "cancelled" status or a superseded customer id can never win.
    //
    // Matches src/lib/dodo-webhook-core.mjs activationRecordFromDodo field for
    // field. The two activation paths must stay the same shape.
    ...(base ?? {}),

    // ── Payment-authoritative from here down; the base never overrides these.
    // `base?.token` before the subscription/customer fallbacks (writer H's
    // scenario B): without it, an event carrying no echoed connect token
    // rewrites the record's token to the subscription id, ORPHANING it from the
    // token the customer actually binds through — a silent identity change, not
    // a missing field, but the same family of loss. Unreachable from
    // activateCheckout today, because its base is fetched BY that token and so
    // cannot exist when the token does not; kept because the builder is
    // exported and callable with a base obtained another way (refreshFromInvoice
    // recovers one from the durable store), and because the two cores must stay
    // field-identical. refreshFromInvoice (stripe/route.ts:121) already had it.
    token: token ?? base?.token ?? subscriptionId ?? customerId ?? "unknown",
    plan: base?.plan ?? session.metadata?.plan ?? "companion",
    email: base?.email ?? session.customer_details?.email ?? undefined,
    status: "active",
    // The session is the authority on payment identity and ALWAYS wins when it
    // names one. The base only fills an ABSENCE — which keeps the droppedFields
    // invariant below universal (a real customerId we already held is never
    // silently replaced by undefined, the same class of loss as the fields
    // above) without ever letting a stale base contradict the payment: no
    // misattribution is possible when the session names no competing customer.
    // This is a DELIBERATE divergence from dodo-webhook-core.mjs, which assigns
    // these bare; the Stripe path has a sibling that already establishes the
    // backfill norm — refreshFromInvoice (webhooks/stripe/route.ts:124-125).
    customerId: customerId ?? base?.customerId,
    subscriptionId: subscriptionId ?? base?.subscriptionId,
    createdAt: base?.createdAt ?? now,
  });
}

/**
 * Build the REFRESHED record for a renewal (invoice.paid / payment_succeeded).
 *
 * This lived as a second, hand-maintained object literal inside
 * refreshFromInvoice (webhooks/stripe/route.ts) and carried the SAME stale
 * allow-list as activation did — so gotchas#257 had a third site, and a
 * customer who survived activation with their binding intact lost it on their
 * first renewal instead. It is here, in the pure core, so that there is ONE
 * record-shaping rule for this webhook rather than two that drift apart, and so
 * the renewal path is reachable from scripts/webhook-checkout-test.mjs without
 * a live Stripe SDK.
 *
 * I/O deliberately stays in the route: recovering `base` needs the Stripe SDK
 * (subscriptions.retrieve) and the store, neither of which belongs in a pure,
 * env-free module. The route hands us what it recovered; we only shape it.
 *
 * Renewal is NOT a payment identity change — it re-confirms an existing one —
 * so every field here prefers the invoice when it names a value and falls back
 * to the base otherwise, exactly like activation.
 *
 * @param {{ customerId?: string, subscriptionId?: string, token?: string }} invoice
 *   ids already normalised out of the Stripe invoice by the route
 * @param {ConnectRecord | null | undefined} base  recovered sub/connect record
 * @param {string} now  ISO timestamp for createdAt when there is no base
 * @returns {ConnectRecord}
 */
export function renewalRecordFromInvoice(invoice, base, now) {
  const { customerId, subscriptionId, token } = invoice ?? {};
  return /** @type {ConnectRecord} */ ({
    // PRESERVE FIRST, OVERRIDE SECOND — same rule as activation above, same
    // reason. The base here is OUR record, recovered from OUR durable store by
    // a customer id that came out of a constructEvent-verified invoice.
    ...(base ?? {}),

    // ── Renewal-authoritative from here down.
    token: token ?? base?.token ?? subscriptionId ?? customerId ?? "unknown",
    plan: base?.plan ?? "companion",
    status: "active",
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
 * This code sits on the money path, and a webhook that throws is a webhook
 * Stripe retries into a customer who has paid and never been activated —
 * turning a dropped field into a failed purchase. So the guard fails LOUDLY
 * where loud is free (scripts/webhook-checkout-test.mjs asserts it on every
 * activation shape, and on every renewal shape) and stays out of the way where
 * a false alarm costs a sale.
 *
 * Mirrors droppedFields in src/lib/dodo-webhook-core.mjs.
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
 * Activate from a completed checkout session: read any base connect record,
 * build the active record, and write it to the connect + subscription stores.
 * All I/O injected — no module-level env, no Stripe. Returns the written record.
 *
 * @param {any} session  Stripe.Checkout.Session
 * @param {{
 *   getConnect: (token: string) => Promise<ConnectRecord | null>,
 *   putConnect: (rec: ConnectRecord) => Promise<void>,
 *   putSubscription: (customerId: string, rec: ConnectRecord) => Promise<void>,
 *   now?: string,
 * }} deps
 * @returns {Promise<ConnectRecord>}
 */
export async function activateCheckout(session, deps) {
  const { getConnect, putConnect, putSubscription, now } = deps;
  const token = session.metadata?.connect_token || undefined;
  const base = token ? await getConnect(token) : null;
  const rec = activationRecordFromSession(session, base, now ?? new Date().toISOString());
  // ONE record, BOTH writes: the connect record the customer binds through and
  // the durable subscription record support and entitlement read. gotchas#257
  // cost both of them phone/channel/consent, and preserving them in the builder
  // above is what fixes both — there is no second place to patch.
  if (token) await putConnect(rec);
  if (rec.customerId) await putSubscription(rec.customerId, rec);
  return rec;
}
