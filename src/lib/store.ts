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
  status: "pending" | "bound" | "active" | "cancelled";
  customerId?: string;
  subscriptionId?: string;
  telegramId?: number;
  // Persona chosen while shaping Mira on the web, carried to the bot at /start.
  persona?: string;
  role?: string;
  assistantName?: string;
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
 * Single-use claim binding: the first Telegram id to claim a token owns it.
 * The same id may re-read (idempotent rebind); any other id is rejected.
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
