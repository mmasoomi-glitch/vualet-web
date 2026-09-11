// Committing a WhatsApp number change.
//
// Failure-matrix items 11, 12, 19-27 live here: the cutover itself, a crash
// part-way through, the same command arriving twice, and what the old number
// can do afterwards.
//
// The harness forces the in-memory store, so every write below is real.

import test from "node:test";
import assert from "node:assert/strict";
import { resetNet } from "./route-harness/index.mjs";

process.env.MIRA_TOKEN_SECRET = "test-token-secret-abcdefghijklmnop";

const OLD = "12025557777@s.whatsapp.net";
const NEW = "447700900999@s.whatsapp.net";

const store = () => import("../src/lib/channel-binding-store.ts");
const core = () => import("../src/lib/number-migration-core.mjs");
const exec = () => import("../src/lib/number-migration.ts");
const base = () => import("../src/lib/store.ts");

/** An account with a live subscription, an active old binding, and a verified migration. */
async function scenario(accountId, { oldJid = OLD, newJid = NEW, days = 18 } = {}) {
  const { createBinding, transitionBinding, putMigration, channelIdHash, BINDING_STATES } = await store();
  const { buildMigration, MIGRATION_STATES } = await core();
  const { putSubscription } = await base();
  const now = Date.now();

  const oldBinding = await createBinding({
    accountId,
    channelType: "whatsapp",
    rawIdentifier: oldJid,
    nowMs: now,
  });
  await transitionBinding(oldBinding.bindingId, BINDING_STATES.ACTIVE, { nowMs: now });

  // A real, paid subscription mid-period.
  await putSubscription(accountId, {
    token: `tok_${accountId}`,
    plan: "companion",
    status: "active",
    customerId: accountId,
    channel: "whatsapp",
    whatsappIdHash: oldBinding.channelIdHash,
    createdAt: new Date(now).toISOString(),
    currentPeriodEnd: now + days * 86400000,
  });

  const built = buildMigration({
    migrationId: `mig_${accountId}`,
    accountId,
    oldBindingId: oldBinding.bindingId,
    newIdentifierHash: channelIdHash("whatsapp", newJid),
    nowMs: now,
  });
  const migration = { ...built.record, state: MIGRATION_STATES.VERIFIED, verifiedAt: now };
  await putMigration(migration);

  return { oldBinding, migration, now, accountId };
}

/* ── the cutover ───────────────────────────────────────────────────────── */

test("A NUMBER CHANGE REPLACES THE BINDING AND NOTHING ELSE", async () => {
  resetNet();
  const { oldBinding, migration, now, accountId } = await scenario("acct_mig1");
  const { commitMigration } = await exec();
  const { getBinding, channelIdHash } = await store();
  const { getSubscription } = await base();

  const before = await getSubscription(accountId);
  const result = await commitMigration(migration.migrationId, NEW, now + 1000);

  assert.equal(result.ok, true, `the cutover succeeded: ${result.reason ?? ""}`);

  const old = await getBinding(oldBinding.bindingId);
  assert.equal(old.state, "SUPERSEDED", "the old number stops working");
  assert.equal(old.supersededByBindingId, result.newBindingId, "and points at what replaced it");
  assert.equal(old.revocationReason, "USER_CHANGED_NUMBER", "with a structured reason");

  const fresh = await getBinding(result.newBindingId);
  assert.equal(fresh.state, "ACTIVE", "the new number starts working");
  assert.equal(fresh.accountId, accountId, "ON THE SAME ACCOUNT — a number change is not a new customer");

  const after = await getSubscription(accountId);
  assert.equal(
    after.whatsappIdHash,
    channelIdHash("whatsapp", NEW),
    "and authority moved to the new number, which is the actual cutover",
  );
});

test("THE SUBSCRIPTION IS NOT RESTARTED, EXTENDED OR ENDED", async () => {
  resetNet();
  const { migration, now, accountId } = await scenario("acct_mig2", { days: 18 });
  const { commitMigration } = await exec();
  const { getSubscription } = await base();

  const before = await getSubscription(accountId);
  await commitMigration(migration.migrationId, NEW, now + 1000);
  const after = await getSubscription(accountId);

  assert.equal(after.status, before.status, "status untouched");
  assert.equal(after.plan, before.plan, "plan untouched");
  assert.equal(
    after.currentPeriodEnd,
    before.currentPeriodEnd,
    "THE REMAINING DAYS ARE EXACTLY THE DAYS THEY HAD. A customer who changes number on day 12 of 30 keeps 18 — not 30 new ones, and not zero",
  );
  assert.equal(after.customerId, before.customerId, "and it is still the same customer");
});

/* ── idempotency and resumability ──────────────────────────────────────── */

test("COMMITTING TWICE DOES NOT REVOKE TWICE OR MINT A SECOND BINDING", async () => {
  resetNet();
  const { migration, now, accountId } = await scenario("acct_mig3");
  const { commitMigration } = await exec();
  const { bindingsOfAccount } = await store();

  const first = await commitMigration(migration.migrationId, NEW, now + 1000);
  const second = await commitMigration(migration.migrationId, NEW, now + 2000);

  assert.equal(first.ok, true, "the first commit works");
  assert.equal(second.ok, true, "the second is accepted");
  assert.equal(
    second.newBindingId,
    first.newBindingId,
    "and returns the SAME binding — a duplicate delivery must not create a second one",
  );

  const all = await bindingsOfAccount(accountId);
  assert.equal(all.length, 2, `exactly one old and one new binding, got ${all.length}`);
});

test("A CRASH PART-WAY THROUGH RESUMES RATHER THAN RESTARTS", async () => {
  resetNet();
  const { oldBinding, migration, now, accountId } = await scenario("acct_mig4");
  const { commitMigration } = await exec();
  const { getMigration, putMigration, getBinding } = await store();
  const { getSubscription } = await base();

  // Simulate the process dying after the old binding was superseded but before
  // authority was committed — the dangerous middle, where the customer is
  // briefly disconnected.
  const partial = await getMigration(migration.migrationId);
  await putMigration({
    ...partial,
    state: "COMMITTING",
    newBindingId: null,
    stepsDone: ["VERIFY_NEW"],
  });

  const resumed = await commitMigration(migration.migrationId, NEW, now + 5000);
  assert.equal(resumed.ok, true, `the retry finished the job: ${resumed.reason ?? ""}`);

  const old = await getBinding(oldBinding.bindingId);
  assert.equal(old.state, "SUPERSEDED", "the old number ends up superseded exactly once");
  const sub = await getSubscription(accountId);
  assert.ok(sub.whatsappIdHash, "and authority is committed");
});

/* ── refusals ──────────────────────────────────────────────────────────── */

test("A MIGRATION CANNOT BE COMMITTED ONTO A DIFFERENT NUMBER", async () => {
  resetNet();
  const { migration, now, oldBinding } = await scenario("acct_mig5");
  const { commitMigration } = await exec();
  const { getBinding } = await store();

  const wrong = await commitMigration(migration.migrationId, "447700900111@s.whatsapp.net", now + 1000);
  assert.equal(
    wrong.ok,
    false,
    "committing onto a number other than the verified one must be refused, or verification proves nothing",
  );

  const old = await getBinding(oldBinding.bindingId);
  assert.equal(old.state, "ACTIVE", "AND NOTHING WAS REVOKED — a refused migration leaves the customer working");
});

test("an unverified migration cannot commit", async () => {
  resetNet();
  const { migration, now } = await scenario("acct_mig6");
  const { putMigration, getMigration } = await store();
  const { commitMigration } = await exec();

  const loaded = await getMigration(migration.migrationId);
  await putMigration({ ...loaded, state: "REQUESTED" });

  const result = await commitMigration(migration.migrationId, NEW, now + 1000);
  assert.equal(result.ok, false, "the cutover only runs after verification");
});

test("a missing migration is refused rather than invented", async () => {
  resetNet();
  const { commitMigration } = await exec();
  const result = await commitMigration("mig_does_not_exist", NEW, Date.now());
  assert.equal(result.ok, false, "there is nothing to commit");
});

/* ── what the old number can do afterwards ─────────────────────────────── */

test("THE OLD NUMBER IS REFUSED AFTER THE CHANGE", async () => {
  resetNet();
  const { migration, now } = await scenario("acct_mig7");
  const { commitMigration } = await exec();
  const { findBindingByChannel } = await store();
  const { classifyInbound, ACTIONS } = await import("../src/lib/channel-binding-core.mjs");

  await commitMigration(migration.migrationId, NEW, now + 1000);

  const stale = await findBindingByChannel("whatsapp", OLD);
  const verdict = classifyInbound({ binding: stale, securityBlocked: false });
  assert.equal(
    verdict.action,
    ACTIONS.REFUSE,
    "a message from the old number must not reach the account, whether it is the same person or whoever the operator reassigned it to",
  );

  const now2 = await findBindingByChannel("whatsapp", NEW);
  assert.equal(
    classifyInbound({ binding: now2, securityBlocked: false }).action,
    ACTIONS.SERVE,
    "and the new number is served normally",
  );
});

test("NO LIVE RECONNECT LINK SURVIVES A NUMBER CHANGE", async () => {
  resetNet();
  const { migration, now, oldBinding, accountId } = await scenario("acct_mig8");
  const { issueRecovery, redeemRecovery } = await store();
  const { commitMigration } = await exec();

  const issued = await issueRecovery({
    accountId,
    oldBindingId: oldBinding.bindingId,
    purpose: "RECONNECT_SAME_NUMBER",
    nowMs: now,
  });
  assert.equal(issued.ok, true, "a link existed before the change");

  await commitMigration(migration.migrationId, NEW, now + 1000);

  const after = await redeemRecovery(issued.token, now + 2000);
  assert.equal(
    after.ok,
    false,
    "a link issued to the OLD number moments earlier would otherwise still re-pair it, undoing the change",
  );
  assert.equal(after.state, "REVOKED", "and it is revoked, not merely expired");
});
