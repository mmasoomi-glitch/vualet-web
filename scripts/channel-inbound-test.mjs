// The engine's inbound callback, and the storage behind it.
//
// This is the "no manual recovery" loop end to end on this side: a customer
// whose session broke sends a message and gets a unique, single-use, ten-minute
// link back, with no employee involved.
//
// The harness blocks all outbound network and forces the in-memory store.

import test from "node:test";
import assert from "node:assert/strict";
import { loadRoute, readJson, resetNet } from "./route-harness/index.mjs";

const SECRET = "test-bind-secret";
process.env.MIRA_BIND_SECRET = SECRET;
process.env.MIRA_TOKEN_SECRET = "test-token-secret-abcdefghijklmnop";
process.env.MIRA_WEB_URL = "https://mira.vualet.com";

const JID = "12025551234@s.whatsapp.net";

function req(body, { secret = SECRET } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (secret !== null) headers["x-mira-bind-secret"] = secret;
  return new Request("https://mira.vualet.com/api/channel/inbound", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const load = () => loadRoute("src/app/api/channel/inbound/route.ts");
const store = () => import("../src/lib/channel-binding-store.ts");

/* ── the trust boundary ────────────────────────────────────────────────── */

test("THE ENGINE CALLBACK REFUSES AN UNAUTHENTICATED CALLER", async () => {
  resetNet();
  const { POST } = await load();
  for (const secret of [null, "", "wrong-secret", SECRET.slice(0, -1)]) {
    const { status } = await readJson(await POST(req({ identifier: JID }, { secret })));
    assert.equal(
      status,
      401,
      `secret ${JSON.stringify(secret)} was accepted; anyone who could reach this route could enumerate customers`,
    );
  }
});

test("a malformed body is refused before anything is looked up", async () => {
  resetNet();
  const { POST } = await load();
  for (const body of [{}, { identifier: "" }, { identifier: "   " }, { identifier: 5 }]) {
    const { status } = await readJson(await POST(req(body)));
    assert.equal(status, 400, `${JSON.stringify(body)} must be refused`);
  }
});

/* ── an unknown number ─────────────────────────────────────────────────── */

test("AN UNKNOWN NUMBER IS ONBOARDED, NEVER SILENTLY ATTACHED TO AN ACCOUNT", async () => {
  resetNet();
  const { POST } = await load();
  const { status, body } = await readJson(await POST(req({ identifier: "99999999999@s.whatsapp.net" })));

  assert.equal(status, 200, "the engine gets an answer");
  assert.equal(body.action, "OFFER_ONBOARDING", "a stranger is onboarded");
  assert.equal(body.accountId, null, "and is attached to no account");
  assert.ok(body.reply && body.reply.length > 0, "with something warm to say");
  assert.ok(!body.reconnectUrl, "and no reconnect link, which would be handing out account access");
});

/* ── the recovery loop ─────────────────────────────────────────────────── */

test("A DISCONNECTED CUSTOMER GETS A LINK, WITH NO EMPLOYEE INVOLVED", async () => {
  resetNet();
  const { createBinding, transitionBinding, BINDING_STATES } = await store();
  const now = Date.now();

  const binding = await createBinding({
    accountId: "acct_recovery",
    channelType: "whatsapp",
    rawIdentifier: JID,
    nowMs: now,
  });
  await transitionBinding(binding.bindingId, BINDING_STATES.ACTIVE, { nowMs: now });
  await transitionBinding(binding.bindingId, BINDING_STATES.DISCONNECTED, { nowMs: now + 1 });

  const { POST } = await load();
  const { status, body } = await readJson(await POST(req({ identifier: JID })));

  assert.equal(status, 200, "the engine gets an answer");
  assert.equal(body.action, "OFFER_RECONNECT", "the customer is offered reconnection");
  assert.equal(body.accountId, "acct_recovery", "attached to the right account");
  assert.ok(body.reconnectUrl, "A LINK IS MINTED AUTOMATICALLY — this is the whole point");
  assert.ok(
    body.expiresInSeconds > 0 && body.expiresInSeconds <= 600,
    `the link expires within ten minutes, got ${body.expiresInSeconds}`,
  );
  assert.ok(/reconnect\?t=/.test(body.reconnectUrl), "and points at the reconnect surface");
});

test("THE LINK IS A ONE-TIME OPAQUE TOKEN CARRYING NO ACCOUNT DATA", async () => {
  resetNet();
  const { createBinding, transitionBinding, BINDING_STATES } = await store();
  const now = Date.now();
  const jid = "12025550001@s.whatsapp.net";

  const b = await createBinding({ accountId: "acct_opaque", channelType: "whatsapp", rawIdentifier: jid, nowMs: now });
  await transitionBinding(b.bindingId, BINDING_STATES.ACTIVE, { nowMs: now });
  await transitionBinding(b.bindingId, BINDING_STATES.DISCONNECTED, { nowMs: now + 1 });

  const { POST } = await load();
  const { body } = await readJson(await POST(req({ identifier: jid })));
  const url = body.reconnectUrl;

  for (const leak of ["acct_opaque", "12025550001", "whatsapp.net", "@", b.bindingId]) {
    assert.ok(
      !url.includes(leak),
      `the reconnect URL contains "${leak}" — a link must carry an opaque token, never account data`,
    );
  }
  const token = decodeURIComponent(url.split("t=")[1]);
  assert.ok(token.length >= 40, `the token is long enough not to be guessed, got ${token.length} chars`);
});

test("A REPEATED HELLO REUSES THE LIVE LINK RATHER THAN MINTING A SECOND", async () => {
  resetNet();
  const { createBinding, transitionBinding, BINDING_STATES } = await store();
  const now = Date.now();
  const jid = "12025550002@s.whatsapp.net";

  const b = await createBinding({ accountId: "acct_repeat", channelType: "whatsapp", rawIdentifier: jid, nowMs: now });
  await transitionBinding(b.bindingId, BINDING_STATES.ACTIVE, { nowMs: now });
  await transitionBinding(b.bindingId, BINDING_STATES.DISCONNECTED, { nowMs: now + 1 });

  const { POST } = await load();
  const first = await readJson(await POST(req({ identifier: jid })));
  const second = await readJson(await POST(req({ identifier: jid })));

  assert.equal(
    second.body.reconnectUrl,
    first.body.reconnectUrl,
    "a second link would silently invalidate the first and leave the customer unsure which to tap",
  );
});

/* ── revoked and recycled numbers ──────────────────────────────────────── */

test("A REVOKED NUMBER IS REFUSED AND TOLD NOTHING ABOUT THE ACCOUNT", async () => {
  resetNet();
  const { createBinding, transitionBinding, BINDING_STATES, REASON_CODES } = await store();
  const now = Date.now();
  const jid = "12025550003@s.whatsapp.net";

  const b = await createBinding({ accountId: "acct_revoked", channelType: "whatsapp", rawIdentifier: jid, nowMs: now });
  await transitionBinding(b.bindingId, BINDING_STATES.ACTIVE, { nowMs: now });
  await transitionBinding(b.bindingId, BINDING_STATES.REVOKED, {
    nowMs: now + 1,
    reasonCode: REASON_CODES.USER_CHANGED_NUMBER,
  });

  const { POST } = await load();
  const { body } = await readJson(await POST(req({ identifier: jid })));

  assert.equal(body.action, "REFUSE", "a revoked number is refused");
  assert.ok(!body.reconnectUrl, "and gets no link back");
  assert.equal(
    body.accountId,
    null,
    "THE PREVIOUS OWNER IS NOT NAMED. A telecom operator may have reassigned this number, and telling the new holder whose account it was would hand them a stranger's identity",
  );
  assert.equal(body.bindingId, null, "nor the binding");
  const serialised = JSON.stringify(body).toLowerCase();
  assert.ok(!serialised.includes("acct_revoked"), "the account id appears nowhere in the payload");
});

/* ── the store's own guarantees ────────────────────────────────────────── */

test("A REVOKED BINDING CANNOT BE RESURRECTED", async () => {
  const { createBinding, transitionBinding, BINDING_STATES } = await store();
  const now = Date.now();

  const b = await createBinding({
    accountId: "acct_terminal",
    channelType: "whatsapp",
    rawIdentifier: "12025550004@s.whatsapp.net",
    nowMs: now,
  });
  await transitionBinding(b.bindingId, BINDING_STATES.ACTIVE, { nowMs: now });
  await transitionBinding(b.bindingId, BINDING_STATES.REVOKED, { nowMs: now + 1 });

  for (const to of [BINDING_STATES.ACTIVE, BINDING_STATES.PENDING, BINDING_STATES.DISCONNECTED]) {
    const r = await transitionBinding(b.bindingId, to, { nowMs: now + 2 });
    assert.equal(
      r.ok,
      false,
      `REVOKED -> ${to} was allowed; the legality check must live in the store so no caller can undo the recycled-number defence by writing the record directly`,
    );
  }
});

test("THE RAW NUMBER IS NEVER STORED", async () => {
  const { createBinding, channelIdHash } = await store();
  const raw = "447700900123@s.whatsapp.net";
  const b = await createBinding({
    accountId: "acct_hash",
    channelType: "whatsapp",
    rawIdentifier: raw,
    nowMs: Date.now(),
  });

  const serialised = JSON.stringify(b);
  assert.ok(!serialised.includes("447700900123"), "the number must not appear in the binding record");
  assert.ok(!serialised.includes("@s.whatsapp.net"), "nor the JID suffix");
  assert.equal(b.channelIdHash, channelIdHash("whatsapp", raw), "only a keyed hash, which answers equality and nothing else");
  assert.notEqual(
    b.channelIdHash,
    channelIdHash("whatsapp", "447700900124@s.whatsapp.net"),
    "and different numbers hash differently, or the lookup would collide accounts",
  );
});

test("REDEEMING A LINK TWICE FAILS THE SECOND TIME", async () => {
  const { createBinding, transitionBinding, issueRecovery, redeemRecovery, BINDING_STATES } = await store();
  const now = Date.now();

  const b = await createBinding({
    accountId: "acct_redeem",
    channelType: "whatsapp",
    rawIdentifier: "12025550005@s.whatsapp.net",
    nowMs: now,
  });
  await transitionBinding(b.bindingId, BINDING_STATES.ACTIVE, { nowMs: now });
  await transitionBinding(b.bindingId, BINDING_STATES.DISCONNECTED, { nowMs: now + 1 });

  const issued = await issueRecovery({
    accountId: "acct_redeem",
    oldBindingId: b.bindingId,
    purpose: "RECONNECT_SAME_NUMBER",
    nowMs: now,
  });
  assert.equal(issued.ok, true, "a link is issued");

  const first = await redeemRecovery(issued.token, now + 1000);
  assert.equal(first.ok, true, "the first redemption works");

  const second = await redeemRecovery(issued.token, now + 2000);
  assert.equal(second.ok, false, "the second does not");
  assert.equal(second.state, "USED", "and it reports a REPLAY, not a stale link");
});

test("A FORGED OR EXPIRED TOKEN IS REFUSED", async () => {
  const { issueRecovery, redeemRecovery } = await store();
  const now = Date.now();

  const forged = await redeemRecovery("not-a-real-token-at-all", now);
  assert.equal(forged.ok, false, "a guessed token is refused");
  assert.equal(forged.state, "NOT_FOUND", "and looks like nothing, leaking no account");

  const issued = await issueRecovery({
    accountId: "acct_expiry",
    oldBindingId: null,
    purpose: "RECONNECT_SAME_NUMBER",
    nowMs: now,
  });
  const late = await redeemRecovery(issued.token, now + 600001);
  assert.equal(late.ok, false, "eleven minutes later it is dead");
  assert.equal(late.state, "EXPIRED", "and reports as expired rather than replayed");
});

test("REVOKING AN ACCOUNT'S LINKS KILLS EVERY LIVE ONE", async () => {
  const { issueRecovery, redeemRecovery, revokeAllRecoveries } = await store();
  const now = Date.now();

  const issued = await issueRecovery({
    accountId: "acct_revoke_all",
    oldBindingId: null,
    purpose: "RECONNECT_SAME_NUMBER",
    nowMs: now,
  });
  assert.equal(issued.ok, true, "a link exists");

  const killed = await revokeAllRecoveries("acct_revoke_all", now + 10);
  assert.ok(killed >= 1, "it was revoked");

  const after = await redeemRecovery(issued.token, now + 20);
  assert.equal(after.ok, false, "and can no longer be spent");
  assert.equal(
    after.state,
    "REVOKED",
    "a binding that changes hands must leave no usable reconnect link behind it",
  );
});
