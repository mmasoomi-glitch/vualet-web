#!/usr/bin/env node
/**
 * DODO RECONCILIATION SWEEP — operator entry point.
 *
 * The reconciliation LOGIC lives in src/lib/reconcile-core.mjs and is pure and
 * network-free. THIS file is the only place that touches env, the network and
 * the durable store, which is what lets the whole decision surface be tested
 * against fixtures with no live API call (scripts/dodo-reconcile-test.mjs).
 *
 *   node scripts/dodo-reconcile.mjs            # DRY RUN (default) — writes nothing
 *   node scripts/dodo-reconcile.mjs --repair --writer-down   # repairs local records
 *   node scripts/dodo-reconcile.mjs --json     # machine-readable plan on stdout (ids redacted)
 *   node scripts/dodo-reconcile.mjs --json --raw-ids   # …with full ids, for dashboard lookups
 *
 * ENV
 *   DODO_API_KEY      required. Read once, never printed, never logged.
 *   DODO_MODE         "test" (default) | "live" — picks the API host. MUST match
 *                     the key. A live key against the test host sees NOTHING,
 *                     which would look exactly like "every subscription vanished".
 *   MIRA_STORE_FILE   the durable JSON store (self-hosted box), OR
 *   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN  (Vercel KV).
 *
 * EXIT CODES — the one table, shared with EXIT_MEANING in reconcile-core.mjs
 *   0  clean; provider and records agree, nothing needs a human
 *   1  FAILED: a read errored, or the run refused to start. Nothing was written
 *   2  findings need a human (dry-run changes pending, reviews, orphans)
 *   3  INCOMPLETE: a page cap truncated the walk, or repairs were refused as a
 *      whole. Work REMAINS. A cron job must treat 3 as "come back", never as OK
 *
 * THE FILE STORE NEEDS --writer-down, AND THE SCRIPT ENFORCES IT. src/lib/store.ts
 * loads MIRA_STORE_FILE into memory once and persists the WHOLE map on every
 * write, so a live web process does not merge with a --repair run, it
 * overwrites it. This is not documented and hoped for: a file-backed repair
 * REFUSES to start without --writer-down, and independently fingerprints the
 * store file before every write so a wrong assertion is caught by evidence
 * rather than trusted. See `fileWriterGuard`. Upstash is unaffected and needs
 * no flag.
 */

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";

import {
  runReconcile,
  formatReport,
  redactFinding,
  exitCodeFor,
  EXIT_MEANING,
  SWEEP_LIMITS,
} from "../src/lib/reconcile-core.mjs";

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
/** Repair requires the literal flag. There is no "--dry-run=false" spelling. */
const MODE = has("--repair") ? "repair" : "dry-run";
const JSON_OUT = has("--json");
/** Raw identifiers in --json output. Opt-in, because the default must be safe to pipe. */
const RAW_IDS = has("--raw-ids");
/**
 * The operator asserting, in person, that the web process is stopped. See
 * `fileWriterGuard` — without this a file-store repair REFUSES to run.
 */
const WRITER_DOWN = has("--writer-down");

// ---------------------------------------------------------------------------
// Dodo reader — READ-ONLY. There is no POST, PATCH or DELETE anywhere in this
// file, and that is deliberate: a reconciliation sweep must never be able to
// change the provider. Dodo is the source of truth; you do not edit the truth
// to match your copy of it.
// ---------------------------------------------------------------------------

function dodoBaseUrl() {
  return process.env.DODO_MODE === "live" ? "https://live.dodopayments.com" : "https://test.dodopayments.com";
}

function makeDodoReader(apiKey, { timeoutMs = SWEEP_LIMITS.requestTimeoutMs } = {}) {
  async function get(pathname, { allow404 = false } = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(`${dodoBaseUrl()}${pathname}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: ctl.signal,
      });
      if (allow404 && res.status === 404) return { status: 404, body: null };
      if (!res.ok) {
        // 429 and 5xx land here and become a phase error, which marks the sweep
        // incomplete, which refuses every repair. Being rate-limited must never
        // read as "the customer has no subscription".
        throw new Error(`GET ${pathname.split("?")[0]} -> ${res.status}`);
      }
      return { status: res.status, body: await res.json() };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Dodo list endpoints wrap rows in `items`; tolerate `data` too. */
  const rows = (body) => (Array.isArray(body?.items) ? body.items : Array.isArray(body?.data) ? body.data : []);

  return {
    async listSubscriptions({ pageNumber, pageSize }) {
      const { body } = await get(`/subscriptions?page_size=${pageSize}&page_number=${pageNumber}`);
      return { items: rows(body) };
    },
    async listPayments({ pageNumber, pageSize }) {
      const { body } = await get(`/payments?page_size=${pageSize}&page_number=${pageNumber}`);
      return { items: rows(body) };
    },
    async getSubscription(id) {
      const { status, body } = await get(`/subscriptions/${encodeURIComponent(id)}`, { allow404: true });
      // VERIFIED: 200 for a real id, 404 for an absent one. Anything else threw
      // above, so `found: false` here means Dodo positively said "not found" —
      // never "we could not ask". The distinction is the whole reason the
      // orphan phase can be trusted not to act on a network blip. (It does not
      // act on a 404 either; see planOrphans.)
      return { found: status !== 404, item: body };
    },
  };
}

// ---------------------------------------------------------------------------
// Store adapters. Same key space and the same on-disk shape as src/lib/store.ts
// (`mira:sub:<customerId>` -> {v: JSON, exp?}), because this reads and writes
// the very records that file owns. store.ts is another writer's; it is not
// edited, only matched.
// ---------------------------------------------------------------------------

const SUB_PREFIX = "mira:sub:";
const subKey = (customerId) => `${SUB_PREFIX}${customerId}`;
const connectKey = (token) => `mira:connect:${token}`;
const emailKey = (email) => `mira:subemail:${String(email).trim().toLowerCase()}`;
const CONNECT_TTL_S = 60 * 60 * 24 * 7; // matches putConnect in store.ts
const LOCK_SUFFIX = ".reconcile.lock";
/**
 * How long before a reconcile lock is debris rather than a sibling. Comfortably
 * longer than SWEEP_LIMITS.totalTimeoutMs (5 min), which is the longest a healthy
 * run can last, so a live sibling is never mistaken for a corpse.
 */
const LOCK_STALE_MS = 15 * 60 * 1000;

/**
 * THE CLOBBER GUARD — mutual exclusion against the live web process.
 *
 * THE HAZARD, STATED PLAINLY. src/lib/store.ts loads MIRA_STORE_FILE into an
 * in-process Map once, and every write persists that WHOLE map back over the
 * file. So a running web process does not merge with us — it overwrites us,
 * with a snapshot that may be minutes old, silently resurrecting every record
 * this sweep just repaired and discarding anything else written meanwhile. That
 * is data loss in both directions, and it produces no error on either side.
 *
 * WHAT THIS GUARD CAN AND CANNOT KNOW, honestly. I do not own store.ts and
 * cannot make it participate in a lock, so there is NO way to positively prove
 * from this side that the web process is down. What is provable is the
 * opposite: that somebody else IS writing. So the guard is built in two layers
 * that fail in different directions, and neither one alone would be enough:
 *
 *   LAYER 1 — FAIL CLOSED ON THE UNKNOWABLE. Liveness cannot be determined, so
 *     by the same rule this sweep applies to every other ambiguity, the answer
 *     is refuse. `--writer-down` is the operator asserting what only they can
 *     see. It is a deliberate, typed-out claim, not a default.
 *
 *   LAYER 2 — DETECT THE KNOWABLE, AND LET NO FLAG OVERRIDE IT. The store file
 *     is fingerprinted (size + mtime + SHA-256) before the first write and
 *     re-checked before every subsequent one. If it changed underneath us, a
 *     writer IS live — that is evidence, not inference — and the run stops
 *     immediately, `--writer-down` notwithstanding. An operator can be wrong
 *     about whether they stopped the server; they cannot be wrong about the
 *     file having changed.
 *
 * The escape hatch exists precisely so the guard does not get disabled
 * wholesale. Layer 2 is what stops the escape hatch from being a blank cheque.
 *
 * A lock file additionally keeps two RECONCILE runs off each other, which is
 * the one collision this side can fully control.
 *
 * Upstash is not affected and gets none of this friction: each key is written
 * independently over REST, so there is no whole-map read-modify-write to lose.
 *
 * @param {string} file  the MIRA_STORE_FILE path
 * @param {{ writerDown?: boolean, clock?: () => number, pid?: number, log?: (m: string) => void }} [opts]
 */
export function fileWriterGuard(file, opts = {}) {
  const writerDown = opts.writerDown === true;
  const clock = typeof opts.clock === "function" ? opts.clock : () => Date.now();
  const pid = opts.pid ?? process.pid;
  const log = typeof opts.log === "function" ? opts.log : () => {};
  const lockPath = `${file}${LOCK_SUFFIX}`;
  let held = false;
  /** @type {any} */
  let mark = null;

  /** size + mtime + content hash. Any one of the three moving means a writer. */
  function fingerprint() {
    if (!existsSync(file)) return { missing: true };
    const st = statSync(file);
    return {
      size: st.size,
      mtimeMs: st.mtimeMs,
      hash: createHash("sha256").update(readFileSync(file)).digest("hex"),
    };
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  return {
    lockPath,
    fingerprint,
    /**
     * @returns {{ ok: true } | { ok: false, reason: string }}
     */
    acquire() {
      // LAYER 1 first, because it is free and it is the common refusal.
      if (!writerDown) {
        return {
          ok: false,
          reason:
            "REFUSING TO REPAIR a file-backed store without --writer-down. src/lib/store.ts rewrites the " +
            "WHOLE store file on every one of its own writes, so a running web process will silently " +
            "overwrite these repairs and restore stale records. This cannot be detected from here in " +
            "advance, and an undetectable data-loss risk is exactly the kind of ambiguity this sweep " +
            "refuses rather than guesses at. Stop the web process, then re-run with --writer-down. " +
            "(Upstash-backed stores need none of this.)",
        };
      }

      // One reconcile run at a time. This collision IS fully controllable here.
      try {
        writeFileSync(lockPath, JSON.stringify({ pid, startedAt: clock() }), { flag: "wx" });
        held = true;
      } catch (err) {
        if (err && err.code !== "EEXIST") {
          return { ok: false, reason: `could not take the reconcile lock at ${lockPath}: ${err.message}` };
        }
        // A lock already exists. It is either a live sibling run or the debris
        // of a crashed one. Age decides, so a crash cannot wedge the tool shut
        // forever — which is the failure mode that gets locks deleted by hand.
        let age = Infinity;
        let holder = "unknown";
        try {
          const prev = JSON.parse(readFileSync(lockPath, "utf8"));
          age = clock() - (prev.startedAt ?? 0);
          holder = String(prev.pid ?? "unknown");
        } catch {
          /* unreadable lock: treat as debris and let the age check reclaim it */
        }
        if (age <= LOCK_STALE_MS) {
          return {
            ok: false,
            reason:
              `another reconcile run (pid ${holder}) holds ${lockPath} and started ` +
              `${Math.round(age / 1000)}s ago. Two sweeps writing the same store file is the very ` +
              `collision this guard exists to stop. Wait for it, or remove the lock if you know it died.`,
          };
        }
        log(`[reconcile] reclaiming a stale lock from pid ${holder} (${Math.round(age / 1000)}s old)`);
        try {
          writeFileSync(lockPath, JSON.stringify({ pid, startedAt: clock() }));
          held = true;
        } catch (e2) {
          return { ok: false, reason: `could not reclaim the stale lock: ${e2.message}` };
        }
      }

      mark = fingerprint();
      return { ok: true };
    },

    /**
     * LAYER 2. Called immediately before every write. Throws — loudly and
     * without an override — when the file moved under us.
     */
    beforeWrite() {
      const now = fingerprint();
      if (!same(mark, now)) {
        throw new Error(
          "ABORTED: the store file changed underneath this run. Something else is writing to it right " +
            "now — most likely the web process, which --writer-down asserted was stopped. That " +
            "assertion was wrong, and no flag overrides direct evidence. Nothing further was written.",
        );
      }
    },

    /** Adopt our own write as the new baseline. */
    afterWrite() {
      mark = fingerprint();
    },

    /**
     * A last look once the repairs are done. Catches the process that woke up
     * and clobbered us AFTER the final write, which nothing before this point
     * could have seen.
     * @returns {{ ok: boolean, reason?: string }}
     */
    assertIntact() {
      const now = fingerprint();
      if (same(mark, now)) return { ok: true };
      return {
        ok: false,
        reason:
          "the store file changed AFTER this run finished writing. A live writer has probably already " +
          "overwritten some or all of these repairs. Re-run once the web process is genuinely stopped, " +
          "and treat this run's result as unreliable.",
      };
    },

    release() {
      if (!held) return;
      held = false;
      try {
        unlinkSync(lockPath);
      } catch {
        /* already gone; nothing to do */
      }
    },
  };
}

function fileStore(file, guard = null) {
  /** @type {Record<string, {v: string, exp?: number}>} */
  let map = {};
  if (existsSync(file)) {
    try {
      map = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      throw new Error(`MIRA_STORE_FILE at ${file} is not readable JSON; refusing to run`);
    }
  }
  const alive = (e) => e && (!e.exp || e.exp > Date.now());

  function persist() {
    // LAYER 2 OF THE CLOBBER GUARD, on the write path itself rather than only
    // at start-up, so a web process that wakes up mid-run is caught before the
    // next record rather than after the last one.
    if (guard) guard.beforeWrite();
    const out = {};
    for (const [k, e] of Object.entries(map)) if (alive(e)) out[k] = e;
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.reconcile.tmp`;
    writeFileSync(tmp, JSON.stringify(out));
    renameSync(tmp, file); // atomic on the same volume, same as store.ts
    if (guard) guard.afterWrite();
  }

  return {
    async getSubscription(customerId) {
      const e = map[subKey(customerId)];
      if (!alive(e)) return null;
      try {
        return JSON.parse(e.v);
      } catch {
        // An unparseable record is AMBIGUITY, not a cancelled customer. Null
        // makes the sweep report "no record" and touch nothing.
        return null;
      }
    },
    async listSubscriptionCustomerIds() {
      return Object.keys(map)
        .filter((k) => k.startsWith(SUB_PREFIX) && alive(map[k]))
        .map((k) => k.slice(SUB_PREFIX.length));
    },
    async putSubscription(customerId, rec) {
      map[subKey(customerId)] = { v: JSON.stringify(rec) };
      // Keep the reverse email index that store.ts's putSubscription maintains,
      // so a repaired record stays reachable from a session email.
      if (rec?.email) map[emailKey(rec.email)] = { v: JSON.stringify(customerId) };
      persist();
    },
    async putConnect(rec) {
      if (!rec?.token) return;
      map[connectKey(rec.token)] = { v: JSON.stringify(rec), exp: Date.now() + CONNECT_TTL_S * 1000 };
      persist();
    },
  };
}

function upstashStore(url, token) {
  async function cmd(args) {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Upstash ${res.status}`);
    return (await res.json()).result;
  }
  const parse = (raw) => {
    if (raw == null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };
  return {
    async getSubscription(customerId) {
      return parse(await cmd(["GET", subKey(customerId)]));
    },
    async listSubscriptionCustomerIds() {
      /** @type {string[]} */
      const keys = [];
      let cursor = "0";
      // SCAN, never KEYS: KEYS blocks the server, and this runs against the
      // same instance serving live entitlement checks.
      do {
        const [next, batch] = await cmd(["SCAN", cursor, "MATCH", `${SUB_PREFIX}*`, "COUNT", 200]);
        cursor = String(next);
        for (const k of batch ?? []) keys.push(String(k).slice(SUB_PREFIX.length));
      } while (cursor !== "0");
      return keys;
    },
    async putSubscription(customerId, rec) {
      await cmd(["SET", subKey(customerId), JSON.stringify(rec)]);
      if (rec?.email) await cmd(["SET", emailKey(rec.email), JSON.stringify(customerId)]);
    },
    async putConnect(rec) {
      if (!rec?.token) return;
      await cmd(["SET", connectKey(rec.token), JSON.stringify(rec), "EX", CONNECT_TTL_S]);
    },
  };
}

function makeStore(guard = null) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && tok) return { store: upstashStore(url, tok), kind: "upstash", file: null };
  const file = process.env.MIRA_STORE_FILE;
  if (file) return { store: fileStore(file, guard), kind: "file", file };
  throw new Error(
    "No durable store configured. Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN, or MIRA_STORE_FILE. " +
      "Refusing to reconcile against an in-memory store that holds nothing.",
  );
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

/**
 * @param {{ mode?: string, jsonOut?: boolean, rawIds?: boolean, writerDown?: boolean }} [o]
 *   Defaults come from argv; passing them explicitly is what lets the test file
 *   drive the guard without re-launching a process.
 * @returns {Promise<0|1|2|3>} see EXIT_MEANING in reconcile-core.mjs
 */
export async function main(o = {}) {
  const mode = o.mode ?? MODE;
  const jsonOut = o.jsonOut ?? JSON_OUT;
  const rawIds = o.rawIds ?? RAW_IDS;
  const writerDown = o.writerDown ?? WRITER_DOWN;

  const apiKey = process.env.DODO_API_KEY;
  if (!apiKey) {
    console.error("DODO_API_KEY unset — cannot ask the provider anything. Nothing was read or written.");
    return 1;
  }

  // The guard is built BEFORE the store, because the store's write path needs
  // it, and it is only armed for the combination that is actually dangerous:
  // a repair against a file-backed store.
  const usingFile = !(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) &&
    Boolean(process.env.MIRA_STORE_FILE);
  const guard =
    mode === "repair" && usingFile
      ? fileWriterGuard(String(process.env.MIRA_STORE_FILE), {
          writerDown,
          log: (m) => console.error(m),
        })
      : null;

  if (guard) {
    const got = guard.acquire();
    if (!got.ok) {
      console.error(`[reconcile] ${got.reason}`);
      console.error("[reconcile] Nothing was read or written.");
      return 1;
    }
  }

  try {
    const { store, kind } = makeStore(guard);

    if (mode === "repair") {
      console.error(
        `[reconcile] REPAIR MODE against the ${kind} store in DODO_MODE=${process.env.DODO_MODE ?? "test"}.` +
          (kind === "file"
            ? " Writer asserted down (--writer-down); the store file is fingerprinted before every write."
            : ""),
      );
    }

    const { plan, applied } = await runReconcile(
      { dodo: makeDodoReader(apiKey), store },
      { mode, log: (m) => console.error(m) },
    );

    // The final look: did anything overwrite us after the last write?
    if (guard && applied.wrote > 0) {
      const intact = guard.assertIntact();
      if (!intact.ok) {
        console.error(`[reconcile] ALERT: ${intact.reason}`);
        if (!jsonOut) console.log(formatReport(plan, applied));
        return 1;
      }
    }

    if (jsonOut) {
      // REDACTED BY DEFAULT, even here. --json is the mode most likely to be
      // piped somewhere it will be retained, so it gets the same treatment as
      // the human report; --raw-ids is the deliberate opt-in for an operator
      // who actually needs to look a customer up in the Dodo dashboard.
      console.log(
        JSON.stringify(
          {
            mode: applied.mode,
            complete: plan.complete,
            errors: plan.errors,
            truncated: plan.truncated,
            stats: plan.stats,
            findings: rawIds ? plan.findings.map(({ effect, ...f }) => f) : plan.findings.map(redactFinding),
            wrote: applied.wrote,
            wouldWrite: applied.wouldWrite,
            refused: applied.refused,
            exitCode: exitCodeFor(plan, applied),
            exitMeaning: EXIT_MEANING[exitCodeFor(plan, applied)],
          },
          null,
          2,
        ),
      );
    } else {
      console.log(formatReport(plan, applied));
    }

    // ONE table of exit-code meanings, shared with the report and the docs
    // above, so a scheduler and a human can never read this run differently.
    return exitCodeFor(plan, applied);
  } finally {
    if (guard) guard.release();
  }
}

// Only self-executes when RUN directly, so the test file can import this module
// without it reaching for the network.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      // Never print the error object raw — a fetch error can carry the request
      // headers, and those carry the API key.
      console.error(`[reconcile] FAILED: ${err && err.message ? err.message : "unknown error"}`);
      console.error("[reconcile] Nothing was written.");
      process.exit(1);
    },
  );
}
