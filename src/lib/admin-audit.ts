import { kvGet, kvSet } from "@/lib/store";
import { createAuditLog } from "@/lib/audit-chain.mjs";

/**
 * APPEND-ONLY, TAMPER-EVIDENT ADMIN AUDIT TRAIL (backend-generalised §8; jury #62/#63).
 *
 * Storage model (WORM-oriented): every event is its own IMMUTABLE key
 * `mira:admin:audit:evt:<seq>`. We NEVER rewrite a single array — the previous
 * implementation did, which made a whole-history rewrite a single SET. Now:
 *   - `seq` is allocated by an ATOMIC counter (Redis INCR on Upstash) so two
 *     appends can never collide on a key or reuse a number.
 *   - each event is written WRITE-ONCE via SET ... NX; a rewrite is REJECTED.
 *   - there is NO update or delete method anywhere in this module.
 * The SHA256 hash chain (audit-chain.mjs) makes any post-hoc tampering
 * DETECTABLE by verifyAuditChain() regardless of the backend.
 *
 * PERSISTENCE LAYER (investigated): vualet-web has NO SQL database. store.ts is
 * a kv adapter with three tiers — Upstash Redis (REST), a durable JSON file
 * (MIRA_STORE_FILE), and an in-process Map. This is therefore the "kv/Redis"
 * branch of the jury directive.
 *
 * RESIDUAL / NOT-YET-PRODUCTION-GRADE:
 *   - Upstash: INCR guarantees unique seq + NX guarantees write-once, but two
 *     truly-concurrent appends could read the same predecessor hash and fork the
 *     chain (both point prevHash → row N). Admin actions are low-frequency and
 *     human-driven, so this is unlikely; verify() still detects a fork as a
 *     break. Strict serialization wants a single-writer lock or a real
 *     append-only DB (see below).
 *   - JSON-file / memory tier: nextSeq is read-modify-write, atomic only within
 *     one process. Fine for the single-process self-hosted box; not for
 *     multi-instance.
 *   - PRODUCTION TARGET: when a Postgres/Neon DB is introduced, move this table
 *     to an append-only table with the app role granted INSERT+SELECT only (no
 *     UPDATE/DELETE) and a trigger that RAISEs on UPDATE/DELETE. Reference DDL is
 *     in the migration note at the bottom of this file.
 */

export type AuditResult = "success" | "denied" | "error";

export type AuditInput = {
  adminId: string;
  role: string;
  action: string;
  target?: string;
  prevState?: unknown;
  newState?: unknown;
  reason?: string;
  requestId: string;
  result: AuditResult;
  ip?: string;
};

export type AuditRow = AuditInput & {
  seq: number;
  ts: string;
  prevHash: string;
  hash: string;
};

const SEQ_KEY = "mira:admin:audit:seq";
const evtKey = (seq: number) => `mira:admin:audit:evt:${seq}`;

// ---- Upstash REST (mirrors store.ts transport) — used only for atomic ops ----
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

// ---- Backend: atomic, write-once event storage over the kv layer ------------
const backend = {
  async nextSeq(): Promise<number> {
    if (useUpstash) return Number(await upstash(["INCR", SEQ_KEY]));
    // Local (single-process) read-modify-write. Documented residual above.
    const cur = (await kvGet<number>(SEQ_KEY)) ?? 0;
    const next = cur + 1;
    await kvSet(SEQ_KEY, next);
    return next;
  },
  async currentSeq(): Promise<number> {
    if (useUpstash) return Number((await upstash(["GET", SEQ_KEY])) ?? 0);
    return (await kvGet<number>(SEQ_KEY)) ?? 0;
  },
  async getEvent(seq: number): Promise<AuditRow | null> {
    if (useUpstash) {
      const raw = (await upstash(["GET", evtKey(seq)])) as string | null;
      return raw ? (JSON.parse(raw) as AuditRow) : null;
    }
    return kvGet<AuditRow>(evtKey(seq));
  },
  async putEventNX(seq: number, row: AuditRow): Promise<boolean> {
    if (useUpstash) {
      // SET key value NX → "OK" when written, null when the key already exists.
      const r = await upstash(["SET", evtKey(seq), JSON.stringify(row), "NX"]);
      return r === "OK";
    }
    // Emulate NX on the file/memory tier: never overwrite an existing key.
    if ((await kvGet<AuditRow>(evtKey(seq))) !== null) return false;
    await kvSet(evtKey(seq), row);
    return true;
  },
};

const log = createAuditLog(backend);

/** Append one immutable, hash-chained row. */
export async function appendAudit(input: AuditInput): Promise<AuditRow> {
  return log.append(input) as Promise<AuditRow>;
}

/** Recompute the chain and report the first break (if any). */
export async function verifyAuditChain(): Promise<{ ok: boolean; length: number; brokenAt?: number }> {
  return log.verify();
}

/** Most-recent rows first. Read-only; there is no delete/erase path by design. */
export async function getAuditLog(limit = 200): Promise<AuditRow[]> {
  return log.list(limit) as Promise<AuditRow[]>;
}

/*
 * FUTURE POSTGRES/NEON MIGRATION (append-only table) — reference DDL:
 *
 *   CREATE TABLE admin_audit (
 *     seq        bigserial PRIMARY KEY,
 *     ts         timestamptz NOT NULL DEFAULT now(),
 *     admin_id   text NOT NULL,
 *     role       text NOT NULL,
 *     action     text NOT NULL,
 *     target     text,
 *     prev_state jsonb,
 *     new_state  jsonb,
 *     reason     text,
 *     request_id text NOT NULL,
 *     result     text NOT NULL,
 *     ip         text,
 *     prev_hash  text NOT NULL,
 *     hash       text NOT NULL UNIQUE
 *   );
 *
 *   -- The application DB role gets INSERT + SELECT ONLY (defense in depth):
 *   REVOKE UPDATE, DELETE, TRUNCATE ON admin_audit FROM app_role;
 *   GRANT  INSERT, SELECT           ON admin_audit TO   app_role;
 *
 *   -- Trigger that RAISES on any UPDATE/DELETE, even from a privileged role:
 *   CREATE FUNCTION admin_audit_no_mutate() RETURNS trigger AS $$
 *   BEGIN RAISE EXCEPTION 'admin_audit is append-only (no UPDATE/DELETE)'; END;
 *   $$ LANGUAGE plpgsql;
 *   CREATE TRIGGER admin_audit_immutable
 *     BEFORE UPDATE OR DELETE ON admin_audit
 *     FOR EACH ROW EXECUTE FUNCTION admin_audit_no_mutate();
 */
