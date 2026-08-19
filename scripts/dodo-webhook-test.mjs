import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  verifyDodoWebhook,
  activationRecordFromDodo,
  activateDodo,
  secretKeyBytes,
} from "../src/lib/dodo-webhook-core.mjs";

function safeEqual(a, b) {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
const cryptoDeps = { createHmac: crypto.createHmac, Buffer, safeEqual };

// A real Standard-Webhooks secret is whsec_<base64>; sign the canonical content.
const SECRET = "whsec_" + Buffer.from("mira-dodo-test-secret-key").toString("base64");
function sign(id, ts, body) {
  const key = secretKeyBytes(Buffer, SECRET);
  const sig = crypto.createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return `v1,${sig}`;
}

test("valid Standard-Webhooks signature verifies", () => {
  const id = "evt_1", ts = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ type: "subscription.active", data: {} });
  const v = verifyDodoWebhook(
    { id, timestamp: ts, signatureHeader: sign(id, ts, body), rawBody: body, secret: SECRET },
    cryptoDeps,
  );
  assert.equal(v.ok, true);
});

test("tampered body is rejected (bad_signature)", () => {
  const id = "evt_2", ts = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ type: "subscription.active", data: {} });
  const header = sign(id, ts, body);
  const v = verifyDodoWebhook(
    { id, timestamp: ts, signatureHeader: header, rawBody: body + "X", secret: SECRET },
    cryptoDeps,
  );
  assert.equal(v.ok, false);
  assert.equal(v.reason, "bad_signature");
});

test("stale timestamp is rejected (replay guard)", () => {
  const id = "evt_3", ts = String(Math.floor(Date.now() / 1000) - 10000);
  const body = "{}";
  const v = verifyDodoWebhook(
    { id, timestamp: ts, signatureHeader: sign(id, ts, body), rawBody: body, secret: SECRET },
    cryptoDeps,
  );
  assert.equal(v.ok, false);
  assert.equal(v.reason, "timestamp_out_of_tolerance");
});

test("missing headers rejected", () => {
  const v = verifyDodoWebhook(
    { id: "", timestamp: "", signatureHeader: "", rawBody: "{}", secret: SECRET },
    cryptoDeps,
  );
  assert.equal(v.ok, false);
  assert.equal(v.reason, "missing_headers");
});

test("activation reads plan from metadata (never a guessed default)", () => {
  const rec = activationRecordFromDodo(
    { metadata: { connect_token: "tok_abc", plan: "studio" }, subscription_id: "sub_1", customer: { customer_id: "cus_1", email: "a@b.co" } },
    null,
    "2026-07-30T00:00:00.000Z",
  );
  assert.equal(rec.plan, "studio");
  assert.equal(rec.token, "tok_abc");
  assert.equal(rec.status, "active");
  assert.equal(rec.customerId, "cus_1");
});

test("activation prefers an existing base plan over payload (upgrade-safe)", () => {
  const rec = activationRecordFromDodo(
    { metadata: { connect_token: "tok", plan: "companion" }, subscription_id: "sub_2" },
    { token: "tok", plan: "assistant", status: "pending", createdAt: "2026-07-01T00:00:00Z" },
    "2026-07-30T00:00:00.000Z",
  );
  assert.equal(rec.plan, "assistant");
});

test("activateDodo writes connect + subscription records via injected store", async () => {
  const connects = new Map(), subs = new Map();
  const rec = await activateDodo(
    { metadata: { connect_token: "tok_x", plan: "companion" }, subscription_id: "sub_x", customer: { customer_id: "cus_x" } },
    {
      getConnect: async (t) => connects.get(t) ?? null,
      putConnect: async (r) => { connects.set(r.token, r); },
      putSubscription: async (c, r) => { subs.set(c, r); },
      now: "2026-07-30T00:00:00.000Z",
    },
  );
  assert.equal(rec.plan, "companion");
  assert.equal(connects.get("tok_x").status, "active");
  assert.equal(subs.get("cus_x").status, "active");
});
