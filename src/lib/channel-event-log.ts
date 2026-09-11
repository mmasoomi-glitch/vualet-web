/**
 * The channel identity event log — storage wiring.
 *
 * The row shape, the sanitisation and the timeline rendering all live in
 * channel-events.mjs. This file is only the backend: a hash-chained,
 * append-only chain over KV, built on the same primitive and the same backend
 * shape as the admin audit trail, in its OWN key space.
 *
 * Its own key space because an admin row is shaped around a staff member —
 * adminId, role, result — and a channel event's actor is usually the CUSTOMER,
 * the PROVIDER or the SYSTEM. Writing these into the admin chain with a
 * fabricated adminId would corrupt the trail that security and compliance
 * read, and would make its sequence numbers meaningless.
 *
 * NOTHING HERE MAY THROW INTO A CALLER. These events are evidence, but a
 * customer reconnecting their WhatsApp must not fail because the evidence
 * could not be written. `record()` reports failure and moves on; the operation
 * it describes has already happened either way.
 */

import { createAuditLog } from "@/lib/audit-chain.mjs";
import {
  buildChannelEvent,
  canonicaliseChannelRow,
  buildTimeline,
  buildCustomerHistory,
} from "@/lib/channel-events.mjs";
import { kvGet, kvSet } from "@/lib/store";

const SEQ_KEY = "mira:chan:evt:seq";
const evtKey = (seq: number) => `mira:chan:evt:${seq}`;

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const useUpstash = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

async function upstash(cmd: (string | number)[]): Promise<unknown> {
  const res = await fetch(UPSTASH_URL!, {
    method: "POST",
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { result: unknown };
  return data.result;
}

type ChannelRow = Record<string, unknown> & { seq: number; hash: string; prevHash: string };

const backend = {
  async nextSeq(): Promise<number> {
    // INCR is atomic on Upstash. The local tier is a single process, so a
    // read-modify-write is sufficient there and the append-only guard below
    // catches a collision anyway rather than silently overwriting.
    if (useUpstash) return Number(await upstash(["INCR", SEQ_KEY]));
    const cur = (await kvGet<number>(SEQ_KEY)) ?? 0;
    const next = cur + 1;
    await kvSet(SEQ_KEY, next);
    return next;
  },
  async currentSeq(): Promise<number> {
    if (useUpstash) return Number((await upstash(["GET", SEQ_KEY])) ?? 0);
    return (await kvGet<number>(SEQ_KEY)) ?? 0;
  },
  async getEvent(seq: number): Promise<ChannelRow | null> {
    if (useUpstash) {
      const raw = (await upstash(["GET", evtKey(seq)])) as string | null;
      return raw ? (JSON.parse(raw) as ChannelRow) : null;
    }
    return kvGet<ChannelRow>(evtKey(seq));
  },
  async putEventNX(seq: number, row: ChannelRow): Promise<boolean> {
    if (useUpstash) {
      const r = await upstash(["SET", evtKey(seq), JSON.stringify(row), "NX"]);
      return r === "OK";
    }
    // Write-once on the local tier too: an existing row is never overwritten.
    if ((await kvGet<ChannelRow>(evtKey(seq))) !== null) return false;
    await kvSet(evtKey(seq), row);
    return true;
  },
};

// The chain's JSDoc backend type names the ADMIN row shape, because that is
// the chain it was written for. The algorithm is row-agnostic — it only ever
// reads `hash` and `prevHash` — which is exactly why it takes a serialiser.
// The cast says so rather than widening the admin type and weakening it.
const chain = createAuditLog(
  backend as unknown as Parameters<typeof createAuditLog>[0],
  canonicaliseChannelRow,
);

/**
 * Append one identity event.
 *
 * Returns whether it was written. Callers are expected to ignore that in the
 * hot path: a reconnect that worked must not be reported as a failure because
 * the log was unavailable, and the operation has already happened regardless.
 */
export async function recordChannelEvent(input: {
  eventType: string;
  actorType: string;
  accountId?: string | null;
  bindingId?: string | null;
  actorId?: string | null;
  source?: string | null;
  reasonCode?: string | null;
  previousState?: string | null;
  newState?: string | null;
  correlationId?: string | null;
  causationId?: string | null;
  riskClassification?: string | null;
  detail?: Record<string, unknown>;
}): Promise<{ ok: boolean; reason?: string }> {
  try {
    const built = buildChannelEvent(input);
    if (!built.ok || !built.event) return { ok: false, reason: built.reason ?? "rejected" };
    // Same reason as the backend cast above: the chain's input type names the
    // admin row shape, and append() only ever adds seq/ts/prevHash/hash to it.
    await chain.append(built.event as unknown as Parameters<typeof chain.append>[0]);
    return { ok: true };
  } catch (err) {
    console.error("[channel-events] could not record:", err);
    return { ok: false, reason: "write_failed" };
  }
}

/** Most recent rows first. Read-only: there is no delete path anywhere. */
export async function listChannelEvents(limit = 200): Promise<ChannelRow[]> {
  try {
    return (await chain.list(limit)) as ChannelRow[];
  } catch (err) {
    console.error("[channel-events] could not read:", err);
    return [];
  }
}

/** Does the chain still verify? A false here means a row was altered. */
export async function verifyChannelChain(): Promise<{ ok: boolean; length: number; brokenAt?: number }> {
  try {
    return (await chain.verify()) as { ok: boolean; length: number; brokenAt?: number };
  } catch (err) {
    console.error("[channel-events] could not verify:", err);
    return { ok: false, length: 0 };
  }
}

/** The operator's chronological account of what happened to one account. */
export async function channelTimeline(accountId: string, limit = 200) {
  const rows = await listChannelEvents(limit);
  return buildTimeline(rows, { accountId });
}

/** The customer's own view, with the anti-fraud signals removed. */
export async function channelHistoryForCustomer(accountId: string, limit = 200) {
  const rows = await listChannelEvents(limit);
  return buildCustomerHistory(rows, accountId);
}
