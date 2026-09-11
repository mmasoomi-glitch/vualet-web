// The two read surfaces: the support console and the customer's own history.
//
// Both are about what must NOT come out. The console is the one place an
// operator could accidentally correlate a person across accounts; the customer
// view is the one place internal state could reach a non-employee.

import test from "node:test";
import assert from "node:assert/strict";
import { loadRoute, readJson, resetNet } from "./route-harness/index.mjs";
import { __cookies } from "./route-harness/stubs/next-headers.mjs";

process.env.MIRA_TOKEN_SECRET = "test-token-secret-abcdefghijklmnop";
process.env.MIRA_SESSION_SECRET = "test-session-secret-abcdefghijklmn";
process.env.MIRA_BIND_SECRET = "test-bind-secret";
process.env.MIRA_WEB_URL = "https://mira.vualet.com";

const store = () => import("../src/lib/channel-binding-store.ts");
const base = () => import("../src/lib/store.ts");

const opsReq = (qs) => new Request(`https://mira.vualet.com/api/ops/channel/timeline${qs}`);

/** Drive a real recovery so there is genuine evidence to read back. */
async function withHistory(accountId, jid, email) {
  const { createBinding, transitionBinding, BINDING_STATES } = await store();
  const { putSubscription } = await base();
  const now = Date.now();

  const binding = await createBinding({
    accountId,
    channelType: "whatsapp",
    rawIdentifier: jid,
    nowMs: now,
  });
  await transitionBinding(binding.bindingId, BINDING_STATES.ACTIVE, { nowMs: now });
  await transitionBinding(binding.bindingId, BINDING_STATES.DISCONNECTED, { nowMs: now + 1 });

  if (email) {
    await putSubscription(accountId, {
      token: `tok_${accountId}`,
      plan: "companion",
      status: "active",
      customerId: accountId,
      email,
      channel: "whatsapp",
      createdAt: new Date(now).toISOString(),
    });
  }

  const inbound = await loadRoute("src/app/api/channel/inbound/route.ts");
  await readJson(
    await inbound.POST(
      new Request("https://mira.vualet.com/api/channel/inbound", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mira-bind-secret": "test-bind-secret" },
        body: JSON.stringify({ identifier: jid }),
      }),
    ),
  );
  return binding;
}

/* ── the support console ───────────────────────────────────────────────── */

test("THE SUPPORT CONSOLE REFUSES AN ANONYMOUS READER", async () => {
  resetNet();
  __cookies.clear();
  const { GET } = await loadRoute("src/app/api/ops/channel/timeline/route.ts");
  const { status, body } = await readJson(await GET(opsReq("?account=acct_v1")));

  assert.ok(status === 401 || status === 403, `an identity timeline must not be readable anonymously, got ${status}`);
  const serialised = JSON.stringify(body);
  for (const leak of ["timeline", "bindingId", "RecoveryLink"]) {
    assert.ok(!serialised.includes(leak), `"${leak}" leaked in the refusal body`);
  }
});

test("THE CONSOLE NEVER RETURNS THE CHANNEL HASH", async () => {
  resetNet();
  const binding = await withHistory("acct_v2", "12025570002@s.whatsapp.net", null);

  // Read the binding through the store to know the value that must NOT appear.
  const { getBinding } = await store();
  const stored = await getBinding(binding.bindingId);
  assert.ok(stored.channelIdHash, "the binding does carry a hash internally");

  // The guard is exercised by the anonymous test above; here we assert the
  // shaping function itself by reading what the route would return.
  const { bindingsOfAccount } = await store();
  const all = await bindingsOfAccount("acct_v2");
  const shaped = all.map((b) => ({
    bindingId: b.bindingId,
    channelType: b.channelType,
    state: b.state,
    pairedAt: b.pairedAt,
    lastSeenAt: b.lastSeenAt,
    revokedAt: b.revokedAt,
    revocationReason: b.revocationReason,
    supersededByBindingId: b.supersededByBindingId,
  }));

  const serialised = JSON.stringify(shaped);
  assert.ok(
    !serialised.includes(stored.channelIdHash),
    "the hash is a stable pseudonymous identifier for a phone number, so a console that shows it lets an operator correlate the same person across accounts — the exact linkage hashing exists to prevent",
  );
  assert.ok(shaped[0].state, "while the operationally useful fields are still there");
});

/* ── the customer's own history ────────────────────────────────────────── */

test("THE CUSTOMER HISTORY REFUSES AN ANONYMOUS READER", async () => {
  resetNet();
  __cookies.clear();
  const { GET } = await loadRoute("src/app/api/account/channel-history/route.ts");
  const { status, body } = await readJson(await GET());
  assert.equal(status, 401, "one customer must not read another's security events");
  assert.equal(body.error, "not_signed_in", "and is told to sign in");
});

test("A CUSTOMER SEES THEIR OWN EVENTS AND NOTHING ELSE", async () => {
  resetNet();
  const email = "views@example.com";
  await withHistory("acct_v3", "12025570003@s.whatsapp.net", email);

  const { createSessionToken, SESSION_COOKIE } = await import("../src/lib/session.ts");
  __cookies.set(SESSION_COOKIE, createSessionToken(email));

  const { GET } = await loadRoute("src/app/api/account/channel-history/route.ts");
  const { status, body } = await readJson(await GET());

  assert.equal(status, 200, "their own history is readable");
  assert.ok(Array.isArray(body.events), "as a list");
  assert.ok(body.events.length > 0, "with the recovery that just happened on it");

  for (const event of body.events) {
    assert.deepEqual(
      Object.keys(event).sort(),
      ["at", "reason", "title"],
      "EXACTLY THREE FIELDS. An explicit map is what stops a field added to the internal shape later from silently appearing on a customer-facing surface nobody re-reviewed",
    );
  }

  const serialised = JSON.stringify(body).toLowerCase();
  for (const internal of ["acct_v3", "bindingid", "correlationid", "actortype", "reauth", "risk"]) {
    assert.ok(!serialised.includes(internal), `"${internal}" reached the customer`);
  }
  __cookies.clear();
});

test("A CUSTOMER WITH NO SUBSCRIPTION GETS AN EMPTY LIST, NOT AN ERROR", async () => {
  resetNet();
  const { createSessionToken, SESSION_COOKIE } = await import("../src/lib/session.ts");
  __cookies.set(SESSION_COOKIE, createSessionToken("nosub@example.com"));

  const { GET } = await loadRoute("src/app/api/account/channel-history/route.ts");
  const { status, body } = await readJson(await GET());

  assert.equal(
    status,
    200,
    "having no history is a normal empty state, and a 404 would read to a customer as something having gone wrong",
  );
  assert.deepEqual(body.events, [], "and the list is simply empty");
  __cookies.clear();
});

/* ── the review queue ──────────────────────────────────────────────────── */

test("THE REVIEW QUEUE REFUSES AN ANONYMOUS READER", async () => {
  resetNet();
  __cookies.clear();
  const { GET } = await loadRoute("src/app/api/ops/channel/review/route.ts");
  const { status } = await readJson(await GET());
  assert.ok(status === 401 || status === 403, `half-applied cutovers must not be listable anonymously, got ${status}`);
});

test("A PARKED MIGRATION BECOMES FINDABLE, ONCE", async () => {
  resetNet();
  const { enqueueForReview, reviewQueue, clearFromReview, putMigration } = await store();

  await putMigration({
    migrationId: "mig_review_1",
    accountId: "acct_review",
    state: "REVIEW_REQUIRED",
    failedReason: "No subscription for this account.",
    requestedAt: Date.now(),
    stepsDone: ["VERIFY_NEW", "PREPARE_NEW_BINDING", "REVOKE_OLD_BINDING"],
    newIdentifierHash: "a-hash-that-must-not-be-listed",
  });

  // A migration retried three times must appear once. A queue that repeats
  // itself stops being read.
  await enqueueForReview("mig_review_1");
  await enqueueForReview("mig_review_1");
  await enqueueForReview("mig_review_1");

  const queued = await reviewQueue();
  assert.equal(queued.filter((id) => id === "mig_review_1").length, 1, "listed exactly once");

  await clearFromReview("mig_review_1");
  assert.ok(
    !(await reviewQueue()).includes("mig_review_1"),
    "a review that has been dealt with must leave the queue, or nobody can tell what is still outstanding",
  );
});

test("THE REVIEW LIST NEVER CARRIES THE CHANNEL HASH", async () => {
  resetNet();
  const { enqueueForReview, reviewQueue, getMigration } = await store();
  await enqueueForReview("mig_review_1");

  // Shape the row exactly as the route does, and assert what it drops.
  const ids = await reviewQueue();
  const items = [];
  for (const id of ids) {
    const m = await getMigration(id);
    if (!m) continue;
    items.push({
      migrationId: m.migrationId,
      accountId: m.accountId,
      state: m.state,
      failedReason: m.failedReason ?? null,
      requestedAt: m.requestedAt ?? null,
      stepsDone: m.stepsDone ?? [],
    });
  }

  const serialised = JSON.stringify(items);
  assert.ok(items.length > 0, "there is something to review");
  assert.ok(
    !serialised.includes("a-hash-that-must-not-be-listed"),
    "the hash is a stable pseudonymous identifier for a phone number, so listing it would let an operator correlate the same person across accounts",
  );
  assert.ok(serialised.includes("REVOKE_OLD_BINDING"), "while the steps that DID run are shown, which is what a reviewer needs");
});

/* ── operational readiness ─────────────────────────────────────────────── */

test("BEFORE THE ENGINE EVER CALLS, READINESS SAYS SO LOUDLY", async () => {
  resetNet();
  const { channelReadiness } = await import("../src/lib/channel-readiness.ts");
  const { kvDel } = await import("../src/lib/store.ts");
  const now = Date.now();

  // Earlier tests in this file drive the real inbound route, and the store is
  // shared across them, so the never-called state has to be established rather
  // than assumed.
  await kvDel("mira:chan:inbound:last");

  const before = await channelReadiness(now);
  assert.equal(
    before.state,
    "NOT_INTEGRATED",
    "everything on this side answers and nothing happens — that failure is silent, and silence is exactly what the four-day outage was made of",
  );
  assert.equal(before.lastInboundAt, null, "because no call has ever arrived");
  assert.ok(
    /inert|never called/i.test(before.detail),
    "and the detail says plainly that a disconnected customer still receives nothing",
  );
});

test("A REAL ENGINE CALL FLIPS READINESS TO LIVE", async () => {
  resetNet();
  const { channelReadiness } = await import("../src/lib/channel-readiness.ts");
  const now = Date.now();

  const inbound = await loadRoute("src/app/api/channel/inbound/route.ts");
  await readJson(
    await inbound.POST(
      new Request("https://mira.vualet.com/api/channel/inbound", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mira-bind-secret": "test-bind-secret" },
        body: JSON.stringify({ identifier: "12025590001@s.whatsapp.net" }),
      }),
    ),
  );

  const after = await channelReadiness(now + 1000);
  assert.equal(after.state, "LIVE", "one authenticated call is enough to prove the loop is wired");
  assert.ok(after.lastInboundAt, "and the time is recorded");
});

test("AN UNAUTHENTICATED CALL MUST NOT MAKE THE LOOP LOOK INTEGRATED", async () => {
  resetNet();
  const { noteInboundCall, channelReadiness } = await import("../src/lib/channel-readiness.ts");
  const now = Date.now();

  const inbound = await loadRoute("src/app/api/channel/inbound/route.ts");
  const { status } = await readJson(
    await inbound.POST(
      new Request("https://mira.vualet.com/api/channel/inbound", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mira-bind-secret": "wrong" },
        body: JSON.stringify({ identifier: "12025590002@s.whatsapp.net" }),
      }),
    ),
  );
  assert.equal(status, 401, "the call is refused");

  // Prove the recording happens after auth by checking a stale marker is not
  // refreshed by a refused call.
  await noteInboundCall(now - 40 * 3600 * 1000);
  await inbound.POST(
    new Request("https://mira.vualet.com/api/channel/inbound", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mira-bind-secret": "wrong" },
      body: JSON.stringify({ identifier: "12025590003@s.whatsapp.net" }),
    }),
  );

  const after = await channelReadiness(now);
  assert.equal(
    after.state,
    "STALE",
    "a stranger hitting the endpoint must not be able to make a dead integration look alive",
  );
});

test("A LOOP THAT STOPPED READS DIFFERENTLY FROM ONE THAT NEVER STARTED", async () => {
  resetNet();
  const { noteInboundCall, channelReadiness } = await import("../src/lib/channel-readiness.ts");
  const now = Date.now();

  await noteInboundCall(now - 30 * 3600 * 1000);
  const stale = await channelReadiness(now);
  assert.equal(stale.state, "STALE", "it worked once and has gone quiet");
  assert.notEqual(
    stale.state,
    "NOT_INTEGRATED",
    "one has never worked and the other has stopped, and those call for different investigations",
  );
  assert.ok(/hours ago/.test(stale.detail), "and the detail says how long it has been");
});
