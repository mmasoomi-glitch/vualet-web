/**
 * ADMIN AUDIT APPEND-ONLY TEST (backend-generalised §8; jury #62/#63).
 *
 * Exercises the SAME hash-chain + append-only core that admin-audit.ts uses in
 * production (src/lib/audit-chain.mjs), over an in-memory backend. Proves:
 *   1. appending rows builds a valid chain that verifyAuditChain() accepts;
 *   2. an UPDATE (mutating a stored row) is DETECTED as a broken chain;
 *   3. a DELETE (removing a row) is DETECTED as a broken chain;
 *   4. a rewrite (write to an existing seq) is REJECTED by write-once putEventNX;
 *   5. the log exposes NO update/delete method at all.
 *
 * Run: npm run test:audit
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createAuditLog, computeHash } from "../src/lib/audit-chain.mjs";

function memBackend() {
  let seq = 0;
  const events = new Map();
  return {
    async nextSeq() {
      return ++seq;
    },
    async currentSeq() {
      return seq;
    },
    async getEvent(s) {
      return events.has(s) ? events.get(s) : null;
    },
    async putEventNX(s, row) {
      if (events.has(s)) return false; // write-once
      events.set(s, row);
      return true;
    },
    _events: events,
  };
}

function input(action) {
  return { adminId: "adm_test", role: "owner", action, requestId: "req_" + action, result: "success" };
}

test("append 3 rows → chain verifies intact", async () => {
  const backend = memBackend();
  const log = createAuditLog(backend);
  await log.append(input("a1"));
  await log.append(input("a2"));
  await log.append(input("a3"));
  const status = await log.verify();
  assert.equal(status.ok, true);
  assert.equal(status.length, 3);
  // Genesis linkage + forward chaining.
  assert.equal(backend._events.get(1).prevHash, "GENESIS");
  assert.equal(backend._events.get(2).prevHash, backend._events.get(1).hash);
  assert.equal(backend._events.get(3).prevHash, backend._events.get(2).hash);
});

test("UPDATE of a stored row is detected as tampering", async () => {
  const backend = memBackend();
  const log = createAuditLog(backend);
  await log.append(input("a1"));
  await log.append(input("a2"));
  await log.append(input("a3"));
  // Simulate a malicious in-place UPDATE of row #2's action.
  const row2 = backend._events.get(2);
  backend._events.set(2, { ...row2, action: "TAMPERED" });
  const status = await log.verify();
  assert.equal(status.ok, false);
  assert.equal(status.brokenAt, 2);
});

test("UPDATE that also recomputes the row hash still breaks the forward chain", async () => {
  const backend = memBackend();
  const log = createAuditLog(backend);
  await log.append(input("a1"));
  await log.append(input("a2"));
  await log.append(input("a3"));
  // A cleverer attacker fixes row #2's own hash — but row #3.prevHash no longer
  // matches, so the tamper still surfaces (at the next row).
  const row2 = backend._events.get(2);
  const forged = { ...row2, action: "TAMPERED" };
  const { hash: _omit, ...rest } = forged;
  forged.hash = computeHash(rest);
  backend._events.set(2, forged);
  const status = await log.verify();
  assert.equal(status.ok, false);
  assert.equal(status.brokenAt, 3); // row 2 self-consistent, but 3 points at the old hash
});

test("DELETE of a row is detected as a chain gap", async () => {
  const backend = memBackend();
  const log = createAuditLog(backend);
  await log.append(input("a1"));
  await log.append(input("a2"));
  await log.append(input("a3"));
  backend._events.delete(2);
  const status = await log.verify();
  assert.equal(status.ok, false);
  assert.equal(status.brokenAt, 2);
});

test("rewrite of an existing seq is rejected (write-once / append-only)", async () => {
  const backend = memBackend();
  const log = createAuditLog(backend);
  await log.append(input("a1"));
  await log.append(input("a2"));
  // Directly attempt to overwrite an existing event key.
  const overwritten = await backend.putEventNX(2, { ...backend._events.get(2), action: "REWRITE" });
  assert.equal(overwritten, false, "putEventNX must refuse to overwrite an existing seq");
  assert.equal(backend._events.get(2).action, "a2", "original row must be untouched");
});

test("log exposes no update/delete mutation API", () => {
  const log = createAuditLog(memBackend());
  assert.equal(typeof log.append, "function");
  assert.equal(typeof log.verify, "function");
  assert.equal(typeof log.list, "function");
  assert.equal(log.update, undefined);
  assert.equal(log.delete, undefined);
  assert.equal(log.remove, undefined);
});
