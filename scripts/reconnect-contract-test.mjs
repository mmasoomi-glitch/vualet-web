// The contract /mira/reconnect depends on.
//
// /mira/reconnect is a thin client: it collects a phone number and a consent
// object, POSTs them to /api/begin, and navigates to the pairUrl it gets back.
// So the thing worth testing is that contract — that this route issues a pair
// link for a consented request, refuses an unconsented one, and never requires
// a purchase. Customers assumed reconnecting meant paying again and went silent
// instead, which is the whole reason that page exists.

import test from "node:test";
import assert from "node:assert/strict";
import { loadRoute, readJson, resetNet } from "./route-harness/index.mjs";

const { POST } = await loadRoute("src/app/api/begin/route.ts", { fresh: true });

const URL_ = "https://mira.vualet.com/api/begin";
const PAIR_BASE = "https://api.example.test/pair";
const PHONE = "+971501234567";

function post(payload) {
  return POST(
    new Request(URL_, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

test.beforeEach(() => {
  resetNet();
  delete process.env.MIRA_WHATSAPP_PAIR_BASE;
});

test("an empty phone is rejected", async () => {
  const { status, body } = await readJson(
    await post({ phone: "", channel: "whatsapp", consent: { banRisk: true } }),
  );
  assert.equal(status, 400, "an empty phone must not reach provisioning");
  assert.equal(body.error, "invalid_phone", "error must be invalid_phone");
});

test("a missing phone is rejected", async () => {
  const { status, body } = await readJson(
    await post({ channel: "whatsapp", consent: { banRisk: true } }),
  );
  assert.equal(status, 400, "a missing phone must not reach provisioning");
  assert.equal(body.error, "invalid_phone", "error must be invalid_phone");
});

test("CONSENT IS REQUIRED: a request without banRisk is refused", async () => {
  const { status, body } = await readJson(
    await post({ phone: PHONE, channel: "whatsapp", consent: {} }),
  );
  assert.equal(status, 400, "the consent disclosure is jury-governed and cannot be bypassed by the caller");
  assert.equal(body.error, "consent_required", "error must be consent_required");
  assert.ok(Array.isArray(body.missing), "missing must be an array naming the absent scopes");
  assert.ok(body.missing.includes("banRisk"), "missing must name banRisk specifically");
});

test("consent explicitly set to false is still refused", async () => {
  const { status, body } = await readJson(
    await post({ phone: PHONE, channel: "whatsapp", consent: { banRisk: false } }),
  );
  assert.equal(status, 400, "an explicit false is a refusal, not an omission to be excused");
  assert.equal(body.error, "consent_required", "error must be consent_required");
});

test("a consented request returns a pair link", async () => {
  process.env.MIRA_WHATSAPP_PAIR_BASE = PAIR_BASE;
  const { status, body } = await readJson(
    await post({
      phone: PHONE,
      channel: "whatsapp",
      consent: { banRisk: true },
      consentVersion: "specs#160r2",
    }),
  );
  assert.equal(status, 200, "this is the exact contract /mira/reconnect depends on");
  assert.ok(typeof body.token === "string" && body.token.length > 0, "token must be a non-empty string");
  assert.ok(typeof body.pairUrl === "string", "pairUrl must be a string");
  assert.ok(body.pairUrl.startsWith(PAIR_BASE), `pairUrl must be built from the configured base, got ${body.pairUrl}`);
  assert.ok(body.pairUrl.includes(body.token), "pairUrl must carry the minted token");
});

test("NO PAYMENT IS REQUIRED TO RECONNECT", async () => {
  process.env.MIRA_WHATSAPP_PAIR_BASE = PAIR_BASE;
  const { status, body } = await readJson(
    await post({
      phone: PHONE,
      channel: "whatsapp",
      consent: { banRisk: true },
      consentVersion: "specs#160r2",
    }),
  );
  // No `plan` key at all. Reconnecting must never require a purchase — customers
  // assumed it did, and went silent rather than pay twice.
  assert.equal(status, 200, "a reconnect with no plan must succeed");
  assert.ok(typeof body.pairUrl === "string" && body.pairUrl.length > 0, "a pair link must still be issued");
});

test("an unconfigured pair base returns 503, not a broken link", async () => {
  delete process.env.MIRA_WHATSAPP_PAIR_BASE;
  const { status, body } = await readJson(
    await post({
      phone: PHONE,
      channel: "whatsapp",
      consent: { banRisk: true },
      consentVersion: "specs#160r2",
    }),
  );
  assert.equal(status, 503, "it must refuse rather than hand out a link it cannot prove is a URL");
  assert.equal(body.error, "whatsapp_unavailable", "error must be whatsapp_unavailable");
});
