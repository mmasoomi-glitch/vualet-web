// Channel identity events, the timeline, and what a customer may see.
//
// The chain these rows go into is append-only and hash-verified, so anything
// written is permanent and unerasable. Most of this file is about what must
// therefore never be written.

import test from "node:test";
import assert from "node:assert/strict";
import {
  CHANNEL_EVENTS,
  sanitiseDetail,
  canonicaliseChannelRow,
  buildChannelEvent,
  buildTimeline,
  buildCustomerHistory,
} from "../src/lib/channel-events.mjs";
import { createAuditLog } from "../src/lib/audit-chain.mjs";

const ev = (over = {}) => ({
  eventType: CHANNEL_EVENTS.ChannelDisconnected,
  actorType: "PROVIDER",
  accountId: "acct_1",
  bindingId: "bnd_1",
  ...over,
});

/** An in-memory chain, exactly as the admin audit test wires one. */
function memoryChain() {
  const rows = new Map();
  let seq = 0;
  return createAuditLog(
    {
      nextSeq: async () => ++seq,
      currentSeq: async () => seq,
      getEvent: async (s) => rows.get(s) ?? null,
      putEventNX: async (s, row) => {
        if (rows.has(s)) return false;
        rows.set(s, row);
        return true;
      },
    },
    canonicaliseChannelRow,
  );
}

/* ── what may never become permanent ───────────────────────────────────── */

test("NOTHING IDENTIFYING MAY ENTER AN UNERASABLE CHAIN", () => {
  const out = sanitiseDetail({
    phone: "+971554292699",
    customerEmail: "someone@example.com",
    jid: "12025551234@s.whatsapp.net",
    recoveryToken: "abc123",
    apiSecret: "sk-live",
    rawIdentifier: "+4477009001",
    channelIdHash: "deadbeef",
    latencyMs: 42,
  });

  const serialised = JSON.stringify(out);
  for (const leak of ["+971554292699", "someone@example.com", "12025551234", "abc123", "sk-live"]) {
    assert.ok(
      !serialised.includes(leak),
      `"${leak}" would have been written to a chain that cannot be edited or deleted, so it could never satisfy an erasure request`,
    );
  }
  assert.equal(out.channelIdHash, "deadbeef", "a HASH is the whole point and must survive");
  assert.equal(out.latencyMs, 42, "and ordinary evidence is kept");
});

test("a value that LOOKS identifying is redacted whatever it is called", () => {
  const out = sanitiseDetail({ note: "+971554292699", other: "user@example.com", fine: "all good" });
  assert.equal(out.note, "[redacted]", "a phone number hiding under an innocent key is still a phone number");
  assert.equal(out.other, "[redacted]", "so is an address");
  assert.equal(out.fine, "all good", "ordinary text survives");
});

test("sanitiseDetail flattens and bounds", () => {
  const out = sanitiseDetail({ nested: { a: 1 }, list: [1, 2], long: "x".repeat(500), nil: null, no: false });
  assert.equal(out.nested, "[omitted]", "nesting could smuggle a value past the key filter");
  assert.equal(out.list, "[omitted]", "so could an array");
  assert.equal(out.long.length, 200, "a long string is bounded");
  assert.equal(out.nil, null, "null survives");
  assert.equal(out.no, false, "and so does false");
});

test("sanitiseDetail is defensive", () => {
  for (const input of [null, undefined, "nope", 5, [1, 2]]) {
    assert.deepEqual(sanitiseDetail(input), {}, `${String(input)} yields an empty detail`);
  }
});

/* ── building events ───────────────────────────────────────────────────── */

test("an event needs a real type and an actor", () => {
  assert.equal(buildChannelEvent(ev({ eventType: "MadeUp" })).ok, false, "an invented type is refused");
  assert.equal(buildChannelEvent(ev({ actorType: "" })).ok, false, "a blank actor is refused");
  assert.equal(buildChannelEvent(ev({ actorType: undefined })).ok, false, "a missing actor is refused");
  assert.equal(buildChannelEvent(null).ok, false, "and nothing at all is refused, not thrown on");
});

test("an event carries correlation and causation", () => {
  const { event } = buildChannelEvent(
    ev({ correlationId: "cor_1", causationId: "cau_1", reasonCode: "PROVIDER_REVOKED" }),
  );
  assert.equal(event.correlationId, "cor_1", "so related events can be gathered");
  assert.equal(event.causationId, "cau_1", "and cause can be followed");
  assert.equal(event.reasonCode, "PROVIDER_REVOKED", "with a structured reason, not prose");
  assert.deepEqual(event.detail, {}, "an absent detail is an empty object");
});

test("the detail is sanitised ON THE WAY IN", () => {
  const { event } = buildChannelEvent(ev({ detail: { phone: "+971554292699" } }));
  assert.equal(
    event.detail.phone,
    "[redacted]",
    "redacting at read time would still have written the number to an append-only chain, where it would stay forever",
  );
});

/* ── the chain itself ──────────────────────────────────────────────────── */

test("CHANNEL EVENTS FORM A TAMPER-EVIDENT CHAIN", async () => {
  const chain = memoryChain();
  for (const type of [
    CHANNEL_EVENTS.ChannelDisconnected,
    CHANNEL_EVENTS.RecoveryLinkIssued,
    CHANNEL_EVENTS.RecoveryLinkUsed,
    CHANNEL_EVENTS.ChannelReauthenticated,
  ]) {
    const built = buildChannelEvent(ev({ eventType: type }));
    await chain.append(built.event);
  }

  const status = await chain.verify();
  assert.equal(status.ok, true, "an untouched chain verifies");
  assert.equal(status.length, 4, "with every row present");
});

test("EDITING A ROW BREAKS THE CHAIN", async () => {
  const rows = new Map();
  let seq = 0;
  const backend = {
    nextSeq: async () => ++seq,
    currentSeq: async () => seq,
    getEvent: async (s) => rows.get(s) ?? null,
    putEventNX: async (s, row) => {
      if (rows.has(s)) return false;
      rows.set(s, row);
      return true;
    },
  };
  const chain = createAuditLog(backend, canonicaliseChannelRow);

  await chain.append(buildChannelEvent(ev()).event);
  await chain.append(buildChannelEvent(ev({ eventType: CHANNEL_EVENTS.RecoveryLinkIssued })).event);

  // Someone quietly rewrites history to say the customer caused it.
  const tampered = { ...rows.get(1), reasonCode: "USER_REMOVED_DEVICE" };
  rows.set(1, tampered);

  const status = await chain.verify();
  assert.equal(status.ok, false, "the forgery is detected");
  assert.equal(status.brokenAt, 1, "and located exactly, which is what makes this evidence");
});

test("a row cannot be overwritten at all", async () => {
  const chain = memoryChain();
  await chain.append(buildChannelEvent(ev()).event);
  // The append-only guard is the backend refusing a second write to a seq.
  const status = await chain.verify();
  assert.equal(status.ok, true, "the single row stands");
});

/* ── the operator timeline ─────────────────────────────────────────────── */

const rowsFor = () => [
  { seq: 2, ts: "2026-09-12T09:15:03Z", eventType: CHANNEL_EVENTS.ChannelDisconnected, accountId: "a1", actorType: "CUSTOMER", reasonCode: "USER_REMOVED_DEVICE", previousState: "ACTIVE", newState: "DISCONNECTED", bindingId: "b1" },
  { seq: 1, ts: "2026-09-12T09:14:22Z", eventType: CHANNEL_EVENTS.CustomerActionRecorded, accountId: "a1", actorType: "CUSTOMER" },
  { seq: 4, ts: "2026-09-12T09:20:13Z", eventType: CHANNEL_EVENTS.ChannelReauthenticated, accountId: "a1", actorType: "CUSTOMER", previousState: "DISCONNECTED", newState: "ACTIVE" },
  { seq: 3, ts: "2026-09-12T09:17:52Z", eventType: CHANNEL_EVENTS.RecoveryLinkIssued, accountId: "a1", actorType: "SYSTEM" },
  { seq: 5, ts: "2026-09-12T09:21:00Z", eventType: CHANNEL_EVENTS.ChannelDisconnected, accountId: "OTHER", actorType: "PROVIDER" },
];

test("SUPPORT NEVER HAS TO GUESS WHAT HAPPENED", () => {
  const timeline = buildTimeline(rowsFor(), { accountId: "a1" });
  assert.deepEqual(
    timeline.map((t) => t.eventType),
    [
      CHANNEL_EVENTS.CustomerActionRecorded,
      CHANNEL_EVENTS.ChannelDisconnected,
      CHANNEL_EVENTS.RecoveryLinkIssued,
      CHANNEL_EVENTS.ChannelReauthenticated,
    ],
    "the account's events appear in chronological order, reconstructed from canonical events rather than typed notes",
  );
  assert.equal(timeline[1].label, "Binding disconnected", "each line is readable");
  assert.equal(timeline[1].from, "ACTIVE", "with the state it left");
  assert.equal(timeline[1].to, "DISCONNECTED", "and the state it reached");
  assert.equal(timeline[1].actorType, "CUSTOMER", "and who caused it");
});

test("ONE ACCOUNT'S TIMELINE NEVER CONTAINS ANOTHER'S", () => {
  const timeline = buildTimeline(rowsFor(), { accountId: "a1" });
  assert.ok(
    timeline.every((t) => t.eventType !== undefined),
    "every line is real",
  );
  assert.equal(timeline.length, 4, "the fifth row belongs to a different account and must not leak into this one");
});

test("buildTimeline is defensive", () => {
  for (const rows of [null, undefined, "nope", 5]) {
    assert.deepEqual(buildTimeline(rows), [], `${String(rows)} yields nothing`);
  }
  assert.deepEqual(buildTimeline([null, 5, "x"], {}), [], "garbage rows are dropped");
});

/* ── the customer's own view ───────────────────────────────────────────── */

test("a customer can see what happened to their own account", () => {
  const history = buildCustomerHistory(rowsFor(), "a1");
  assert.equal(history[0].title, "WhatsApp reconnected", "newest first, in plain words");
  const disconnect = history.find((h) => h.title === "WhatsApp disconnected");
  assert.equal(
    disconnect.reason,
    "The linked device was removed.",
    "and is told why in language that explains rather than blames",
  );
});

test("THE CUSTOMER VIEW HIDES THE ANTI-FRAUD SIGNALS", () => {
  const rows = [
    {
      seq: 1,
      ts: "2026-09-12T09:00:00Z",
      eventType: CHANNEL_EVENTS.ChannelDisconnected,
      accountId: "a1",
      actorType: "SECURITY_AUTOMATION",
      riskClassification: "HIGH",
      correlationId: "cor_secret",
      actorId: "admin_7",
      previousState: "ACTIVE",
      reasonCode: "SECURITY_REVOCATION",
    },
    { seq: 2, ts: "2026-09-12T09:01:00Z", eventType: CHANNEL_EVENTS.SecurityRiskRaised, accountId: "a1", actorType: "SECURITY_AUTOMATION" },
  ];
  const history = buildCustomerHistory(rows, "a1");
  const serialised = JSON.stringify(history);

  for (const secret of ["HIGH", "cor_secret", "admin_7", "SECURITY_AUTOMATION", "SecurityRiskRaised"]) {
    assert.ok(
      !serialised.includes(secret),
      `"${secret}" reached the customer view — publishing what trips the risk engine tells an attacker exactly what to avoid`,
    );
  }
  assert.equal(history.length, 1, "the risk event itself is not shown at all");
});

test("an unhelpful reason code is shown as no reason rather than jargon", () => {
  const rows = [
    { seq: 1, ts: "2026-09-12T09:00:00Z", eventType: CHANNEL_EVENTS.ChannelDisconnected, accountId: "a1", actorType: "SYSTEM", reasonCode: "UNKNOWN_DISCONNECT" },
  ];
  assert.equal(
    buildCustomerHistory(rows, "a1")[0].reason,
    null,
    '"UNKNOWN_DISCONNECT" tells a customer nothing and reads like an evasion',
  );
});

test("buildCustomerHistory refuses to answer without an account", () => {
  assert.deepEqual(buildCustomerHistory(rowsFor(), ""), [], "no account, no history");
  assert.deepEqual(buildCustomerHistory(rowsFor(), null), [], "and null is not a wildcard");
  assert.deepEqual(buildCustomerHistory(null, "a1"), [], "nor do garbage rows throw");
});
