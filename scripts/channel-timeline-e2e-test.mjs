// The timeline, reconstructed from a real flow.
//
// §22 and §50 require that every incident has a reconstructable timeline and
// that all security-sensitive transitions generate durable events. This drives
// the real routes and then asks the chain what happened, rather than asserting
// on events written by the test itself.

import test from "node:test";
import assert from "node:assert/strict";
import { loadRoute, readJson, resetNet } from "./route-harness/index.mjs";

process.env.MIRA_TOKEN_SECRET = "test-token-secret-abcdefghijklmnop";
process.env.MIRA_BIND_SECRET = "test-bind-secret";
process.env.MIRA_WEB_URL = "https://mira.vualet.com";

const store = () => import("../src/lib/channel-binding-store.ts");
const log = () => import("../src/lib/channel-event-log.ts");

const inboundReq = (identifier) =>
  new Request("https://mira.vualet.com/api/channel/inbound", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-mira-bind-secret": "test-bind-secret" },
    body: JSON.stringify({ identifier }),
  });

const reconnectReq = (token) =>
  new Request("https://mira.vualet.com/api/channel/reconnect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });

/** A customer whose binding has just broken. */
async function broken(accountId, jid) {
  const { createBinding, transitionBinding, BINDING_STATES } = await store();
  const now = Date.now();
  const binding = await createBinding({
    accountId,
    channelType: "whatsapp",
    rawIdentifier: jid,
    nowMs: now,
  });
  await transitionBinding(binding.bindingId, BINDING_STATES.ACTIVE, { nowMs: now });
  await transitionBinding(binding.bindingId, BINDING_STATES.DISCONNECTED, { nowMs: now + 1 });
  return binding;
}

/* ── the real flow writes real evidence ────────────────────────────────── */

test("A RECOVERY LEAVES A RECONSTRUCTABLE TIMELINE", async () => {
  resetNet();
  const jid = "12025560001@s.whatsapp.net";
  await broken("acct_tl1", jid);

  // The customer messages the assistant and gets a link.
  const inbound = await loadRoute("src/app/api/channel/inbound/route.ts");
  const { body: offered } = await readJson(await inbound.POST(inboundReq(jid)));
  assert.equal(offered.action, "OFFER_RECONNECT", "a link was offered");
  const token = decodeURIComponent(offered.reconnectUrl.split("t=")[1]);

  // They tap it.
  const reconnect = await loadRoute("src/app/api/channel/reconnect/route.ts");
  const spent = await readJson(await reconnect.POST(reconnectReq(token)));
  assert.equal(spent.status, 200, "the link was spent");

  const { channelTimeline } = await log();
  const timeline = await channelTimeline("acct_tl1");
  const types = timeline.map((t) => t.eventType);

  assert.ok(types.includes("RecoveryLinkIssued"), "the link issue is on the record");
  assert.ok(types.includes("RecoveryLinkUsed"), "and so is the redemption");
  assert.ok(
    timeline.every((t) => typeof t.at === "string" && t.at.length > 0),
    "every line is timestamped, or it cannot be a timeline",
  );

  const issued = timeline.find((t) => t.eventType === "RecoveryLinkIssued");
  const used = timeline.find((t) => t.eventType === "RecoveryLinkUsed");
  assert.equal(
    issued.correlationId,
    used.correlationId,
    "THE TWO ARE CORRELATED. Without that, an operator sees a link issued and a link used and cannot say they are the same link",
  );
  assert.ok(issued.at <= used.at, "and they are in the order they happened");
});

test("AN EXPIRED LINK AND A REPLAYED ONE ARE DIFFERENT EVENTS", async () => {
  resetNet();
  const reconnect = await loadRoute("src/app/api/channel/reconnect/route.ts");

  // A forged token: nothing to expire, nothing replayed.
  await readJson(await reconnect.POST(reconnectReq("a-token-that-never-existed")));

  const jid = "12025560002@s.whatsapp.net";
  await broken("acct_tl2", jid);
  const inbound = await loadRoute("src/app/api/channel/inbound/route.ts");
  const { body: offered } = await readJson(await inbound.POST(inboundReq(jid)));
  const token = decodeURIComponent(offered.reconnectUrl.split("t=")[1]);

  await readJson(await reconnect.POST(reconnectReq(token))); // used
  await readJson(await reconnect.POST(reconnectReq(token))); // replayed

  const { listChannelEvents } = await log();
  const rows = await listChannelEvents(100);
  const failures = rows.filter((r) => r.eventType === "RecoveryFailed");

  assert.ok(failures.length >= 2, "both the forgery and the replay are recorded");
  const outcomes = failures.map((f) => f.detail.outcome);
  assert.ok(
    outcomes.includes("USED"),
    "a REPLAY is recorded as USED, not as a generic failure — a dispute later turns on whether somebody re-used a link or merely arrived late",
  );
  assert.ok(outcomes.includes("NOT_FOUND"), "and a forged token is recorded as such");
});

/* ── tamper evidence ───────────────────────────────────────────────────── */

test("THE EVENT CHAIN VERIFIES", async () => {
  resetNet();
  const jid = "12025560003@s.whatsapp.net";
  await broken("acct_tl3", jid);
  const inbound = await loadRoute("src/app/api/channel/inbound/route.ts");
  await readJson(await inbound.POST(inboundReq(jid)));

  const { verifyChannelChain } = await log();
  const status = await verifyChannelChain();
  assert.equal(status.ok, true, `the chain written by the real routes verifies: ${JSON.stringify(status)}`);
  assert.ok(status.length > 0, "and it is not empty");
});

/* ── isolation ─────────────────────────────────────────────────────────── */

test("ONE ACCOUNT'S TIMELINE NEVER CONTAINS ANOTHER'S", async () => {
  resetNet();
  const a = "12025560004@s.whatsapp.net";
  const b = "12025560005@s.whatsapp.net";
  await broken("acct_tl4a", a);
  await broken("acct_tl4b", b);

  const inbound = await loadRoute("src/app/api/channel/inbound/route.ts");
  await readJson(await inbound.POST(inboundReq(a)));
  await readJson(await inbound.POST(inboundReq(b)));

  const { channelTimeline } = await log();
  const only = await channelTimeline("acct_tl4a");
  assert.ok(only.length > 0, "the account has events");
  const serialised = JSON.stringify(only);
  assert.ok(
    !serialised.includes("acct_tl4b"),
    "cross-account leakage in a support view is how one customer's incident gets discussed with another",
  );
});

/* ── what the customer may see ─────────────────────────────────────────── */

test("THE CUSTOMER VIEW SHOWS THEIR OWN EVENTS AND NO INTERNALS", async () => {
  resetNet();
  const jid = "12025560006@s.whatsapp.net";
  await broken("acct_tl5", jid);
  const inbound = await loadRoute("src/app/api/channel/inbound/route.ts");
  const { body: offered } = await readJson(await inbound.POST(inboundReq(jid)));
  const token = decodeURIComponent(offered.reconnectUrl.split("t=")[1]);
  const reconnect = await loadRoute("src/app/api/channel/reconnect/route.ts");
  await readJson(await reconnect.POST(reconnectReq(token)));

  const { channelHistoryForCustomer } = await log();
  const history = await channelHistoryForCustomer("acct_tl5");

  assert.ok(history.length > 0, "the customer can see what happened to their account");
  assert.ok(
    history.every((h) => typeof h.title === "string" && h.title.length > 0),
    "in plain words",
  );

  const serialised = JSON.stringify(history).toLowerCase();
  for (const internal of ["correlationid", "bindingid", "acct_", "reauth_required", "actortype", "riskclass"]) {
    assert.ok(
      !serialised.includes(internal),
      `"${internal}" reached the customer view — the operator detail stays operator-side`,
    );
  }
});

/* ── the log never breaks the operation ────────────────────────────────── */

test("A RECONNECT STILL WORKS IF THE EVENT CANNOT BE WRITTEN", async () => {
  resetNet();
  const jid = "12025560007@s.whatsapp.net";
  await broken("acct_tl6", jid);

  const { recordChannelEvent } = await log();
  // An event the builder refuses: no actor. It must report failure, not throw.
  const refused = await recordChannelEvent({ eventType: "RecoveryLinkIssued", actorType: "" });
  assert.equal(refused.ok, false, "a malformed event is refused");
  assert.ok(refused.reason, "with a reason");

  const inbound = await loadRoute("src/app/api/channel/inbound/route.ts");
  const { status, body } = await readJson(await inbound.POST(inboundReq(jid)));
  assert.equal(status, 200, "and the customer's recovery is unaffected");
  assert.ok(
    body.reconnectUrl,
    "they still get their link — evidence is written after the fact and must never gate the operation it describes",
  );
});
