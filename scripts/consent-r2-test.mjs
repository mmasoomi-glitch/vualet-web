/**
 * CONSENT REVISION r2 — the three-box wall became ONE box.
 *
 * WHAT IS BEING PROVEN. specs#160 required three ticked boxes before a
 * WhatsApp number could be bound: unofficialAutomation, banRisk,
 * ownAccountReplies. specs#160r2 requires ONE — `banRisk`, whose label now
 * states both the unofficial automation AND the ban it can cause, because
 * those are two halves of one fact. The other two facts are still on the same
 * screen as unticked prose. Nothing was removed from the disclosure; only the
 * number of ticks changed.
 *
 * The judge model (google/gemini-2.5-flash) refused to demote the ban risk to
 * prose at all and accepted the merge — so `banRisk` surviving as the one
 * required scope is a ruling, not a convenience.
 *
 * THE THREE THINGS THIS FILE MUST NOT LET REGRESS:
 *   1. the reduced consent still PROVISIONS (one box is enough, end to end);
 *   2. an EXISTING three-box record still reads correctly — customers who
 *      consented under specs#160 are not retroactively invalidated;
 *   3. the ONE remaining requirement is still a real gate on both routes.
 *
 * WHAT IS REAL AND WHAT IS FAKED. src/lib/consent.ts, /api/begin,
 * /api/checkout and store.ts are the untouched production source. Exactly one
 * boundary is faked: global fetch, via the harness kill switch — an unscripted
 * outbound call throws rather than reaching a live provider.
 *
 * ── ON THE COUNTERFACTUAL BASE ────────────────────────────────────────────
 * The section at the foot pins an EXPLICIT SHA, 66f0bd9, and never says
 * "HEAD". This repo has been burned three times by `OLD_REV = "HEAD"`: the
 * moment the fix merges, "HEAD" resolves to the FIXED code and the
 * counterfactual starts asserting that working code is broken. A
 * counterfactual that names a moving target is not a counterfactual.
 *
 * Run: node --test scripts/consent-r2-test.mjs
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ROOT, loadRoute, jsonRequest, readJson, env, netCalls, resetNet,
} from "./route-harness/index.mjs";

const consentLib = () => loadRoute("src/lib/consent.ts");
const store = await loadRoute("src/lib/store.ts");

// ── (1) THE RULE ITSELF ───────────────────────────────────────────────────

const {
  REQUIRED_CONSENT_SCOPES,
  LEGACY_CONSENT_SCOPES,
  KNOWN_CONSENT_DISCLOSURES,
  CONSENT_DISCLOSURE,
  EMPTY_WHATSAPP_CONSENT,
  whatsAppConsentComplete,
  readConsent,
  readStoredConsent,
} = await consentLib();

// Protects the whole point of r2: one tick, and the customer is through.
test("r2: ONE ticked box is a complete consent — nothing else is demanded", () => {
  assert.deepEqual(REQUIRED_CONSENT_SCOPES, ["banRisk"]);
  assert.strictEqual(whatsAppConsentComplete({ banRisk: true, observationNumber: false }), true);
  const result = readConsent({ banRisk: true });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.consent.disclosure, "specs#160r2");
  assert.ok(!isNaN(Date.parse(result.consent.acceptedAt)));
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result.consent, "unofficialAutomation"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result.consent, "ownAccountReplies"), false);
});

// Protects clients still on the old release: their form must not start failing.
test("r2: a LEGACY three-box form is still accepted and its extra scopes are PRESERVED", () => {
  const result = readConsent({
    unofficialAutomation: true,
    banRisk: true,
    ownAccountReplies: true,
    observationNumber: false,
  });
  assert.strictEqual(result.ok, true);
  const c = result.consent;
  assert.strictEqual(c.banRisk, true);
  assert.strictEqual(c.unofficialAutomation, true);
  assert.strictEqual(c.ownAccountReplies, true);
  assert.strictEqual(c.observationNumber, false);

  const falseLegacy = readConsent({
    unofficialAutomation: false,
    banRisk: true,
    ownAccountReplies: true,
  });
  assert.strictEqual(falseLegacy.ok, true);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(falseLegacy.consent, "unofficialAutomation"), false);
});

// Protects every customer who consented under specs#160 from being invalidated.
test("r2: an EXISTING three-box stored record still reads correctly, disclosure and all", () => {
  const LEGACY_RECORD = {
    unofficialAutomation: true,
    banRisk: true,
    ownAccountReplies: true,
    observationNumber: false,
    disclosure: "specs#160",
    acceptedAt: "2026-07-01T00:00:00.000Z",
  };
  const stored = readStoredConsent(LEGACY_RECORD);
  assert.notStrictEqual(stored, null);
  assert.deepEqual(stored, LEGACY_RECORD);

  const newRecord = {
    banRisk: true,
    observationNumber: false,
    disclosure: "specs#160r2",
    acceptedAt: "2026-07-01T00:00:00.000Z",
  };
  const storedNew = readStoredConsent(newRecord);
  assert.notStrictEqual(storedNew, null);
  assert.deepEqual(storedNew, newRecord);

  // Both revisions must be nameable, or the reader above is lying by accident.
  assert.deepEqual([...KNOWN_CONSENT_DISCLOSURES], ["specs#160", "specs#160r2"]);
  assert.strictEqual(CONSENT_DISCLOSURE, "specs#160r2");
  assert.deepEqual([...LEGACY_CONSENT_SCOPES], ["unofficialAutomation", "ownAccountReplies"]);
});

// Protects the ONE thing r2 kept: reducing friction must not mean removing the gate.
test("r2: the ONE remaining requirement is still a real gate", () => {
  assert.strictEqual(whatsAppConsentComplete(EMPTY_WHATSAPP_CONSENT), false);

  const invalidInputs = [
    {},
    { banRisk: false },
    { banRisk: "true" },
    { banRisk: 1 },
    { banRisk: null },
    { unofficialAutomation: true, ownAccountReplies: true },
    { observationNumber: true },
  ];
  for (const raw of invalidInputs) {
    const res = readConsent(raw);
    assert.strictEqual(res.ok, false, `${JSON.stringify(raw)} must not pass`);
    assert.strictEqual(res.error, "consent_required");
    assert.deepEqual(res.missing, ["banRisk"]);
  }

  assert.strictEqual(
    readStoredConsent({ banRisk: false, disclosure: "specs#160r2", acceptedAt: "2026-07-01T00:00:00.000Z" }),
    null,
  );
  assert.strictEqual(
    readStoredConsent({ banRisk: "true", disclosure: "specs#160r2", acceptedAt: "2026-07-01T00:00:00.000Z" }),
    null,
  );
  assert.strictEqual(
    readStoredConsent({ banRisk: true, disclosure: "specs#999", acceptedAt: "2026-07-01T00:00:00.000Z" }),
    null,
  );
});

// ── (2) THE ROUTES ────────────────────────────────────────────────────────

// Protects the sales case: one tick genuinely provisions, end to end.
test("r2 route: ONE ticked box provisions on /api/begin — no legacy scopes needed", async () => {
  env({ MIRA_WHATSAPP_PAIR_BASE: "https://pair.example.test/wa/pair" });
  resetNet();
  const { POST } = await loadRoute("src/app/api/begin/route.ts", { fresh: true });
  const res = await readJson(await POST(jsonRequest(
    { plan: "trial", phone: "050 123 4567", consent: { banRisk: true } },
    { headers: { "x-real-ip": "198.51.100.11" } }
  )));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(typeof res.body.token, "string");
  assert.strictEqual(res.body.token.length > 0, true);
  assert.strictEqual(typeof res.body.pairUrl, "string");
  assert.strictEqual(res.body.pairUrl.length > 0, true);
  const rec = await store.getConnect(res.body.token);
  assert.strictEqual(rec.consent.banRisk, true);
  assert.strictEqual(rec.consent.disclosure, "specs#160r2");
  assert.strictEqual(rec.consent.observationNumber, false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(rec.consent, "unofficialAutomation"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(rec.consent, "ownAccountReplies"), false);
});

// Protects the free path: fewer boxes must not mean an unenforced box.
test("r2 route: /api/begin still REFUSES when the one remaining box is unticked", async () => {
  env({ MIRA_WHATSAPP_PAIR_BASE: "https://pair.example.test/wa/pair" });
  resetNet();
  const { POST } = await loadRoute("src/app/api/begin/route.ts", { fresh: true });
  const consentValues = [
    undefined,
    {},
    { banRisk: false },
    { banRisk: "true" },
    { unofficialAutomation: true, ownAccountReplies: true }
  ];
  for (let i = 0; i < consentValues.length; i++) {
    const consent = consentValues[i];
    const body = { plan: "trial", phone: "050 123 4567" };
    if (consent !== undefined) {
      body.consent = consent;
    }
    const ip = `198.51.100.${20 + i}`;
    const res = await readJson(await POST(jsonRequest(body, { headers: { "x-real-ip": ip } })));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, "consent_required");
    assert.deepEqual(res.body.missing, ["banRisk"]);
    assert.strictEqual(res.body.token, undefined);
    assert.strictEqual(res.body.pairUrl, undefined);
  }
});

// Protects the paid path: no charge may be attempted without the one tick.
test("r2 route: /api/checkout still REFUSES when the one remaining box is unticked", async () => {
  env({
    DODO_API_KEY: "dummy_dodo_key_not_real",
    DODO_PAYMENTS_LIVE: "1",
    DODO_PRODUCT_COMPANION: "prod_dummy_companion"
  });
  resetNet();
  const { POST } = await loadRoute("src/app/api/checkout/route.ts", { fresh: true });
  const consentValues = [
    undefined,
    {},
    { banRisk: false },
    { banRisk: "true" },
    { unofficialAutomation: true, ownAccountReplies: true }
  ];
  for (const consent of consentValues) {
    const body = {
      plan: "companion",
      email: "buyer@example.com",
      channel: "whatsapp",
      phone: "050 123 4567"
    };
    if (consent !== undefined) {
      body.consent = consent;
    }
    const res = await readJson(await POST(jsonRequest(body)));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, "consent_required");
    assert.deepEqual(res.body.missing, ["banRisk"]);
    assert.strictEqual(netCalls.length, 0);
  }
});

// ── (3) COUNTERFACTUAL — pinned to an EXPLICIT SHA, never "HEAD" ──────────

const PRE_R2 = "66f0bd9"; // last commit before the merge, when three boxes were required

let OLD_PATH;

before(() => {
  const dir = mkdtempSync(path.join(tmpdir(), "mira-consent-r2-"));
  const content = execFileSync("git", ["show", `${PRE_R2}:src/lib/consent.ts`], { cwd: ROOT, encoding: "utf8" });
  writeFileSync(path.join(dir, "consent-old.ts"), content);
  OLD_PATH = path.join(dir, "consent-old.ts");
});

async function oldConsent() {
  return loadRoute(OLD_PATH);
}

async function mustFailAgainstOldCode(what, fn) {
  let capturedError = null;
  try {
    await fn();
  } catch (err) {
    capturedError = err;
  }
  assert.ok(capturedError, `COUNTERFACTUAL BROKEN - "${what}" PASSED against the old three-box code`);
  assert.ok(capturedError instanceof assert.AssertionError, `COUNTERFACTUAL BROKEN - "${what}" threw a different error: ${capturedError.message}`);
  return capturedError;
}

// Protects the live test that one ticked box is complete
test("CF-r2a: 'one ticked box is complete' FAILS against 66f0bd9", async () => {
  await mustFailAgainstOldCode("one ticked box is complete", async () => {
    const old = await oldConsent();
    assert.deepEqual(old.REQUIRED_CONSENT_SCOPES, ["banRisk"]);
    assert.strictEqual(old.readConsent({ banRisk: true }).ok, true);
  });
});

// Protects the live test that the stored-record reader exists and accepts a specs#160 record
test("CF-r2b: 'the stored-record reader exists and accepts a specs#160 record' FAILS against 66f0bd9", async () => {
  await mustFailAgainstOldCode("the stored-record reader exists and accepts a specs#160 record", async () => {
    const old = await oldConsent();
    assert.strictEqual(typeof old.readStoredConsent, "function");
    assert.strictEqual(old.readStoredConsent({ banRisk: true }).ok, true);
  });
});

// Protects the live test that the disclosure revision is specs#160r2
test("CF-r2c: 'the disclosure revision is specs#160r2' FAILS against 66f0bd9", async () => {
  await mustFailAgainstOldCode("the disclosure revision is specs#160r2", async () => {
    const old = await oldConsent();
    assert.strictEqual(old.CONSENT_DISCLOSURE, "specs#160r2");
  });
});
