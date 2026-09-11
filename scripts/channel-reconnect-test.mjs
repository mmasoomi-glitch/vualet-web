// Spending a reconnect link, and the rule that a reconnect can never quietly
// become a number change.
//
// The judge ruled that the link may only ever reactivate the binding it was
// issued for, and that redemption must prove LIVE control of the number rather
// than mere possession of the link. So redeeming hands back a pairing session,
// and the scan is the proof. The last tests here are the enforcement of that.

import test from "node:test";
import assert from "node:assert/strict";
import { loadRoute, readJson, resetNet } from "./route-harness/index.mjs";

process.env.MIRA_TOKEN_SECRET = "test-token-secret-abcdefghijklmnop";
process.env.MIRA_BIND_SECRET = "test-bind-secret";

const store = () => import("../src/lib/channel-binding-store.ts");
const load = () => loadRoute("src/app/api/channel/reconnect/route.ts");

function post(body) {
  return new Request("https://mira.vualet.com/api/channel/reconnect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A disconnected binding with a live reconnect link for it. */
async function disconnectedWithLink(accountId, jid) {
  const { createBinding, transitionBinding, issueRecovery, BINDING_STATES } = await store();
  const now = Date.now();
  const binding = await createBinding({ accountId, channelType: "whatsapp", rawIdentifier: jid, nowMs: now });
  await transitionBinding(binding.bindingId, BINDING_STATES.ACTIVE, { nowMs: now });
  await transitionBinding(binding.bindingId, BINDING_STATES.DISCONNECTED, { nowMs: now + 1 });
  const issued = await issueRecovery({
    accountId,
    oldBindingId: binding.bindingId,
    purpose: "RECONNECT_SAME_NUMBER",
    nowMs: now,
  });
  assert.equal(issued.ok, true, "a link was issued");
  return { binding, token: issued.token };
}

/* ── spending the link ─────────────────────────────────────────────────── */

test("SPENDING THE LINK HANDS BACK A PAIRING SESSION, NOT A RECONNECTION", async () => {
  resetNet();
  const { token, binding } = await disconnectedWithLink("acct_rc1", "12025551111@s.whatsapp.net");
  const { POST } = await load();
  const { status, body } = await readJson(await POST(post({ token })));

  assert.equal(status, 200, "a valid link is accepted");
  assert.ok(body.pairToken, "and returns a pairing token to scan");
  assert.equal(body.accountId, "acct_rc1", "for the right account");

  const { getBinding } = await store();
  const after = await getBinding(binding.bindingId);
  assert.equal(
    after.state,
    "DISCONNECTED",
    "THE BINDING IS NOT YET ACTIVE. Possession of a link is not proof the number is live now — the scan is",
  );
});

test("a malformed request is refused", async () => {
  resetNet();
  const { POST } = await load();
  for (const body of [{}, { token: "" }, { token: "   " }, { token: 5 }]) {
    const { status } = await readJson(await POST(post(body)));
    assert.equal(status, 400, `${JSON.stringify(body)} must be refused`);
  }
});

/* ── the failure modes a customer actually hits ────────────────────────── */

test("A USED LINK REPORTS AS USED, NOT AS BROKEN", async () => {
  resetNet();
  const { token } = await disconnectedWithLink("acct_rc2", "12025552222@s.whatsapp.net");
  const { POST } = await load();

  const first = await readJson(await POST(post({ token })));
  assert.equal(first.status, 200, "the first use works");

  const second = await readJson(await POST(post({ token })));
  assert.equal(second.status, 400, "the second does not");
  assert.equal(second.body.error, "link_used", "and says exactly which failure it was");
  assert.ok(
    /message the assistant again/i.test(second.body.message),
    "and tells the customer the one thing that gets them unstuck, rather than an apology",
  );
});

test("a forged link is refused and reveals nothing", async () => {
  resetNet();
  const { POST } = await load();
  const { status, body } = await readJson(await POST(post({ token: "totally-made-up-token-value" })));

  assert.equal(status, 400, "a guessed token is refused");
  assert.equal(body.error, "link_invalid", "as invalid");
  const serialised = JSON.stringify(body).toLowerCase();
  for (const leak of ["acct_", "account", "binding", "exists", "unknown number"]) {
    assert.ok(
      !serialised.includes(leak),
      `"${leak}" leaked — nothing here may reveal whether an account exists for a given number`,
    );
  }
});

test("EVERY FAILURE TELLS THE CUSTOMER HOW TO GET A NEW LINK", async () => {
  resetNet();
  const { POST } = await load();
  const { body } = await readJson(await POST(post({ token: "another-bad-token" })));
  assert.ok(
    /message the assistant again/i.test(body.message),
    "a dead end here would send the customer to support, which is the workflow this whole subsystem exists to remove",
  );
});

/* ── the rule that makes this safe ─────────────────────────────────────── */

test("A RECONNECT CAN NEVER BECOME A NUMBER CHANGE", async () => {
  resetNet();
  const jid = "12025553333@s.whatsapp.net";
  const { token } = await disconnectedWithLink("acct_rc3", jid);

  const { POST } = await load();
  const { body } = await readJson(await POST(post({ token })));
  const pairToken = body.pairToken;

  const { claimConnectWhatsapp } = await import("../src/lib/whatsapp-claim.ts");

  // A DIFFERENT WhatsApp account scans the QR the customer was handed.
  const attacker = await claimConnectWhatsapp(pairToken, "99999999999@s.whatsapp.net");
  assert.equal(
    attacker.ok,
    false,
    "a scan from a different number must be refused, or a link delivered to a broken number would silently move the account with no authentication at all",
  );
  assert.equal(attacker.reason, "foreign", "and refused as foreign");

  // The number the link was actually issued for still works.
  const rightful = await claimConnectWhatsapp(pairToken, jid);
  assert.equal(rightful.ok, true, "the number it was issued for reconnects normally");
});

test("THE DEVICE SUFFIX DOES NOT MAKE A CUSTOMER A STRANGER", async () => {
  resetNet();
  const { token } = await disconnectedWithLink("acct_rc4", "12025554444@s.whatsapp.net");
  const { POST } = await load();
  const { body } = await readJson(await POST(post({ token })));

  const { claimConnectWhatsapp } = await import("../src/lib/whatsapp-claim.ts");
  // WhatsApp reports the same account with a device id after re-pairing.
  const sameHuman = await claimConnectWhatsapp(body.pairToken, "12025554444:17@s.whatsapp.net");
  assert.equal(
    sameHuman.ok,
    true,
    "the JID is normalised before hashing, so a changed device id must not read as a different person",
  );
});

test("a link whose binding has vanished is refused rather than guessed at", async () => {
  resetNet();
  const { issueRecovery } = await store();
  const now = Date.now();
  const issued = await issueRecovery({
    accountId: "acct_rc5",
    oldBindingId: "bnd_does_not_exist",
    purpose: "RECONNECT_SAME_NUMBER",
    nowMs: now,
  });

  const { POST } = await load();
  const { status, body } = await readJson(await POST(post({ token: issued.token })));
  assert.equal(status, 409, "there is nothing to reconnect");
  assert.equal(body.error, "no_binding", "and it says so plainly");
});
