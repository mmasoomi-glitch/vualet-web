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
  status: "pending" | "active" | "cancelled";
  customerId?: string;
  subscriptionId?: string;
  telegramId?: number;
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

export async function putSubscription(customerId: string, rec: ConnectRecord): Promise<void> {
  await kvSet(subByCustomer(customerId), rec);
}

export async function getSubscription(customerId: string): Promise<ConnectRecord | null> {
  return kvGet<ConnectRecord>(subByCustomer(customerId));
}
