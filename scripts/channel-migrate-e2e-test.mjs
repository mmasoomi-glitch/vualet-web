// A number change, end to end: request it signed in, scan with the NEW
// number, and the cutover completes on the scan.
//
// This is the join between the two halves — the authenticated request and the
// proof of control — and the tests here are mostly about what happens when the
// wrong number scans, or the same scan arrives twice.

import test from "node:test";
import assert from "node:assert/strict";
import { loadRoute, readJson, resetNet } from "./route-harness/index.mjs";
import { __cookies } from "./route-harness/stubs/next-headers.mjs";

process.env.MIRA_TOKEN_SECRET = "test-token-secret-abcdefghijklmnop";
process.env.MIRA_SESSION_SECRET = "test-session-secret-abcdefghijklmn";
process.env.MIRA_BIND_SECRET = "test-bind-secret";

const store = () => import("../src/lib/channel-binding-store.ts");
const base = () => import("../src/lib/store.ts");



// The in-memory store is shared across every test in this file, and a number
// that has been migrated onto genuinely belongs to that account afterwards —
// so each test must aim at its own target, exactly as two real customers would.
const target = (n) => ({ e164: `+44770090${n}`, jid: `44770090${n}@s.whatsapp.net` });

async function signIn(email) {
  const { createSessionToken, SESSION_COOKIE } = await import("../src/lib/session.ts");
  __cookies.set(SESSION_COOKIE, createSessionToken(email));
}

function bindReq(token, whatsappId) {
  return new Request("https://mira.vualet.com/api/pair/bind", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-mira-bind-secret": "test-bind-secret" },
    body: JSON.stringify({ token, whatsappId }),
  });
}

/** A signed-in paying customer on their own number who has requested a move to `to`. */
async function requested(email, accountId, to) {
  const { putSubscription } = await base();
  const { createBinding, transitionBinding, BINDING_STATES } = await store();
  const now = Date.now();

  await putSubscription(accountId, {
    token: `tok_${accountId}`,
    plan: "companion",
    status: "active",
    customerId: accountId,
    email,
    channel: "whatsapp",
    createdAt: new Date(now).toISOString(),
    currentPeriodEnd: now + 18 * 86400000,
  });

  const oldBinding = await createBinding({
    accountId,
    channelType: "whatsapp",
    rawIdentifier: `${accountId}_old@s.whatsapp.net`,
    nowMs: now,
  });
  await transitionBinding(oldBinding.bindingId, BINDING_STATES.ACTIVE, { nowMs: now });

  await signIn(email);
  const { POST } = await loadRoute("src/app/api/channel/migrate/route.ts");
  const { status, body } = await readJson(
    await POST(
      new Request("https://mira.vualet.com/api/channel/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newNumber: to.e164 }),
      }),
    ),
  );
  assert.equal(status, 200, "the change was requested");
  __cookies.clear();
  return { oldBinding, accountId, ...body };
}

/* ── the join ──────────────────────────────────────────────────────────── */

test("SCANNING WITH THE NEW NUMBER COMMITS THE CHANGE", async () => {
  resetNet();
  const to = target("0801");
  const { pairToken, migrationId, oldBinding, accountId } = await requested("e2e1@example.com", "acct_e2e1", to);
  const { POST } = await loadRoute("src/app/api/pair/bind/route.ts");

  const { status } = await readJson(await POST(bindReq(pairToken, to.jid)));
  assert.equal(status, 200, "the scan succeeds");

  const { getMigration, getBinding, findBindingByChannel, channelIdHash } = await store();
  const { getSubscription } = await base();

  const migration = await getMigration(migrationId);
  assert.equal(migration.state, "COMPLETED", `the cutover ran: ${migration.failedReason ?? ""}`);

  const old = await getBinding(oldBinding.bindingId);
  assert.equal(old.state, "SUPERSEDED", "the old number stops working");

  const fresh = await findBindingByChannel("whatsapp", to.jid);
  assert.equal(fresh.state, "ACTIVE", "the new number works");
  assert.equal(fresh.accountId, accountId, "ON THE SAME ACCOUNT — not a new customer");

  const sub = await getSubscription(accountId);
  assert.equal(
    sub.whatsappIdHash,
    channelIdHash("whatsapp", to.jid),
    "and authority moved, which is what the engine actually reads",
  );
});

test("THE SUBSCRIPTION SURVIVES THE CHANGE UNTOUCHED", async () => {
  resetNet();
  const to = target("0802");
  const { pairToken, accountId } = await requested("e2e2@example.com", "acct_e2e2", to);
  const { getSubscription } = await base();
  const before = await getSubscription(accountId);

  const { POST } = await loadRoute("src/app/api/pair/bind/route.ts");
  await POST(bindReq(pairToken, to.jid));

  const after = await getSubscription(accountId);
  assert.equal(after.status, before.status, "status untouched");
  assert.equal(after.plan, before.plan, "plan untouched");
  assert.equal(
    after.currentPeriodEnd,
    before.currentPeriodEnd,
    "and the remaining days are exactly the days they had — the subscription belongs to the account, never to the number",
  );
});

/* ── the wrong number ──────────────────────────────────────────────────── */

test("A THIRD NUMBER CANNOT HIJACK THE PAIRING SESSION", async () => {
  resetNet();
  const to = target("0803");
  const { pairToken, migrationId, oldBinding } = await requested("e2e3@example.com", "acct_e2e3", to);
  const { POST } = await loadRoute("src/app/api/pair/bind/route.ts");

  const { status, body } = await readJson(await POST(bindReq(pairToken, "447700900111@s.whatsapp.net")));
  assert.equal(
    status,
    409,
    "a scan from a number other than the one the customer asked for must be refused, or a migration could be redirected between request and commit",
  );
  assert.equal(body.error, "foreign", "as foreign");

  const { getMigration, getBinding } = await store();
  const migration = await getMigration(migrationId);
  assert.notEqual(migration.state, "COMPLETED", "nothing was committed");

  const old = await getBinding(oldBinding.bindingId);
  assert.equal(
    old.state,
    "ACTIVE",
    "AND THE CUSTOMER STILL WORKS — a refused hijack must not cost them their existing number",
  );
});

/* ── retries ───────────────────────────────────────────────────────────── */

test("THE SAME SCAN ARRIVING TWICE COMMITS ONCE", async () => {
  resetNet();
  const to = target("0804");
  const { pairToken, accountId } = await requested("e2e4@example.com", "acct_e2e4", to);
  const { POST } = await loadRoute("src/app/api/pair/bind/route.ts");

  const first = await readJson(await POST(bindReq(pairToken, to.jid)));
  const second = await readJson(await POST(bindReq(pairToken, to.jid)));

  assert.equal(first.status, 200, "the first scan works");
  assert.equal(
    second.status,
    200,
    "a retried delivery must not be an error — a dropped response must not cost the customer their token",
  );

  const { bindingsOfAccount } = await store();
  const all = await bindingsOfAccount(accountId);
  assert.equal(all.length, 2, `exactly one old and one new binding, got ${all.length}`);
});

/* ── the ordinary pairing path is untouched ────────────────────────────── */

test("A NORMAL PAIRING IS COMPLETELY UNAFFECTED", async () => {
  resetNet();
  const { mintConnectToken } = await import("../src/lib/connect-token.ts");
  const { putConnect } = await base();

  const token = mintConnectToken();
  await putConnect({
    token,
    plan: "companion",
    status: "pending",
    channel: "whatsapp",
    customerId: "acct_normal",
    createdAt: new Date().toISOString(),
  });

  const { POST } = await loadRoute("src/app/api/pair/bind/route.ts");
  const { status, body } = await readJson(await POST(bindReq(token, "12025559999@s.whatsapp.net")));

  assert.equal(status, 200, "an ordinary bind still works");
  assert.equal(body.firstBind, true, "and reports a first bind");
  assert.equal(
    body.plan,
    "companion",
    "a record with no migrationId never enters the number-change block at all",
  );
});
