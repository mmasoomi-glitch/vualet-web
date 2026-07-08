/**
 * Tiny key-value store for subscription state + the Telegram "connect token"
 * that bridges a web purchase to the actual Mira bot.
 *
 * Uses Upstash Redis over REST when configured (UPSTASH_REDIS_REST_URL +
 * UPSTASH_REDIS_REST_TOKEN — what Vercel KV provisions). With no env it falls
 * back to an in-process Map so dev/build works; that fallback is NOT durable
 * across serverless instances, so configure Upstash before real traffic.
 */

const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const memory = new Map<string, string>();

if (!URL && process.env.NODE_ENV === "production") {
  console.warn(
    "[mira] UPSTASH_REDIS_REST_URL/_TOKEN unset in production — connect records live in-memory and will NOT survive redeploys or scale-out. Configure Vercel KV/Upstash.",
  );
}

export function storeConfigured(): boolean {
  return Boolean(URL && TOKEN);
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
  if (storeConfigured()) {
    await upstash(ttlSeconds ? ["SET", key, v, "EX", ttlSeconds] : ["SET", key, v]);
  } else {
    memory.set(key, v);
  }
}

export async function kvGet<T = unknown>(key: string): Promise<T | null> {
  const raw = storeConfigured() ? ((await upstash(["GET", key])) as string | null) : memory.get(key) ?? null;
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
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
 * Not atomic across concurrent claims on Upstash REST — acceptable for the
 * onboarding flow where one human taps one deep link.
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
}

export async function getSubscription(customerId: string): Promise<ConnectRecord | null> {
  return kvGet<ConnectRecord>(subByCustomer(customerId));
}
