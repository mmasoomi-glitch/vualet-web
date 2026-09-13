import { randomUUID } from "node:crypto";
import { kvGet, kvSet, kvDel } from "@/lib/store";
import {
  buildExperienceMemory,
  matchesScope,
  effectiveMemories,
  applySupersession,
  STATUS,
} from "@/lib/experience-memory-core.mjs";
import {
  evaluateLocationEvent,
  initialTriggerState,
  DECISIONS,
} from "@/lib/context-trigger-core.mjs";
import { keyForMemory, keysToQuery } from "@/lib/geo-index-core.mjs";

/**
 * Where a remembered experience actually lives.
 *
 * The decision logic is in the three pure cores; this is the part that touches
 * the store, and the store is unusually limited: get, set and delete, with no
 * compare-and-set and no multi-key transaction. Everything below is shaped by
 * that, and the places where it costs something are marked rather than hidden.
 *
 * ── THE RACE THIS STORE CANNOT ELIMINATE ──────────────────────────────────
 * A cell index is a list under one key. Adding to it is read-modify-write, and
 * without compare-and-set two writes landing together can lose one of them.
 * That is a real limitation, not an oversight. It is mitigated, not solved:
 *
 *   - the memory record itself is written FIRST and under its own key, so the
 *     durable fact of the memory never depends on the index;
 *   - a lost index entry degrades to "this memory does not fire", never to
 *     "this memory is shown to the wrong tenant";
 *   - reads deduplicate and drop ids that no longer resolve, so a torn list
 *     repairs itself rather than accumulating rubbish;
 *   - reindexMemory() can rebuild an entry, so a loss is recoverable.
 *
 * A memory that silently stops firing is exactly the failure this feature is
 * most vulnerable to, so it is written down here and monitored rather than
 * assumed away.
 */

const PREFIX = "mira:xm";
const memKey = (tenantId: string, id: string) => `${PREFIX}:mem:${tenantId}:${id}`;
const stateKey = (tenantId: string, id: string) => `${PREFIX}:state:${tenantId}:${id}`;
const userKey = (tenantId: string, userId: string) => `${PREFIX}:user:${tenantId}:${userId}`;

/** A single cell or user list is capped so one runaway writer cannot make a key unreadable. */
export const MAX_IDS_PER_KEY = 500;

export type ExperienceMemoryRecord = {
  id: string;
  tenantId: string;
  userId: string;
  type: string;
  category: string | null;
  entity: { name: string | null; placeId: string | null } | null;
  experience: string;
  preference: string | null;
  sentiment: string;
  importance: string;
  confidence: number;
  scope: string;
  status: string;
  source: string;
  location: { lat: number; lon: number; precision: string; accuracyM?: number } | null;
  trigger: {
    entryRadiusM: number;
    exitRadiusM: number;
    dwellMs: number;
    cooldownMs: number;
    enabled: boolean;
    maxFires: number | null;
  };
  createdAtMs: number | null;
  updatedAtMs: number | null;
  supersedesId: string | null;
  indexKey?: string | null;
};

type IdList = string[];

async function readIds(key: string): Promise<IdList> {
  const raw = await kvGet<IdList>(key);
  return Array.isArray(raw) ? raw.filter((v) => typeof v === "string" && v.length > 0) : [];
}

/** Read-modify-write. See the race note at the top of this file. */
async function addId(key: string, id: string): Promise<void> {
  const ids = await readIds(key);
  if (ids.includes(id)) return;
  const next = [...ids, id];
  await kvSet(key, next.length > MAX_IDS_PER_KEY ? next.slice(next.length - MAX_IDS_PER_KEY) : next);
}

async function removeId(key: string, id: string): Promise<void> {
  const ids = await readIds(key);
  if (!ids.includes(id)) return;
  await kvSet(
    key,
    ids.filter((v) => v !== id),
  );
}

/**
 * Persist a new memory.
 *
 * The memory record is written before either index, so a crash between the two
 * leaves a memory that exists and can be listed by its owner but has not yet
 * been wired for firing — recoverable. The reverse order would leave an index
 * pointing at nothing.
 */
export async function saveMemory(
  input: Record<string, unknown>,
  nowMs: number = Date.now(),
): Promise<{ ok: true; memory: ExperienceMemoryRecord } | { ok: false; reason: string }> {
  const built = buildExperienceMemory({ ...input, createdAtMs: nowMs, updatedAtMs: nowMs });
  // The cores are untyped .mjs, so a refusal reason arrives as string|undefined.
  // A caller shows this to a user; "undefined" must never be the explanation.
  if (!built.ok) return { ok: false, reason: built.reason ?? "That memory could not be built." };

  const memory = built.memory as ExperienceMemoryRecord;
  memory.id = memory.id || `xm_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

  const cellKey = memory.location
    ? keyForMemory(memory.tenantId, memory.location, memory.trigger.entryRadiusM)
    : null;
  memory.indexKey = cellKey;

  await kvSet(memKey(memory.tenantId, memory.id), memory);
  await addId(userKey(memory.tenantId, memory.userId), memory.id);
  if (cellKey) await addId(cellKey, memory.id);

  return { ok: true, memory };
}

export async function getMemory(tenantId: string, id: string): Promise<ExperienceMemoryRecord | null> {
  if (!tenantId || !id) return null;
  // The tenant is part of the key, so one tenant cannot read another's memory
  // even by guessing an id. Isolation is structural, not a filter.
  return await kvGet<ExperienceMemoryRecord>(memKey(tenantId, id));
}

/** Everything this user has stored, newest-relevant first. For the privacy screen. */
export async function listMemories(
  tenantId: string,
  userId: string,
  opts: { includeRetired?: boolean } = {},
): Promise<ExperienceMemoryRecord[]> {
  if (!tenantId || !userId) return [];
  const ids = await readIds(userKey(tenantId, userId));
  const out: ExperienceMemoryRecord[] = [];
  for (const id of ids) {
    const m = await getMemory(tenantId, id);
    if (m) out.push(m);
  }
  if (opts.includeRetired) return out;
  return effectiveMemories(out, { tenantId }) as ExperienceMemoryRecord[];
}

/**
 * The memories that could matter at this position.
 *
 * A fixed number of key reads, then scope matching in memory. Ids that no
 * longer resolve are dropped from the cell on the way past, so a stale index
 * repairs itself instead of growing.
 */
export async function nearbyMemories(
  tenantId: string,
  lat: number,
  lon: number,
  place: { placeId?: string; name?: string; city?: string } = {},
  userId?: string,
): Promise<ExperienceMemoryRecord[]> {
  if (!tenantId) return [];

  const keys = keysToQuery(tenantId, lat, lon);
  const seen = new Set<string>();
  const found: ExperienceMemoryRecord[] = [];

  for (const key of keys) {
    const ids = await readIds(key);
    if (ids.length === 0) continue;
    const stale: string[] = [];

    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const m = await getMemory(tenantId, id);
      if (!m) {
        stale.push(id);
        continue;
      }
      if (matchesScope(m, { lat, lon, ...place }, { tenantId, userId })) found.push(m);
    }

    if (stale.length > 0) {
      const keep = ids.filter((v) => !stale.includes(v));
      await kvSet(key, keep);
    }
  }

  return effectiveMemories(found, { tenantId }) as ExperienceMemoryRecord[];
}

/* ── trigger state ─────────────────────────────────────────────────────── */

export type TriggerState = {
  inside: boolean;
  enteredAtMs: number | null;
  lastFiredAtMs: number | null;
  fireCount: number;
  seenEventIds: string[];
};

export async function getTriggerState(tenantId: string, id: string): Promise<TriggerState> {
  const s = await kvGet<TriggerState>(stateKey(tenantId, id));
  return s && typeof s === "object" ? s : (initialTriggerState() as TriggerState);
}

/**
 * Evaluate one location event against one memory and persist the result.
 *
 * The state is written back for every decision that changes it, not only when
 * something fires: "we are inside and waiting for dwell" and "the event id has
 * been seen" are both state that must survive, or a restart would re-notify.
 */
export async function evaluateMemory(
  memory: ExperienceMemoryRecord,
  event: { eventId?: string; lat: number; lon: number; accuracyM?: number },
  nowMs: number = Date.now(),
): Promise<{ decision: string; reason: string; distanceM: number; memory: ExperienceMemoryRecord }> {
  const before = await getTriggerState(memory.tenantId, memory.id);
  const r = evaluateLocationEvent({ memory, state: before, event, nowMs });

  if (JSON.stringify(r.state) !== JSON.stringify(before)) {
    await kvSet(stateKey(memory.tenantId, memory.id), r.state);
  }
  return { decision: r.decision, reason: r.reason, distanceM: r.distanceM, memory };
}

/** Everything that should be said at this position, already deduplicated and rate-limited. */
export async function evaluateArrival(
  tenantId: string,
  event: { eventId?: string; lat: number; lon: number; accuracyM?: number },
  place: { placeId?: string; name?: string; city?: string } = {},
  userId?: string,
  nowMs: number = Date.now(),
): Promise<{ fired: ExperienceMemoryRecord[]; considered: number; decisions: Record<string, number> }> {
  const candidates = await nearbyMemories(tenantId, event.lat, event.lon, place, userId);
  const fired: ExperienceMemoryRecord[] = [];
  const decisions: Record<string, number> = {};

  for (const m of candidates) {
    const r = await evaluateMemory(m, event, nowMs);
    decisions[r.decision] = (decisions[r.decision] ?? 0) + 1;
    if (r.decision === DECISIONS.FIRE) fired.push(m);
  }
  return { fired, considered: candidates.length, decisions };
}

/* ── the user's own control ────────────────────────────────────────────── */

/**
 * Change a memory the user owns.
 *
 * If the position or the fence changed, the cell index entry moves with it —
 * otherwise the memory would keep being looked for where it no longer is and
 * would quietly stop firing.
 */
export async function updateMemory(
  tenantId: string,
  id: string,
  patch: Record<string, unknown>,
  nowMs: number = Date.now(),
): Promise<{ ok: true; memory: ExperienceMemoryRecord } | { ok: false; reason: string }> {
  const existing = await getMemory(tenantId, id);
  if (!existing) return { ok: false, reason: "No such memory." };

  const rebuilt = buildExperienceMemory({
    ...existing,
    ...patch,
    // Identity and ownership are never patchable from a request body.
    id: existing.id,
    tenantId: existing.tenantId,
    userId: existing.userId,
    createdAtMs: existing.createdAtMs,
    updatedAtMs: nowMs,
  });
  if (!rebuilt.ok) return { ok: false, reason: rebuilt.reason ?? "That change could not be applied." };

  const memory = rebuilt.memory as ExperienceMemoryRecord;
  const nextCell = memory.location
    ? keyForMemory(tenantId, memory.location, memory.trigger.entryRadiusM)
    : null;
  memory.indexKey = nextCell;

  await kvSet(memKey(tenantId, id), memory);

  if (existing.indexKey !== nextCell) {
    if (existing.indexKey) await removeId(existing.indexKey, id);
    if (nextCell) await addId(nextCell, id);
  }
  return { ok: true, memory };
}

/** "Forget what I said about Tom's Pizza." Removes the record and every index entry. */
export async function deleteMemory(tenantId: string, id: string): Promise<boolean> {
  const existing = await getMemory(tenantId, id);
  if (!existing) return false;

  // Indexes first: an index entry pointing at a deleted memory is harmless and
  // self-repairing, whereas a memory left findable after deletion is not.
  if (existing.indexKey) await removeId(existing.indexKey, id);
  await removeId(userKey(tenantId, existing.userId), id);
  await kvDel(stateKey(tenantId, id));
  await kvDel(memKey(tenantId, id));
  return true;
}

/** "Actually the food is good now." Retires the old memory in favour of the new one. */
export async function supersedeMemory(
  tenantId: string,
  previousId: string,
  next: ExperienceMemoryRecord,
  nowMs: number = Date.now(),
): Promise<{ superseded: boolean; reason: string }> {
  const previous = await getMemory(tenantId, previousId);
  if (!previous) return { superseded: false, reason: "No earlier memory to retire." };

  const applied = applySupersession(previous, next, nowMs);
  if (!applied.changed) return { superseded: false, reason: applied.verdict.reason };

  await kvSet(memKey(tenantId, previousId), applied.previous);
  await kvSet(memKey(tenantId, next.id), applied.next);
  // A retired memory must stop being looked for, or it keeps warning about a
  // place the user has since told us is fine.
  if (previous.indexKey) await removeId(previous.indexKey, previousId);
  return { superseded: true, reason: applied.verdict.reason };
}

/** Switch a memory off without losing it. */
export async function setMemoryEnabled(
  tenantId: string,
  id: string,
  enabled: boolean,
): Promise<boolean> {
  const existing = await getMemory(tenantId, id);
  if (!existing) return false;
  const next = { ...existing, trigger: { ...existing.trigger, enabled }, status: existing.status ?? STATUS.ACTIVE };
  await kvSet(memKey(tenantId, id), next);
  return true;
}

/** Rebuild a memory's index entry. The repair path for the race described above. */
export async function reindexMemory(tenantId: string, id: string): Promise<boolean> {
  const m = await getMemory(tenantId, id);
  if (!m) return false;
  const cell = m.location ? keyForMemory(tenantId, m.location, m.trigger.entryRadiusM) : null;
  if (cell) await addId(cell, id);
  await addId(userKey(tenantId, m.userId), id);
  if (m.indexKey !== cell) await kvSet(memKey(tenantId, id), { ...m, indexKey: cell });
  return true;
}
