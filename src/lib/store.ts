/**
 * Tiny key-value store for subscription state + the Telegram "connect token"
 * that bridges a web purchase to the actual Mira bot.
 *
 * Three tiers, in priority order:
 *   1. Upstash Redis over REST when UPSTASH_REDIS_REST_URL + _TOKEN are set
 *      (what Vercel KV provisions) — for serverless/multi-instance hosting.
 *   2. A durable JSON file when MIRA_STORE_FILE is set — for a single-process
 *      self-hosted deploy (our GPU box). Atomic temp+rename writes; survives
 *      restarts/redeploys. This is what makes live payments safe off Vercel.
 *   3. A bare in-process Map (dev/build only) — NOT durable; a startup warning
 *      fires in production so this can never be the silent state under load.
 */

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "fs";
import path from "path";
import type { StoredConsent } from "@/lib/consent";

const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const useUpstash = Boolean(URL && TOKEN);

const STORE_FILE = process.env.MIRA_STORE_FILE || "";
type Entry = { v: string; exp?: number };
const memory = new Map<string, Entry>();
let loaded = false;

function loadOnce(): void {
  if (loaded) return;
  loaded = true;
  if (STORE_FILE && existsSync(STORE_FILE)) {
    try {
      const obj = JSON.parse(readFileSync(STORE_FILE, "utf8")) as Record<string, Entry>;
      const now = Date.now();
      for (const [k, e] of Object.entries(obj)) {
        if (!e.exp || e.exp > now) memory.set(k, e);
      }
    } catch {
      /* corrupt/missing → start empty */
    }
  }
}

function persist(): void {
  if (!STORE_FILE) return;
  try {
    const obj: Record<string, Entry> = {};
    const now = Date.now();
    for (const [k, e] of memory) if (!e.exp || e.exp > now) obj[k] = e;
    mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    const tmp = STORE_FILE + ".tmp";
    writeFileSync(tmp, JSON.stringify(obj));
    renameSync(tmp, STORE_FILE); // atomic on same volume
  } catch (err) {
    console.error("[store] persist failed:", err);
  }
}

if (!useUpstash && !STORE_FILE && process.env.NODE_ENV === "production") {
  console.warn(
    "[mira] No durable store (UPSTASH_* or MIRA_STORE_FILE) in production — connect/subscription records live in-memory and will NOT survive a restart. Set MIRA_STORE_FILE.",
  );
}

/** True when writes are durable (Upstash OR a store file). Gate live payments on this. */
export function storeConfigured(): boolean {
  return useUpstash || Boolean(STORE_FILE);
}

async function upstash(cmd: (string | number)[]): Promise<unknown> {
  const res = await fetch(URL!, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { result: unknown };
  return data.result;
}

export async function kvSet(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  const v = JSON.stringify(value);
  if (useUpstash) {
    await upstash(ttlSeconds ? ["SET", key, v, "EX", ttlSeconds] : ["SET", key, v]);
    return;
  }
  loadOnce();
  memory.set(key, { v, exp: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined });
  persist();
}

export async function kvGet<T = unknown>(key: string): Promise<T | null> {
  let raw: string | null;
  if (useUpstash) {
    raw = (await upstash(["GET", key])) as string | null;
  } else {
    loadOnce();
    const e = memory.get(key);
    if (!e) return null;
    if (e.exp && e.exp <= Date.now()) {
      memory.delete(key);
      persist();
      return null;
    }
    raw = e.v;
  }
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Delete a key (used for single-use magic-link consumption). */
export async function kvDel(key: string): Promise<void> {
  if (useUpstash) {
    await upstash(["DEL", key]);
    return;
  }
  loadOnce();
  if (memory.delete(key)) persist();
}

// ---- Domain helpers ----------------------------------------------------

export type ConnectRecord = {
  token: string;
  plan: string;
  email?: string;
  /**
   * THE ENTITLEMENT GATE. src/lib/entitlement-core.mjs holds
   * `LIVE_DODO_STATUS = new Set(["active"])`, so this field is not a label —
   * it is the switch. EXACTLY ONE value ("active") grants web access and every
   * other value, present or future, revokes it. Anyone adding a member to this
   * union is deciding to revoke access for the customers who land on it, so the
   * union is written in two deliberately separated halves:
   *
   *   GRANTS   "active"
   *   REVOKES  everything else
   *
   * The four lifecycle values below were added for the Dodo webhook handlers
   * (decisions#341 Q1 + decisions#342) and each one is a REVOCATION we meant:
   *   "refunded"   the money went back to the customer (refund.succeeded).
   *   "chargeback" the money was clawed back by the card network — a dispute we
   *                LOST, ACCEPTED, or let EXPIRE. Never written for a dispute
   *                that is merely open: an open dispute is not an outcome.
   *   "on_hold"    Dodo's dunning-exhausted state (subscription.on_hold). This
   *                is the real lapse signal, NOT a single payment.failed — a
   *                first failed charge sets the `pastDue` FLAG below and leaves
   *                this field on "active", because one retryable failure must
   *                not lock a paying customer out mid-period.
   *   "paused"     subscription.paused; lifted again by subscription.unpaused.
   *
   * Note what is NOT here: there is no "past_due" status. It was tempting, and
   * it would have been a bug — Stripe treats past_due as still-entitled
   * (LIVE_STRIPE_STATUS includes it) while any non-"active" value revokes on
   * the Dodo side, so the same word would have meant opposite things on the two
   * providers. It is a boolean flag instead, and it cannot revoke anyone.
   */
  status:
    // ── GRANTS ACCESS ──
    | "active"
    // ── REVOKES ACCESS (pre-existing) ──
    | "pending"
    | "bound"
    | "cancelled"
    // ── REVOKES ACCESS (Dodo lifecycle, decisions#341 Q1 / #342) ──
    | "refunded"
    | "chargeback"
    | "on_hold"
    | "paused";
  /**
   * WHICH PROCESSOR OWNS THIS RECORD (verifications#412).
   *
   * The Stripe webhook (webhooks/stripe/route.ts:150,181,193) and the Dodo
   * webhook (putSubscription below) write the SAME `mira:sub:<customerId>`
   * key space with no way to tell the two apart. That is not a theoretical
   * collision: a legacy Stripe-era row was probed against the Dodo API, found
   * to be unknown there, and misdiagnosed as an orphaned subscription. The row
   * was fine; the reader had no way to know which provider it belonged to.
   *
   * OPTIONAL AND OFTEN ABSENT, and readers must treat it that way. Every record
   * written before this field existed carries no provider at all, and nothing
   * backfills them — a backfill would have to GUESS the provider of exactly the
   * rows whose provider is unknowable, which is the original bug with more
   * confidence. So `undefined` means "written before we tagged", NOT "Stripe"
   * and NOT "Dodo"; only an explicit value is evidence.
   */
  provider?: "dodo" | "stripe";
  customerId?: string;
  subscriptionId?: string;
  telegramId?: number;
  // The customer's WhatsApp number, ALWAYS stored normalised to E.164 ("+" plus
  // 8..15 digits) by src/lib/phone.ts — never the raw typed input, so one person
  // cannot become two identities. This is PII: it is on the assertNoInternals
  // secret list in support-core.mjs so it can never reach customer-facing copy.
  phone?: string;
  // Which surface this signup pairs through (decisions#340: WhatsApp-first).
  // OPTIONAL and possibly ABSENT: every record written before this field existed
  // has no channel at all, so readers must treat `undefined` as "legacy Telegram"
  // rather than assuming a value is present.
  channel?: "whatsapp" | "telegram";
  // PROOF OF THE GATE-C1 DISCLOSURE (specs#160): which boxes this customer
  // ticked, when, and against which revision of the disclosure copy. Written by
  // every path that binds a WhatsApp number (/api/begin and /api/checkout) so
  // "were they told about the ban risk?" is answerable from the record rather
  // than from a browser's memory. OPTIONAL and ABSENT on two kinds of record:
  // anything written before the gate existed, and Telegram signups, for which a
  // WhatsApp disclosure does not apply. Readers must not treat undefined as a
  // refusal — only as "this record does not carry one".
  consent?: StoredConsent;
  // Persona chosen while shaping Mira on the web, carried to the bot at /start.
  persona?: string;
  role?: string;
  assistantName?: string;

  // ── BILLING PERIOD (decisions#342 Q_C) ─────────────────────────────────
  /**
   * TRUE when billing has been told to stop at the END of the period the
   * customer already paid for, rather than immediately.
   *
   * This exists because the two halves of a cancellation disagreed. The
   * provider call is `cancel_at_next_billing_date: true` by default
   * (src/lib/dodo.ts:279) — the customer keeps the month they bought — but the
   * local record was being stamped `status: "cancelled"` in the same breath,
   * and "cancelled" is not "active", so entitlement revoked instantly. The
   * customer paid for a month, cancelled on day 2, and lost the other 28 days
   * that Dodo was still perfectly happy to serve them. Nothing failed; the two
   * systems simply held different beliefs and only one of them gated access.
   *
   * The fix these fields exist to support is: on a cancel-at-period-end, leave
   * `status` on "active" and record the INTENT here, so the record says "still
   * entitled, and it ends on this date" instead of "over". The webhook then
   * writes the real terminal status when the provider actually ends the
   * subscription (subscription.expired / .cancelled).
   *
   * OPTIONAL AND ABSENT on every record written before this existed. A reader
   * must treat `undefined` as "no scheduled end recorded" — NOT as `false`
   * meaning "definitely renewing", because a record that predates the field
   * carries no evidence either way.
   *
   * I own store.ts, not src/app/api/subscription/cancel/route.ts, so this is
   * the SHAPE for that fix and not the fix itself; the route is another
   * writer's. The Dodo webhook populates both fields whenever an event carries
   * them (see periodFieldsFromDodo in dodo-webhook-core.mjs).
   */
  cancelAtPeriodEnd?: boolean;
  /**
   * ISO timestamp the paid-for period runs out — the date access should
   * actually end when `cancelAtPeriodEnd` is true, and the renewal date
   * otherwise. Copied from the provider payload ONLY; never computed locally by
   * adding a month to something, because a guessed date here either confiscates
   * days the customer bought or gives away days they did not.
   */
  currentPeriodEnd?: string;

  /**
   * WHEN THE ADVERTISED 14-DAY FREE TRIAL ENDS, as an ISO timestamp.
   *
   * A DATE, NOT A BOOLEAN, and a separate field rather than a status. Both of
   * those are deliberate.
   *
   * A date because it answers more questions than a flag can: the account page
   * can render "your trial ends in N days", and — the part a boolean gets
   * wrong — it EXPIRES BY ITSELF. A `trialing: true` written at signup stays
   * true forever unless something remembers to come back and clear it, and
   * nothing was ever going to; a timestamp in the past simply stops meaning
   * "trialing" with no second webhook required.
   *
   * A separate field because `status` is the entitlement gate:
   * entitlement-core.mjs grants access on the literal string "active" and
   * NOTHING else, so writing "trialing" into the record's status would have
   * revoked web access for every customer inside their free trial — a far
   * bigger failure than the one being fixed. The record therefore stays
   * `status: "active"` throughout the trial, which is the truth: they are
   * entitled. This field says which PHASE that entitlement is in.
   *
   * SET ONCE AND NEVER MOVED. Written at first activation and preserved from
   * the existing record on every later event, because a renewal payload can
   * carry `trial_period_days` too — recomputing from "now" on each renewal
   * would hand a paying customer a fresh 14-day trial label every month.
   *
   * OPTIONAL AND ABSENT on every record written before this existed, and on
   * any subscription with no trial. `undefined` means "we hold no trial
   * information", NOT "not trialing".
   */
  trialEndsAt?: string;

  // ── NON-REVOKING FLAGS ─────────────────────────────────────────────────
  /**
   * A charge failed or dunning started, and we have NOT given up on it.
   *
   * Deliberately a flag and not a status, because it must NOT revoke access
   * (decisions#341 Q1: "do NOT revoke on a single failure"). Cards get declined
   * for reasons that have nothing to do with wanting to leave — an expiry, a
   * travel block, a bank's own fraud heuristic — and Dodo will retry. Locking
   * the customer out on attempt one, while still intending to charge them
   * again, is punishing someone for their bank's behaviour. The real lapse
   * signal is `subscription.on_hold`, which is dunning EXHAUSTED, and that one
   * does set `status`.
   *
   * Cleared by dunning.recovered.
   */
  pastDue?: boolean;
  /** ISO timestamp of the first failure in the current past-due run. */
  pastDueSince?: string;
  /**
   * A dispute (chargeback) is OPEN against this customer's payment and has not
   * been decided.
   *
   * A flag, not a status, and the reason is the whole ruling: "A dispute opened
   * is not final; many merchants win. Revoking on dispute.opened punishes a
   * customer who may be entirely in the right." So an open dispute is recorded
   * for operators and changes nothing the customer can feel. Only a FINAL
   * outcome moves `status`: lost/accepted/expired → "chargeback"; won/cancelled
   * → the flag is cleared and access was never interrupted.
   */
  disputed?: boolean;
  /** Provider dispute id, for an operator to look up. Never shown to a customer. */
  disputeId?: string;
  /** The last dispute event seen, e.g. "opened" | "challenged" | "won" | "lost". */
  disputeStatus?: string;

  createdAt: string;
};

const connectKey = (token: string) => `mira:connect:${token}`;
const subByCustomer = (customerId: string) => `mira:sub:${customerId}`;
// Email is normalised so a session email and a stored email always agree.
const subIdByEmail = (email: string) => `mira:subemail:${email.trim().toLowerCase()}`;

export async function putConnect(rec: ConnectRecord): Promise<void> {
  // 7-day TTL on the connect token; the durable sub record (below) has none.
  await kvSet(connectKey(rec.token), rec, 60 * 60 * 24 * 7);
}

export async function getConnect(token: string): Promise<ConnectRecord | null> {
  return kvGet<ConnectRecord>(connectKey(token));
}

/**
 * MIRROR A CHAT IDENTITY ONTO THE DURABLE SUBSCRIPTION RECORD (gotchas#267).
 *
 * The connect record expires; the subscription record does not. A revocation —
 * a refund, a chargeback, dunning exhausted — arrives whenever the money says
 * so, which is routinely months after the 7-day connect TTL has taken the only
 * copy of the binding with it. The engine push accepts exactly one identity
 * from this app (`telegramId`; there is no tenantId anywhere here), so an id
 * that lives only on the expiring record means the most ordinary signup order —
 * pay, then run /start — cannot be revoked at all: the webhook logs "NO
 * telegramId" and only a reconciliation sweep ever catches up. Every other
 * lifecycle failure mode converges on the next event; that one converges on a
 * sweep cadence, which is why the id belongs on the record with no TTL.
 *
 * WHAT LINKS THE TWO RECORDS AT CLAIM TIME. The connect record is keyed by
 * token and the subscription record by customerId, so the link is the
 * `customerId` field the activation write stamps onto BOTH records
 * (activateDodo in dodo-webhook-core.mjs: one built record, `putConnect` then
 * `putSubscription`). So in the pay-then-/start order the token being claimed
 * already carries the customer id, and this can find the durable row.
 *
 * WHEN THERE IS NO DURABLE ROW YET, THIS DOES NOTHING, DELIBERATELY. In the
 * other order — /start, then pay — the connect record is still `pending` with
 * no customerId, and no subscription record exists to bind to. Manufacturing
 * one here would invent a subscription for someone who has not paid, and it
 * would be written from a connect record whose `status` is not an entitlement
 * anyone earned. Nothing is needed: the claim has already written the id onto
 * the connect record, and activation then builds the subscription record FROM
 * that connect record, so the id is carried across by the existing path.
 *
 * NEVER RE-POINTS AN EXISTING BINDING. If the durable record already names a
 * different chat, that is a conflict this function has no authority to settle —
 * and silently re-pointing it would aim the next revocation at the wrong
 * person. It is left alone and logged for an operator.
 *
 * REDACTION: no new entry is needed on the customer-facing secret list, because
 * a telegramId is ALREADY on it — support-core.mjs assertNoInternals() carries
 * `rec.telegramId` alongside `rec.phone` and throws if either reaches customer
 * copy. This function moves an identifier that is already treated as internal
 * between two internal records; it does not create a new class of data, and the
 * summariser that customers actually read is guarded either way.
 */
async function mirrorIdentityToSubscription(
  customerId: string | undefined,
  telegramId: number,
): Promise<void> {
  if (!customerId) return;
  const sub = await getSubscription(customerId);
  if (!sub) return; // /start-then-pay: activation will carry the id across.
  if (sub.telegramId === telegramId) return; // idempotent: identical, no write.
  if (sub.telegramId != null) {
    console.warn(
      "[store] subscription record already bound to a different chat id — leaving it alone",
      { customerId },
    );
    return;
  }
  // Read-modify-write of ONE field. Deliberately NOT `putSubscription(id, rec)`
  // with the connect record: the durable row is the one lifecycle events write
  // status onto, so copying the connect record over it would hand a refunded or
  // on-hold customer whatever status the connect copy still remembered.
  await putSubscription(customerId, { ...sub, telegramId });
}

/**
 * Single-use claim binding: the first Telegram id to claim a token owns it.
 * The same id may re-read (idempotent rebind); any other id is rejected.
 *
 * The claim also mirrors the id onto the durable subscription record when there
 * is one (see above) — the connect record is the record that expires, and a
 * revocation months later has to be able to find out who to revoke.
 */
export async function claimConnect(
  token: string,
  telegramId: number,
): Promise<{ ok: true; rec: ConnectRecord } | { ok: false; reason: "not_found" | "foreign" }> {
  const rec = await getConnect(token);
  if (!rec) return { ok: false, reason: "not_found" };
  if (rec.telegramId != null && rec.telegramId !== telegramId) {
    return { ok: false, reason: "foreign" };
  }
  if (rec.telegramId == null) {
    rec.telegramId = telegramId;
    if (rec.status === "pending") rec.status = "bound";
    await putConnect(rec);
  }
  // Runs on EVERY successful claim, not only the first one, and costs no write
  // when the durable record already agrees. A repeat /start is the one signal
  // we get from a customer whose mirror never landed — a claim that happened
  // before this code existed, or a write that failed — so letting it heal the
  // record is free, while restricting the mirror to the first-bind branch would
  // leave exactly those customers unrevokable forever.
  await mirrorIdentityToSubscription(rec.customerId, telegramId);
  return { ok: true, rec };
}

export async function putSubscription(customerId: string, rec: ConnectRecord): Promise<void> {
  await kvSet(subByCustomer(customerId), rec);
  // Reverse index so a logged-in customer can find their OWN subscription from
  // their session email alone. Without this there is no email -> subscription
  // path at all (Dodo exposes no list-by-email endpoint), which is what left
  // customers unable to cancel. Writing the index here means it is maintained
  // by the same call that already owns subscription persistence.
  if (rec.email) await kvSet(subIdByEmail(rec.email), customerId);
}

export async function getSubscription(customerId: string): Promise<ConnectRecord | null> {
  return kvGet<ConnectRecord>(subByCustomer(customerId));
}

/**
 * Resolve a subscription from a VERIFIED session email — never from a
 * client-supplied customer id. This is the anti-IDOR shape: the caller cannot
 * name whose subscription to act on, only prove which inbox they control.
 * Returns null for customers who predate the index (they fall back to the
 * human support path rather than getting a wrong record).
 */
export async function getSubscriptionByEmail(
  email: string,
): Promise<{ customerId: string; rec: ConnectRecord } | null> {
  if (!email) return null;
  const customerId = await kvGet<string>(subIdByEmail(email));
  if (!customerId) return null;
  const rec = await getSubscription(customerId);
  if (!rec) return null;
  // Defence in depth: the record's own email must still match the session.
  if ((rec.email || "").trim().toLowerCase() !== email.trim().toLowerCase()) return null;
  return { customerId, rec };
}
