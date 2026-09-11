// Requesting a WhatsApp number change from an authenticated surface.
//
// Failure-matrix item 13 (the new number already belongs to another account)
// and the SIM-swap defence live here. The session stub and a real HMAC session
// token are how the harness authenticates, exactly as the revenue route tests
// do it.

import test from "node:test";
import assert from "node:assert/strict";
import { loadRoute, readJson, resetNet } from "./route-harness/index.mjs";
import { __cookies } from "./route-harness/stubs/next-headers.mjs";

process.env.MIRA_TOKEN_SECRET = "test-token-secret-abcdefghijklmnop";
process.env.MIRA_SESSION_SECRET = "test-session-secret-abcdefghijklmn";

const store = () => import("../src/lib/channel-binding-store.ts");
const base = () => import("../src/lib/store.ts");
const load = () => loadRoute("src/app/api/channel/migrate/route.ts");

const OWNER = "owner@example.com";

function post(body) {
  return new Request("https://mira.vualet.com/api/channel/migrate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function signIn(email) {
  const { createSessionToken, SESSION_COOKIE } = await import("../src/lib/session.ts");
  __cookies.set(SESSION_COOKIE, createSessionToken(email));
}

function signOut() {
  __cookies.clear();
}

/** A signed-in customer with a paid subscription and an active WhatsApp binding. */
async function customer(email, accountId, jid) {
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
  });

  const binding = await createBinding({
    accountId,
    channelType: "whatsapp",
    rawIdentifier: jid,
    nowMs: now,
  });
  await transitionBinding(binding.bindingId, BINDING_STATES.ACTIVE, { nowMs: now });
  await signIn(email);
  return { binding, accountId };
}

/* ── the SIM-swap defence ──────────────────────────────────────────────── */

test("A NUMBER CHANGE CANNOT BE STARTED WITHOUT A SESSION", async () => {
  resetNet();
  signOut();
  const { POST } = await load();
  const { status, body } = await readJson(await POST(post({ newNumber: "+971501234567" })));

  assert.equal(
    status,
    401,
    "a SIM-swap attacker holds the phone, so only an email-established session may authorise moving the account",
  );
  assert.equal(body.error, "not_signed_in", "and is told to sign in");
});

test("a signed-in customer with no subscription is refused, not guessed at", async () => {
  resetNet();
  await signIn("nobody@example.com");
  const { POST } = await load();
  const { status, body } = await readJson(await POST(post({ newNumber: "+971501234567" })));
  assert.equal(status, 404, "there is no account to migrate");
  assert.equal(body.error, "no_subscription", "and it says so rather than picking a record");
  signOut();
});

/* ── input handling ────────────────────────────────────────────────────── */

test("a malformed or unusable number is refused warmly", async () => {
  resetNet();
  await customer(OWNER, "acct_req1", "12025551000@s.whatsapp.net");
  const { POST } = await load();

  for (const body of [{}, { newNumber: "" }, { newNumber: "   " }, { newNumber: 5 }]) {
    const { status } = await readJson(await POST(post(body)));
    assert.equal(status, 400, `${JSON.stringify(body)} must be refused`);
  }

  const bad = await readJson(await POST(post({ newNumber: "12" })));
  assert.equal(bad.status, 400, "a too-short number is refused");
  assert.equal(bad.body.error, "bad_number", "as a bad number");
  assert.ok(/country code/i.test(bad.body.message), "and the message says how to fix it");
  signOut();
});

/* ── the happy path ────────────────────────────────────────────────────── */

test("REQUESTING A CHANGE COMMITS NOTHING", async () => {
  resetNet();
  const { binding, accountId } = await customer("move@example.com", "acct_req2", "12025552000@s.whatsapp.net");
  const { POST } = await load();
  const { getBinding } = await store();
  const { getSubscription } = await base();

  const before = await getSubscription(accountId);
  const { status, body } = await readJson(await POST(post({ newNumber: "+447700900222" })));

  assert.equal(status, 200, "the request is accepted");
  assert.ok(body.migrationId, "a migration is recorded");
  assert.ok(body.pairToken, "and a pairing session is handed back for the new number");

  const old = await getBinding(binding.bindingId);
  assert.equal(
    old.state,
    "ACTIVE",
    "THE OLD NUMBER STILL WORKS. A number the customer merely typed is a claim, and committing on a claim would strand them on a number they cannot receive messages on",
  );
  const after = await getSubscription(accountId);
  assert.equal(after.whatsappIdHash, before.whatsappIdHash, "authority has not moved");
  signOut();
});

test("the migration is recorded as awaiting verification", async () => {
  resetNet();
  await customer("await@example.com", "acct_req3", "12025553000@s.whatsapp.net");
  const { POST } = await load();
  const { body } = await readJson(await POST(post({ newNumber: "+447700900333" })));

  const { getMigration } = await store();
  const migration = await getMigration(body.migrationId);
  assert.equal(migration.state, "VERIFICATION_REQUIRED", "nothing proceeds until the new number proves itself");
  assert.equal(migration.accountId, "acct_req3", "on the right account");
  assert.deepEqual(migration.stepsDone, [], "and no cutover step has run");
  signOut();
});

test("A NUMBER CHANGE IS ALWAYS AT LEAST ELEVATED RISK", async () => {
  resetNet();
  await customer("risk@example.com", "acct_req4", "12025554000@s.whatsapp.net");
  const { POST } = await load();
  const { body } = await readJson(await POST(post({ newNumber: "+447700900444" })));

  assert.notEqual(body.riskLevel, "NORMAL", "a number change never counts as a zero-signal event");
  assert.equal(body.requiresStrongAuth, true, "so it always demands more than a click");
  signOut();
});

/* ── the enumeration oracle ────────────────────────────────────────────── */

test("A NUMBER BELONGING TO ANOTHER ACCOUNT IS REFUSED WITHOUT NAMING IT", async () => {
  resetNet();
  // Somebody else already has this number.
  const { createBinding, transitionBinding, BINDING_STATES } = await store();
  const victimJid = "447700900555@s.whatsapp.net";
  const victim = await createBinding({
    accountId: "acct_victim",
    channelType: "whatsapp",
    rawIdentifier: victimJid,
    nowMs: Date.now(),
  });
  await transitionBinding(victim.bindingId, BINDING_STATES.ACTIVE, { nowMs: Date.now() });

  await customer("thief@example.com", "acct_req5", "12025555000@s.whatsapp.net");
  const { POST } = await load();
  const { status, body } = await readJson(await POST(post({ newNumber: "+447700900555" })));

  assert.equal(status, 409, "the number cannot be taken");
  assert.equal(body.error, "number_in_use", "and it is refused");

  const serialised = JSON.stringify(body).toLowerCase();
  for (const leak of ["acct_victim", "victim", "belongs", "another account", "already registered"]) {
    assert.ok(
      !serialised.includes(leak),
      `"${leak}" leaked — confirming a number has an account turns this route into an oracle for testing which numbers are customers`,
    );
  }
  signOut();
});

test("migrating to the number you already have is refused", async () => {
  resetNet();
  await customer("same@example.com", "acct_req6", "447700900666@s.whatsapp.net");
  const { POST } = await load();
  const { status, body } = await readJson(await POST(post({ newNumber: "+447700900666" })));
  assert.equal(status, 400, "there is nothing to migrate");
  assert.equal(body.error, "same_number", "and it says so plainly");
  signOut();
});

/* ── the customer whose old number is already dead ─────────────────────── */

test("A CUSTOMER WITH NO WORKING NUMBER CAN STILL MIGRATE", async () => {
  resetNet();
  const { binding } = await customer("dead@example.com", "acct_req7", "12025557000@s.whatsapp.net");
  const { transitionBinding, BINDING_STATES } = await store();
  await transitionBinding(binding.bindingId, BINDING_STATES.DISCONNECTED, { nowMs: Date.now() });

  const { POST } = await load();
  const { status, body } = await readJson(await POST(post({ newNumber: "+447700900777" })));

  assert.equal(
    status,
    200,
    "refusing here would mean the people who most need a number change — the ones whose old number is already gone — could not use it",
  );
  assert.ok(body.migrationId, "the migration starts");
  signOut();
});
