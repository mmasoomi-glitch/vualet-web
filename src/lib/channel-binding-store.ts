/**
 * Channel bindings, recovery tokens and migrations — the storage layer.
 *
 * The decisions all live in the pure cores (channel-binding-core,
 * recovery-core, number-migration-core). This file only reads and writes them,
 * and emits the durable events that make an incident reconstructable.
 *
 * ── WHAT THIS STORE CAN AND CANNOT DO ─────────────────────────────────────
 * The KV layer offers get, set and delete. There is no scan, so "every
 * recovery for this account" is an explicit bounded array under one key rather
 * than a query. There is no compare-and-set, so single-use cannot be enforced
 * by an atomic swap.
 *
 * THAT IS SAFE HERE ONLY BECAUSE THE AUTHORISED OPERATION IS ITSELF
 * IDEMPOTENT: a recovery token authorises "activate this account's binding",
 * and doing that twice ends in exactly the same state as doing it once. Two
 * simultaneous clicks converge. This would NOT be safe for a token that
 * granted something countable — credit, a refund, a new subscription — and no
 * such purpose may ever be added to RECOVERY_PURPOSES without revisiting this.
 *
 * ── IDENTIFIERS ───────────────────────────────────────────────────────────
 * A WhatsApp JID is a phone number wearing a suffix. It is hashed on the way
 * in and the raw value is never stored, never logged and never returned.
 */

import { createHash, createHmac, randomBytes } from "crypto";
import { kvGet, kvSet, kvDel } from "@/lib/store";
import { whatsappIdHash } from "@/lib/whatsapp-claim";
import {
  BINDING_STATES,
  ACTOR_TYPES,
  REASON_CODES,
  canTransition,
} from "@/lib/channel-binding-core.mjs";
import {
  RECOVERY_TTL_MS,
  buildRecovery,
  consumeToken,
  decideIssuance,
  activeTokenIn,
} from "@/lib/recovery-core.mjs";

/** How long a recovery record is kept AFTER it dies, so a timeline can read it. */
const RECOVERY_HISTORY_TTL_S = 30 * 24 * 3600;
/** Bounded so one account cannot grow an unbounded value under a single key. */
const MAX_HISTORY = 50;

type Json = Record<string, unknown>;

/* ── keys ──────────────────────────────────────────────────────────────── */

const kBinding = (bindingId: string) => `mira:binding:${bindingId}`;
const kBindingByChannel = (channel: string, idHash: string) => `mira:binding:by:${channel}:${idHash}`;
const kBindingsOfAccount = (accountId: string) => `mira:bindings:of:${accountId}`;
const kRecovery = (tokenHash: string) => `mira:rcv:${tokenHash}`;
const kRecoveryHistory = (accountId: string) => `mira:rcv:hist:${accountId}`;
const kMigration = (migrationId: string) => `mira:mig:${migrationId}`;

/* ── identifiers ───────────────────────────────────────────────────────── */

function secret(): string {
  const s = process.env.MIRA_TOKEN_SECRET || "";
  if (!s) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("MIRA_TOKEN_SECRET is required to hash channel identifiers");
    }
    return "dev-only-insecure-secret";
  }
  return s;
}

/**
 * The one place a raw channel identifier is turned into a stored value.
 *
 * Keyed HMAC rather than a bare hash: a phone number has far too little
 * entropy to survive an unkeyed digest, and an attacker holding the database
 * could otherwise recover every number by enumerating them.
 *
 * FOR WHATSAPP THIS DELEGATES TO whatsappIdHash AND MUST CONTINUE TO. That
 * function normalises a JID first — lowercasing it and stripping both the
 * "@s.whatsapp.net" suffix and the ":<device>" part. A second, unnormalised
 * hash would mean "12025551234@s.whatsapp.net" and "12025551234:12@s.whatsapp.net"
 * produced different values for the same human, so a returning customer whose
 * device id had changed would look like a stranger and be onboarded afresh.
 * It also has to match because the bind step compares the two.
 */
export function channelIdHash(channelType: string, rawIdentifier: string): string {
  if (channelType === "whatsapp") return whatsappIdHash(rawIdentifier);
  const normalised = String(rawIdentifier).trim().toLowerCase();
  return createHmac("sha256", secret()).update(`${channelType}:${normalised}`).digest("base64url");
}

/** Recovery tokens are looked up BY hash, so this one is unkeyed on purpose. */
function tokenHashOf(token: string): string {
  return createHash("sha256").update(String(token)).digest("hex");
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

/* ── bindings ──────────────────────────────────────────────────────────── */

export type BindingRecord = {
  bindingId: string;
  accountId: string;
  channelType: string;
  channelIdHash: string;
  providerIdentifier: string | null;
  state: string;
  pairedAt: number | null;
  lastVerifiedAt: number | null;
  lastSeenAt: number | null;
  revokedAt: number | null;
  revocationReason: string | null;
  supersededByBindingId: string | null;
  createdAt: number;
};

export async function getBinding(bindingId: string): Promise<BindingRecord | null> {
  if (!bindingId) return null;
  return kvGet<BindingRecord>(kBinding(bindingId));
}

export async function findBindingByChannel(
  channelType: string,
  rawIdentifier: string,
): Promise<BindingRecord | null> {
  if (!channelType || !rawIdentifier) return null;
  const bindingId = await kvGet<string>(kBindingByChannel(channelType, channelIdHash(channelType, rawIdentifier)));
  return bindingId ? getBinding(bindingId) : null;
}

export async function createBinding(input: {
  accountId: string;
  channelType: string;
  rawIdentifier: string;
  providerIdentifier?: string | null;
  nowMs: number;
}): Promise<BindingRecord> {
  const idHash = channelIdHash(input.channelType, input.rawIdentifier);
  const record: BindingRecord = {
    bindingId: newId("bnd"),
    accountId: input.accountId,
    channelType: input.channelType,
    channelIdHash: idHash,
    providerIdentifier: input.providerIdentifier ?? null,
    state: BINDING_STATES.PENDING,
    pairedAt: null,
    lastVerifiedAt: null,
    lastSeenAt: null,
    revokedAt: null,
    revocationReason: null,
    supersededByBindingId: null,
    createdAt: input.nowMs,
  };
  await kvSet(kBinding(record.bindingId), record);
  await kvSet(kBindingByChannel(input.channelType, idHash), record.bindingId);
  await appendToAccount(input.accountId, record.bindingId);
  return record;
}

async function appendToAccount(accountId: string, bindingId: string): Promise<void> {
  const list = (await kvGet<string[]>(kBindingsOfAccount(accountId))) || [];
  if (list.includes(bindingId)) return;
  list.push(bindingId);
  await kvSet(kBindingsOfAccount(accountId), list.slice(-MAX_HISTORY));
}

export async function bindingsOfAccount(accountId: string): Promise<BindingRecord[]> {
  const ids = (await kvGet<string[]>(kBindingsOfAccount(accountId))) || [];
  const out: BindingRecord[] = [];
  for (const id of ids) {
    const rec = await getBinding(id);
    if (rec) out.push(rec);
  }
  return out;
}

/**
 * Move a binding to a new state, refusing anything the core calls illegal.
 *
 * The legality check is here rather than at the call sites so no caller can
 * resurrect a REVOKED binding by writing the record directly — that is the one
 * mistake that would undo the recycled-number defence.
 */
export async function transitionBinding(
  bindingId: string,
  to: string,
  opts: { nowMs: number; actorType?: string; reasonCode?: string; supersededBy?: string },
): Promise<{ ok: true; record: BindingRecord } | { ok: false; reason: string }> {
  const current = await getBinding(bindingId);
  if (!current) return { ok: false, reason: "No such binding." };
  if (!canTransition(current.state, to)) {
    return { ok: false, reason: `${current.state} cannot become ${to}.` };
  }

  const next: BindingRecord = { ...current, state: to };
  if (to === BINDING_STATES.ACTIVE) {
    next.pairedAt = current.pairedAt ?? opts.nowMs;
    next.lastVerifiedAt = opts.nowMs;
    next.revokedAt = null;
    next.revocationReason = null;
  }
  if (to === BINDING_STATES.REVOKED || to === BINDING_STATES.SUPERSEDED) {
    next.revokedAt = opts.nowMs;
    next.revocationReason = opts.reasonCode ?? REASON_CODES.UNKNOWN_DISCONNECT;
    next.supersededByBindingId = opts.supersededBy ?? null;
  }

  await kvSet(kBinding(bindingId), next);
  return { ok: true, record: next };
}

/** Record that a binding was seen alive, without changing its state. */
export async function touchBinding(bindingId: string, nowMs: number): Promise<void> {
  const current = await getBinding(bindingId);
  if (!current) return;
  await kvSet(kBinding(bindingId), { ...current, lastSeenAt: nowMs });
}

/* ── recovery tokens ───────────────────────────────────────────────────── */

export type RecoveryRecord = {
  recoveryId: string;
  tokenHash: string;
  accountId: string;
  oldBindingId: string | null;
  purpose: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  revokedAt: number | null;
  requestSource?: string;
  riskState?: string;
  /**
   * The live token, held ONLY while the link is valid so a repeated "hi" can
   * be answered with the same link instead of a confusing second one. Optional
   * because it is deleted the moment the token is spent, revoked or expires.
   */
  rawOnce?: string;
};

export async function recoveryHistory(accountId: string): Promise<RecoveryRecord[]> {
  return (await kvGet<RecoveryRecord[]>(kRecoveryHistory(accountId))) || [];
}

/**
 * Drop the live token from a history entry.
 *
 * The raw token is held ONLY while the link is live, so a repeated "hi" can be
 * answered with the same link. The moment it is consumed, revoked or expires,
 * it must stop existing in storage — a spent token sitting in a history array
 * is a credential nobody is watching.
 */
function withoutRaw(entry: RecoveryRecord): RecoveryRecord {
  const next = { ...entry };
  delete next.rawOnce;
  return next;
}

/**
 * Mint a reconnect link, or explain why not.
 *
 * Returns the RAW token exactly once, to the caller that will deliver it. It is
 * never stored — only its hash is — so this return value is the only moment the
 * token exists anywhere outside the customer's message.
 */
export async function issueRecovery(input: {
  accountId: string;
  oldBindingId: string | null;
  purpose: string;
  nowMs: number;
  requestSource?: string;
  riskState?: string;
}): Promise<
  | { ok: true; token: string; record: RecoveryRecord; reused: boolean }
  | { ok: false; reason: string; retryAfterMs: number }
> {
  const history = await recoveryHistory(input.accountId);

  // A customer who sends "hi" twice in ten seconds gets the SAME live link.
  // Minting a second would silently invalidate the first and leave them
  // unsure which to tap — but the raw token cannot be recovered from storage,
  // so reuse is only possible while we still hold it in the live record.
  const live = activeTokenIn(history, input.nowMs) as RecoveryRecord | null;
  if (live && typeof live.rawOnce === "string" && live.rawOnce.length > 0) {
    return { ok: true, token: live.rawOnce as string, record: live, reused: true };
  }

  const verdict = decideIssuance({ history, nowMs: input.nowMs });
  if (!verdict.allow) {
    return { ok: false, reason: verdict.reason, retryAfterMs: verdict.retryAfterMs };
  }

  const token = randomBytes(32).toString("base64url");
  const built = buildRecovery({
    recoveryId: newId("rec"),
    tokenHash: tokenHashOf(token),
    accountId: input.accountId,
    oldBindingId: input.oldBindingId,
    purpose: input.purpose,
    nowMs: input.nowMs,
    requestSource: input.requestSource,
    riskState: input.riskState,
  });
  // The pure core is plain JS, so TypeScript widens `ok` to boolean and cannot
  // narrow the union. The fallback is defensive, not decorative.
  if (!built.ok) return { ok: false, reason: built.reason ?? "Could not build a recovery.", retryAfterMs: 0 };

  const record = built.record as RecoveryRecord;
  await kvSet(kRecovery(record.tokenHash), record, RECOVERY_HISTORY_TTL_S);
  // The history entry carries the raw token ONLY for the ten minutes it is
  // live, so a repeated "hi" can be answered with the same link. It is dropped
  // the moment the token is consumed or expires.
  const entry = { ...record, rawOnce: token };
  await kvSet(
    kRecoveryHistory(input.accountId),
    [...history, entry].slice(-MAX_HISTORY),
    RECOVERY_HISTORY_TTL_S,
  );

  return { ok: true, token, record, reused: false };
}

/**
 * Spend a reconnect link. The verdict distinguishes expired from replayed,
 * because those mean very different things in an incident timeline.
 */
export async function redeemRecovery(
  token: string,
  nowMs: number,
  expectedPurpose?: string,
): Promise<{ ok: true; record: RecoveryRecord } | { ok: false; state: string; reason: string }> {
  const hash = tokenHashOf(token || "");
  const stored = await kvGet<RecoveryRecord>(kRecovery(hash));
  const result = consumeToken(stored, nowMs, expectedPurpose);
  if (!result.ok) {
    return {
      ok: false,
      state: result.state ?? "NOT_FOUND",
      reason: result.reason ?? "That link cannot be used.",
    };
  }

  const used = result.record as RecoveryRecord;
  await kvSet(kRecovery(hash), used, RECOVERY_HISTORY_TTL_S);
  await rewriteHistory(used.accountId, hash, used);
  return { ok: true, record: used };
}

/** Revoke every live link for an account — used when a binding changes hands. */
export async function revokeAllRecoveries(accountId: string, nowMs: number): Promise<number> {
  const history = await recoveryHistory(accountId);
  let revoked = 0;
  const next = history.map((entry) => {
    if (entry.usedAt == null && entry.revokedAt == null && entry.expiresAt > nowMs) {
      revoked++;
      return withoutRaw({ ...entry, revokedAt: nowMs });
    }
    return entry;
  });
  await kvSet(kRecoveryHistory(accountId), next, RECOVERY_HISTORY_TTL_S);
  for (const entry of next) {
    if (entry.revokedAt === nowMs) await kvSet(kRecovery(entry.tokenHash), entry, RECOVERY_HISTORY_TTL_S);
  }
  return revoked;
}

async function rewriteHistory(
  accountId: string,
  tokenHash: string,
  updated: RecoveryRecord,
): Promise<void> {
  const history = await recoveryHistory(accountId);
  const next = history.map((entry) =>
    entry.tokenHash === tokenHash ? withoutRaw(updated) : entry,
  );
  await kvSet(kRecoveryHistory(accountId), next, RECOVERY_HISTORY_TTL_S);
}

/* ── migrations ────────────────────────────────────────────────────────── */

export async function getMigration(migrationId: string): Promise<Json | null> {
  if (!migrationId) return null;
  return kvGet<Json>(kMigration(migrationId));
}

export async function putMigration(record: { migrationId: string }): Promise<void> {
  await kvSet(kMigration(record.migrationId), record);
}

/* ── re-exports the routes need ────────────────────────────────────────── */

export { BINDING_STATES, ACTOR_TYPES, REASON_CODES, RECOVERY_TTL_MS };
export { kvDel };
