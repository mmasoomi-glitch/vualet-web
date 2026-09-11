import { createHash } from "node:crypto";

/**
 * APPEND-ONLY AUDIT CHAIN — pure, storage-agnostic core (single source of truth).
 *
 * This module owns the SHA256 hash-chain math and the append-only algorithm. It
 * is dependency-free (only node:crypto) so BOTH the TypeScript admin store
 * (admin-audit.ts, which wires a real kv/Upstash backend) AND the runnable test
 * (scripts/admin-audit-test.mjs, which wires an in-memory backend) use the exact
 * same code path. Nothing here can UPDATE or DELETE a row — the only write is a
 * write-once `putEventNX`; a rewrite attempt is rejected.
 *
 * @typedef {Object} AuditInput
 * @property {string} adminId
 * @property {string} role
 * @property {string} action
 * @property {string} [target]
 * @property {unknown} [prevState]
 * @property {unknown} [newState]
 * @property {string} [reason]
 * @property {string} requestId
 * @property {"success"|"denied"|"error"} result
 * @property {string} [ip]
 *
 * @typedef {AuditInput & { seq:number, ts:string, prevHash:string, hash:string }} AuditRow
 *
 * @typedef {Object} AuditBackend
 * @property {() => Promise<number>} nextSeq       Atomically allocate the next seq (e.g. Redis INCR).
 * @property {() => Promise<number>} currentSeq    Read the highest allocated seq without incrementing.
 * @property {(seq:number) => Promise<AuditRow|null>} getEvent
 * @property {(seq:number, row:AuditRow) => Promise<boolean>} putEventNX  Write ONLY if absent; false if the key exists.
 *
 * @typedef {{ ok:boolean, length:number, brokenAt?:number }} ChainStatus
 */

export const GENESIS = "GENESIS";

/** Deterministic serialization — the chain hash must be reproducible on verify. */
export function canonicalize(/** @type {Omit<AuditRow,"hash">} */ row) {
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

export function computeHash(/** @type {Omit<AuditRow,"hash">} */ row) {
  return createHash("sha256").update(canonicalize(row)).digest("hex");
}

/**
 * Build the append-only log over a backend.
 *
 * `serialise` exists so a SECOND chain can be built over a different row shape
 * without duplicating the chaining, the append-only guard and the verifier.
 * The channel-event log needs actorType, correlationId and causationId, which
 * an admin row has no place for; stuffing channel events into admin rows with
 * a fabricated adminId would corrupt the trail that security and compliance
 * read. It DEFAULTS to the admin canonicalisation, so the existing chain
 * hashes byte-identically and every stored row still verifies.
 *
 * @param {AuditBackend} backend
 * @param {(row: any) => string} [serialise]
 */
export function createAuditLog(backend, serialise = canonicalize) {
  const hashOf = (row) => createHash("sha256").update(serialise(row)).digest("hex");
  return {
    /**
     * Append one immutable, hash-chained row.
     * @param {AuditInput} input
     * @returns {Promise<AuditRow>}
     */
    async append(input) {
      const seq = await backend.nextSeq();
      let prevHash = GENESIS;
      if (seq > 1) {
        const prev = await backend.getEvent(seq - 1);
        if (!prev) throw new Error(`audit chain gap: predecessor row #${seq - 1} missing`);
        prevHash = prev.hash;
      }
      const base = { ...input, seq, ts: new Date().toISOString(), prevHash };
      const row = /** @type {AuditRow} */ ({ ...base, hash: hashOf(base) });
      const written = await backend.putEventNX(seq, row);
      if (!written) {
        // The seq key already exists — this is the append-only guard firing.
        throw new Error(`append-only violation: row #${seq} already exists; refusing to overwrite`);
      }
      return row;
    },

    /**
     * Recompute the whole chain; report the first tampered/missing row.
     * @returns {Promise<ChainStatus>}
     */
    async verify() {
      const max = await backend.currentSeq();
      let prevHash = GENESIS;
      for (let s = 1; s <= max; s++) {
        const row = await backend.getEvent(s);
        if (!row) return { ok: false, length: max, brokenAt: s };
        const { hash, ...rest } = row;
        if (row.prevHash !== prevHash || hash !== hashOf(rest)) {
          return { ok: false, length: max, brokenAt: s };
        }
        prevHash = row.hash;
      }
      return { ok: true, length: max };
    },

    /**
     * Most-recent rows first. Read-only — there is no delete/erase path.
     * @param {number} [limit]
     * @returns {Promise<AuditRow[]>}
     */
    async list(limit = 200) {
      const max = await backend.currentSeq();
      const start = Math.max(1, max - limit + 1);
      /** @type {AuditRow[]} */
      const rows = [];
      for (let s = max; s >= start; s--) {
        const r = await backend.getEvent(s);
        if (r) rows.push(r);
      }
      return rows;
    },
  };
}
