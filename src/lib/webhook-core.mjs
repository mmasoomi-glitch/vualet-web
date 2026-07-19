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
    token: token ?? subscriptionId ?? customerId ?? "unknown",
    plan: base?.plan ?? session.metadata?.plan ?? "companion",
    email: base?.email ?? session.customer_details?.email ?? undefined,
    status: "active",
    customerId,
    subscriptionId,
    telegramId: base?.telegramId,
    persona: base?.persona,
    role: base?.role,
    assistantName: base?.assistantName,
    createdAt: base?.createdAt ?? now,
  });
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
  if (token) await putConnect(rec);
  if (rec.customerId) await putSubscription(rec.customerId, rec);
  return rec;
}
