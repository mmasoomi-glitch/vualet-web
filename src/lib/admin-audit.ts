import { kvGet, kvSet } from "@/lib/store";
import { sha256Hex } from "@/lib/admin-crypto";

/**
 * APPEND-ONLY, TAMPER-EVIDENT ADMIN AUDIT TRAIL (backend-generalised §8).
 *
 * Every privileged admin action writes exactly one row here. Each row is
 * SHA256-chained to the previous one (row.hash = sha256(canonical(row) with
 * prevHash)), so altering or deleting any historical row breaks the chain and
 * `verifyAuditChain()` reports the break. Admins have NO API to edit or delete
 * rows — the store exposes append + read + verify only.
 *
 * Storage: the existing kv store (Upstash / durable JSON file / in-memory).
 * The whole log lives under one key as an ordered array. This is best-effort
 * for concurrency (same tradeoff the rest of this app already accepts) — a
 * production deployment should back this with an append-only DB table or WORM
 * object storage. The hash chain makes tampering DETECTABLE regardless of store.
 *
 * PRIVACY: rows carry operational metadata only (§1). Never write customer
 * conversation/message/memory content into prev/new state — callers pass status
 * fields, ids, and counts, not bodies.
 */

const LOG_KEY = "mira:admin:audit:log";
const GENESIS = "GENESIS";

export type AuditResult = "success" | "denied" | "error";

export type AuditInput = {
  adminId: string;
  role: string; // role(s) exercised, comma-joined
  action: string; // e.g. "admin.invite", "admin.role.assign", "session.revoke"
  target?: string; // id of the object acted on (admin id, session id, customer id…)
  prevState?: unknown; // metadata only
  newState?: unknown; // metadata only
  reason?: string;
  requestId: string;
  result: AuditResult;
  ip?: string;
};

export type AuditRow = AuditInput & {
  seq: number;
  ts: string; // ISO
  prevHash: string;
  hash: string;
};

function canonical(row: Omit<AuditRow, "hash">): string {
  // Deterministic field order — the chain hash must be reproducible on verify.
  return JSON.stringify([
    row.seq,
    row.ts,
    row.adminId,
    row.role,
    row.action,
    row.target ?? null,
    row.prevState ?? null,
    row.newState ?? null,
    row.reason ?? null,
    row.requestId,
    row.result,
    row.ip ?? null,
    row.prevHash,
  ]);
}

async function readLog(): Promise<AuditRow[]> {
  return (await kvGet<AuditRow[]>(LOG_KEY)) ?? [];
}

/** Append one immutable, hash-chained row. Returns the written row. */
export async function appendAudit(input: AuditInput): Promise<AuditRow> {
  const log = await readLog();
  const prev = log[log.length - 1];
  const seq = prev ? prev.seq + 1 : 1;
  const prevHash = prev ? prev.hash : GENESIS;
  const base: Omit<AuditRow, "hash"> = {
    ...input,
    seq,
    ts: new Date().toISOString(),
    prevHash,
  };
  const row: AuditRow = { ...base, hash: sha256Hex(canonical(base)) };
  log.push(row);
  await kvSet(LOG_KEY, log);
  return row;
}

/** Recompute the chain and report the first break (if any). */
export async function verifyAuditChain(): Promise<{ ok: boolean; length: number; brokenAt?: number }> {
  const log = await readLog();
  let prevHash = GENESIS;
  for (const row of log) {
    const { hash, ...rest } = row;
    const expect = sha256Hex(canonical(rest));
    if (row.prevHash !== prevHash || hash !== expect) {
      return { ok: false, length: log.length, brokenAt: row.seq };
    }
    prevHash = row.hash;
  }
  return { ok: true, length: log.length };
}

/** Most-recent rows first. Read-only; there is no delete/erase path by design. */
export async function getAuditLog(limit = 200): Promise<AuditRow[]> {
  const log = await readLog();
  return log.slice(-limit).reverse();
}
