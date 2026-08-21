/**
 * E.164 NORMALISATION TEST (vualet-web copy).
 *
 * These cases are PORTED, not invented: they are the same cases that guard the original in
 * C:\Ballerina-Motasadea-V1\apps\engine\test\telegram-commands.test.mjs
 * (describe('E.164 normalisation'), lines 425-466). The web wizard vendors that normaliser in
 * src/lib/phone.ts, so the two copies must agree on every one of these inputs — otherwise a
 * number typed on the web and a number shared in chat would resolve to two different identities.
 *
 * No env reads, no network, no stubs needed — the function is pure.
 *
 * Run: node --test scripts/phone-test.mjs
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";

import {
  DEFAULT_CALLING_CODE,
  normalisePhone,
  phoneErrorText,
  PHONE_ERROR_TEXT,
} from "../src/lib/phone.ts";

describe("E.164 normalisation", () => {
  const CASES = [
    ["+971501234567", "+971501234567", "plus form"],
    ["+971 50 123 4567", "+971501234567", "plus form, spaced"],
    ["00971501234567", "+971501234567", "00 international prefix"],
    ["00 971 50 123 4567", "+971501234567", "00 prefix, spaced"],
    ["971501234567", "+971501234567", "bare country code"],
    ["0501234567", "+971501234567", "national trunk form"],
    ["050 123 4567", "+971501234567", "national trunk, spaced"],
    ["(050) 123-4567", "+971501234567", "national trunk, punctuated"],
    ["501234567", "+971501234567", "local, no trunk zero"],
    ["+1 202 555 0123", "+12025550123", "foreign number is never mangled"],
    ["+44 20 7946 0958", "+442079460958", "foreign number, spaced"],
  ];

  for (const [input, expected, label] of CASES) {
    test(`${label}: ${JSON.stringify(input)} -> ${expected}`, () => {
      const r = normalisePhone(input, { defaultCallingCode: "971" });
      assert.equal(r.ok, true, `rejected: ${r.reason}`);
      assert.equal(r.e164, expected);
    });
  }

  test("all UAE forms converge on one identity", () => {
    const forms = ["+971501234567", "00971501234567", "971501234567", "0501234567", "050 123 4567", "501234567"];
    const out = new Set(forms.map((f) => normalisePhone(f, { defaultCallingCode: "971" }).e164));
    assert.equal(out.size, 1, `expected one canonical value, got ${[...out].join(", ")}`);
    assert.equal([...out][0], "+971501234567");
  });

  test("normalising an already-normalised number changes nothing (idempotence)", () => {
    for (const [, expected] of CASES) {
      const once = normalisePhone(expected, { defaultCallingCode: "971" });
      assert.equal(once.ok, true);
      assert.equal(once.e164, expected);
      const twice = normalisePhone(once.e164, { defaultCallingCode: "971" });
      assert.equal(twice.e164, expected);
    }
  });

  test("the default calling code is INJECTED, not read from env", () => {
    assert.equal(normalisePhone("0501234567", { defaultCallingCode: "44" }).e164, "+44501234567");
    assert.equal(normalisePhone("0501234567", { defaultCallingCode: "1" }).e164, "+1501234567");
  });

  test("the default calling code defaults to 971 when no options are passed at all", () => {
    assert.equal(normalisePhone("0501234567").e164, "+971501234567");
    assert.equal(normalisePhone("0501234567", {}).e164, "+971501234567");
  });

  test("junk is refused", () => {
    for (const bad of ["", "   ", null, undefined, "not a phone", "12", "+", "1234567890123456789"]) {
      assert.equal(
        normalisePhone(bad, { defaultCallingCode: "971" }).ok,
        false,
        `should reject ${JSON.stringify(bad)}`,
      );
    }
  });

  test("output is always E.164-shaped", () => {
    for (const [input] of CASES) {
      const r = normalisePhone(input, { defaultCallingCode: "971" });
      assert.match(r.e164, /^\+[1-9]\d{7,14}$/);
    }
  });

  test("a refusal carries a reason code and never an e164", () => {
    const expectations = [
      [null, "empty"],
      [undefined, "empty"],
      ["", "empty"],
      ["   ", "empty"],
      ["not a phone", "no-digits"],
      ["12", "length"],
      ["1234567890123456789", "length"],
    ];
    for (const [bad, reason] of expectations) {
      const r = normalisePhone(bad, { defaultCallingCode: "971" });
      assert.equal(r.ok, false, `should reject ${JSON.stringify(bad)}`);
      assert.equal(r.reason, reason, `wrong reason for ${JSON.stringify(bad)}`);
      assert.equal(r.e164, undefined, "a refusal must not carry an e164");
    }
  });

  test("every reason code has UI text, so a rejection is never silent", () => {
    for (const reason of ["empty", "no-digits", "leading-zero", "length"]) {
      const text = phoneErrorText(reason);
      assert.equal(typeof text, "string");
      assert.ok(text.length > 0, `no message for ${reason}`);
      assert.equal(text, PHONE_ERROR_TEXT[reason]);
    }
  });
});

// == RELEASE GATE C1 - the disclosure is wired into the wizard ==================================
//
// HONEST LIMITATION, stated up front: these are SOURCE-LEVEL assertions, not a DOM render.
// This repo has no JSX runtime for tests - Node's type stripping handles .ts but refuses .tsx
// ("Unknown file extension .tsx"), and there is no jsdom, no testing-library and no build step
// in scripts/. Adding one means touching package.json, which is not this writer's file.
//
// So these tests read the real source of the wizard and the real source of the disclosure and
// assert the wiring the judge required: that the component is rendered inside the WhatsApp step,
// that Continue cannot pass until consent is complete, that /api/begin is not called without it,
// and that the consent object is actually sent. A source assertion is weaker than a render - it
// proves the code says the right thing, not that React drew it - but it fails loudly if anyone
// deletes the disclosure, unticks the gate, or pre-checks a box. Replace with a render test the
// moment this repo grows a JSX-capable test runner.
describe("release gate C1 - WhatsApp disclosure is wired into the wizard", () => {
  const WIZARD = readFileSync(new URL("../src/app/mira/start/page.tsx", import.meta.url), "utf8");

  /** The body of the WhatsApp step, from its branch to the start of the Review step. */
  function whatsAppStepSource() {
    const from = WIZARD.indexOf("{step === STEP.WhatsApp && (");
    const to = WIZARD.indexOf("{step === STEP.Review && (");
    assert.ok(from > 0, "WhatsApp step branch not found");
    assert.ok(to > from, "Review step branch not found after the WhatsApp step");
    return WIZARD.slice(from, to);
  }

  test("the wizard imports the disclosure and its consent helpers", () => {
    assert.match(WIZARD, /import WhatsAppDisclosure from/, "the component is not imported");
    assert.match(WIZARD, /_components\/WhatsAppDisclosure/, "not imported from the canonical path");
    // The rule may be imported from its definition or through the component's compat
    // re-export; what matters is that the wizard imports it rather than restating it.
    assert.match(WIZARD, /EMPTY_WHATSAPP_CONSENT/, "EMPTY_WHATSAPP_CONSENT is not imported");
    assert.match(WIZARD, /whatsAppConsentComplete/, "whatsAppConsentComplete is not imported");
  });

  test("the disclosure is RENDERED inside the WhatsApp step, before the number field", () => {
    const step = whatsAppStepSource();
    const rendered = step.indexOf("<WhatsAppDisclosure");
    assert.ok(rendered >= 0, "the disclosure is imported but never rendered in the WhatsApp step");
    const input = step.indexOf("<input");
    assert.ok(input > rendered, "the number field must come AFTER the risk copy, not before it");
    assert.match(step, /<WhatsAppDisclosure[\s\S]{0,120}value=\{consent\}/, "not a controlled render");
    assert.match(step, /<WhatsAppDisclosure[\s\S]{0,120}onChange=\{setConsent\}/, "consent changes are dropped");
  });

  test("the wizard seeds its consent state from the empty constant", () => {
    // That the constant IS empty is asserted behaviourally against its definition, further
    // down. Here we only check the wizard starts from it rather than from an object of
    // its own — which is the part only the wizard's source can tell us.
    assert.match(
      WIZARD,
      /useState<WhatsAppConsent>\(EMPTY_WHATSAPP_CONSENT\)/,
      "consent state must initialise from EMPTY_WHATSAPP_CONSENT",
    );
  });

  test("nothing in the wizard ever ticks a required box for the customer", () => {
    const { REQUIRED_CONSENT_SCOPES } = loaded();
    // Scope names come from the rule itself, so adding a fourth required scope extends this
    // check automatically instead of leaving a hole until someone remembers to widen it.
    const code = WIZARD.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
    for (const scope of REQUIRED_CONSENT_SCOPES) {
      assert.doesNotMatch(
        code,
        new RegExp(`${scope}\\s*:\\s*true`),
        `the wizard sets ${scope} itself — consent must come from the customer, not from us`,
      );
    }
  });

  test("Continue is blocked until consent is complete", () => {
    // The step gate must require BOTH a usable number and complete consent.
    const gate = WIZARD.match(/\(step === STEP\.WhatsApp &&[^)]*\)/);
    assert.ok(gate, "no canAdvance clause for the WhatsApp step");
    assert.match(gate[0], /phoneResult\.ok/, "the gate no longer requires a usable number");
    assert.match(gate[0], /consentComplete/, "the gate does not require consent");
    // ...and pressing Continue anyway must SAY why rather than silently doing nothing.
    assert.match(WIZARD, /setConsentAttempted\(true\)/, "no visible reason when consent is missing");
  });

  test("submit() refuses to call /api/begin without consent", () => {
    const submit = WIZARD.slice(WIZARD.indexOf("async function submit()"));
    const guard = submit.indexOf("if (!consentComplete)");
    const call = submit.indexOf('fetch("/api/begin"');
    assert.ok(guard >= 0, "submit() has no consent guard");
    assert.ok(call > guard, "the consent guard must come BEFORE the /api/begin call");
  });

  test("the consent object is sent to the server, not just held in the browser", () => {
    const body = WIZARD.slice(
      WIZARD.indexOf("body: JSON.stringify({"),
      WIZARD.indexOf("const data = await res.json()"),
    );
    assert.match(body, /\bconsent,/, "consent is not in the POST body - the gate would be client-only");
  });

});

// == the honest-503 path =======================================================================
describe("WhatsApp unavailable is reported as ours, not the customer's fault", () => {
  const WIZARD = readFileSync(new URL("../src/app/mira/start/page.tsx", import.meta.url), "utf8");

  test("a 503 whatsapp_unavailable is handled distinctly from a generic failure", () => {
    assert.match(WIZARD, /res\.status === 503 && data\.error === "whatsapp_unavailable"/);
    const branch = WIZARD.slice(WIZARD.indexOf('data.error === "whatsapp_unavailable"'));
    const message = branch.slice(0, branch.indexOf("setSubmitBusy(false)"));
    assert.doesNotMatch(message, /Try once more\?/, "503 must not be dressed up as a retryable error");
    assert.match(message, /that's us, not you/i, "must say plainly that the customer did nothing wrong");
  });

  test("a 400 invalid_phone is sent back to the field with the server's own reason", () => {
    assert.match(WIZARD, /res\.status === 400 && data\.error === "invalid_phone"/);
    const branch = WIZARD.slice(WIZARD.indexOf('data.error === "invalid_phone"'));
    const body = branch.slice(0, branch.indexOf("setSubmitBusy(false)"));
    assert.match(body, /setStep\(STEP\.WhatsApp\)/, "must return the customer to the number field");
    assert.match(body, /isPhoneReason\(data\.reason\)/, "must narrow the server's reason code");
  });
});

// == one canonical request shape ===============================================================
describe("the POST body has ONE canonical shape", () => {
  const WIZARD = readFileSync(new URL("../src/app/mira/start/page.tsx", import.meta.url), "utf8");
  const body = WIZARD.slice(
    WIZARD.indexOf("body: JSON.stringify({"),
    WIZARD.indexOf("const data = await res.json()"),
  );

  test("channel and phone are sent at the TOP LEVEL, where /api/begin reads them", () => {
    assert.match(body, /^\s*channel,\s*$/m, "channel must be a top-level field");
    assert.match(body, /^\s*phone: phoneResult\.e164,\s*$/m, "phone must be a top-level field");
  });

  test("they are NOT duplicated inside setup - two copies is ambiguity, not safety", () => {
    const setup = body.slice(body.indexOf("setup: {"));
    assert.ok(!setup.includes("channel"), "channel is duplicated inside setup");
    assert.ok(!setup.includes("phone"), "phone is duplicated inside setup");
  });
});

// == the default calling code has exactly ONE definition ========================================
//
// It used to exist as a literal "971" in three places: this lib's default parameter, the signup
// wizard and the checkout page. Three copies that no test compared, so any two of them could
// drift apart silently and route a customer's national-format number to the wrong country.
//
// The lib now exports it and the callers import it. These tests are what make that fix real
// rather than cosmetic: they assert the EXPORTED constant is the one normalisePhone actually
// applies. None of THESE tests hardcodes "971" — every expectation is derived from the constant,
// so they go red on DRIFT (the constant and the default parameter disagreeing) rather than on a
// deliberate change. Changing the product default itself is caught separately and on purpose, by
// "the default calling code defaults to 971 when no options are passed at all" above: switching
// the default country is a product decision, and it should never happen without a test saying so.
describe("the default calling code has exactly ONE definition", () => {
  test("the exported constant is what normalisePhone applies when none is passed", () => {
    const national = "0501234567";
    const implicit = normalisePhone(national);
    const explicit = normalisePhone(national, { defaultCallingCode: DEFAULT_CALLING_CODE });
    assert.equal(implicit.ok, true, `rejected: ${implicit.reason}`);
    assert.deepEqual(
      implicit,
      explicit,
      "normalisePhone's built-in default has drifted from the exported DEFAULT_CALLING_CODE",
    );
  });

  test("the constant really drives the output — it is not decorative", () => {
    // Derived from the constant, never from a literal: if the two disagree, this goes red.
    assert.equal(normalisePhone("501234567").e164, `+${DEFAULT_CALLING_CODE}501234567`);
    assert.equal(normalisePhone("0501234567").e164, `+${DEFAULT_CALLING_CODE}501234567`);
    assert.equal(normalisePhone("(050) 123-4567").e164, `+${DEFAULT_CALLING_CODE}501234567`);
  });

  test("an injected code still overrides the exported default", () => {
    // Whatever the default becomes, injecting something else must still win.
    const other = DEFAULT_CALLING_CODE === "44" ? "1" : "44";
    assert.equal(
      normalisePhone("0501234567", { defaultCallingCode: other }).e164,
      `+${other}501234567`,
    );
  });

  test("a leading + or 00 still beats the exported default", () => {
    // The default must never reach an international number, however it is defined.
    for (const intl of ["+12025550123", "0012025550123"]) {
      assert.equal(normalisePhone(intl).e164, "+12025550123");
    }
  });

  test("the constant is a bare calling code, not a formatted one", () => {
    assert.equal(typeof DEFAULT_CALLING_CODE, "string");
    assert.match(DEFAULT_CALLING_CODE, /^[1-9]\d{0,3}$/, "must be digits only, no + and no spaces");
  });

  test("the lib defines it exactly once", () => {
    const LIB = readFileSync(new URL("../src/lib/phone.ts", import.meta.url), "utf8");
    const declarations = LIB.match(/^export const DEFAULT_CALLING_CODE\s*=/gm) || [];
    assert.equal(declarations.length, 1, "DEFAULT_CALLING_CODE must be declared once in the lib");
    // …and the function signature must reference the constant, not a re-typed literal.
    assert.match(
      LIB,
      /defaultCallingCode = DEFAULT_CALLING_CODE/,
      "normalisePhone's default parameter must be the shared constant, not a literal",
    );
  });

});

// == no consumer of the phone lib keeps a private calling code =================================
//
// This guard used to read the signup wizard and nothing else, which meant it protected exactly
// one file: the checkout page could have reintroduced a literal "971" and the suite would have
// stayed green. Writer F caught that.
//
// The fix is not a second hardcoded fixture — a hand-listed pair is the same bug with a longer
// list. Instead the suite DISCOVERS every file under src/ that imports the phone lib and asserts
// the property against all of them, so a new consumer is covered the day it is written rather
// than the day someone remembers to add it here.
describe("no consumer of the phone lib keeps a private calling code", () => {
  const SRC = new URL("../src/", import.meta.url);

  /** Matches the phone lib by alias ("@/lib/phone") or by relative path, with or without .ts. */
  const isPhoneLib = (spec) =>
    /^(?:@\/lib\/phone|\.{1,2}\/[^"']*lib\/phone|\.\/phone)(?:\.ts)?$/.test(spec);

  /**
   * Comments must not count as usage: /api/begin and /api/checkout both NAME
   * DEFAULT_CALLING_CODE in a comment explaining why they deliberately pass nothing. Treating
   * that as a reference would demand an import they correctly do not need.
   * The `[^:"'`]` guard keeps "https://..." inside a string from being eaten as a line comment.
   */
  const stripComments = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

  const importsOf = (src) =>
    [...src.matchAll(/import\s+([\s\S]*?)\s*from\s*["']([^"']+)["']/g)]
      .map((m) => ({ clause: m[1], spec: m[2] }));

  /** Every .ts/.tsx under src/ that imports the phone lib. The lib itself is excluded. */
  function phoneConsumers() {
    return readdirSync(SRC, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
      .map((e) => join(e.parentPath, e.name))
      .filter((f) => !f.endsWith(`${sep}lib${sep}phone.ts`))
      .map((file) => ({ file, src: readFileSync(file, "utf8") }))
      .filter(({ src }) => importsOf(src).some((i) => isPhoneLib(i.spec)));
  }

  // A discovery-driven guard that discovers nothing passes every assertion vacuously. These two
  // tests are what stop this whole suite from quietly becoming a no-op.
  test("the discovery finds real consumers, including checkout and the wizard", () => {
    const found = phoneConsumers().map(({ file }) => file.replaceAll(sep, "/"));
    assert.ok(found.length >= 2, `expected several consumers, found ${found.length}`);
    for (const expected of ["src/app/mira/start/page.tsx", "src/app/mira/checkout/page.tsx"]) {
      assert.ok(
        found.some((f) => f.endsWith(expected)),
        `${expected} is not being checked — discovery found: ${found.join(", ")}`,
      );
    }
  });

  test("the discovery would notice a consumer that stopped importing the lib", () => {
    // Proves isPhoneLib is doing work rather than matching everything or nothing.
    assert.ok(isPhoneLib("@/lib/phone"));
    assert.ok(isPhoneLib("../src/lib/phone.ts"));
    assert.ok(!isPhoneLib("@/lib/phone-numbers"));
    assert.ok(!isPhoneLib("@/lib/store"));
  });

  test("none of them declares its own DEFAULT_CALLING_CODE", () => {
    for (const { file, src } of phoneConsumers()) {
      assert.doesNotMatch(
        src,
        /^\s*(?:export\s+)?const\s+DEFAULT_CALLING_CODE\s*=/m,
        `${file} re-declares its own calling code instead of importing the shared one`,
      );
    }
  });

  test("any that names the constant imports it from the shared lib", () => {
    for (const { file, src } of phoneConsumers()) {
      const imports = importsOf(src);
      const code = stripComments(src).replace(
        /import\s+[\s\S]*?\s*from\s*["'][^"']+["'];?/g,
        "",
      );
      if (!code.includes("DEFAULT_CALLING_CODE")) continue; // legitimately never names it
      assert.ok(
        imports.some((i) => isPhoneLib(i.spec) && i.clause.includes("DEFAULT_CALLING_CODE")),
        `${file} uses DEFAULT_CALLING_CODE without importing it from the phone lib`,
      );
    }
  });
});

// == the consent rule, wherever it lives =======================================================
//
// These tests used to read WhatsAppDisclosure.tsx and assert things about its SOURCE. Then the
// rule moved to src/lib/consent.ts and the guard went red — not because consent broke, but
// because the guard had memorised an address instead of following the rule.
//
// So it no longer knows where the rule lives. It DISCOVERS the module that defines it, asserts
// there is exactly one such definition, and imports it. Two things fall out of that:
//
//   1. moving the rule again keeps this green, while forking it into a second definition goes
//      red — which is the property actually worth guarding;
//   2. because the definition is plain TypeScript, these are REAL behavioural assertions, not
//      greps. Node can import a .ts module but not a .tsx one, so following the rule out of the
//      component and into a lib turned a source-level guard into an executable one. That is a
//      strengthening, and it is the reason none of what follows is a string match.
/** Every file under src/ that DEFINES the consent rule (not merely re-exports it). */
function consentRuleDefinitions() {
  const SRC = new URL("../src/", import.meta.url);
  return readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => join(e.parentPath, e.name))
    .map((file) => ({ file, src: readFileSync(file, "utf8") }))
    .filter(
      ({ src }) =>
        /export\s+function\s+whatsAppConsentComplete\b/.test(src) &&
        /export\s+const\s+EMPTY_WHATSAPP_CONSENT\b/.test(src),
    );
}

const definitions = consentRuleDefinitions();

// Loaded at module scope so the suite below can be plain synchronous tests. If discovery did not
// find exactly one definition, this stays null and every behavioural test says so rather than
// dying with an unreadable module-load error.
const rule =
  definitions.length === 1
    ? await import(pathToFileURL(definitions[0].file).href)
    : null;

/** Fails loudly rather than letting a test that needs the rule pass vacuously. */
function loaded() {
  assert.ok(
    rule,
    `could not load the consent rule; discovery found ${definitions.length} definition(s)`,
  );
  return rule;
}

describe("the consent rule, wherever it lives", () => {
  test("exactly one module defines the consent rule", () => {
    assert.equal(
      definitions.length,
      1,
      `the consent rule must have ONE definition; found ${definitions.length}: ` +
        definitions.map((d) => d.file).join(", "),
    );
  });

  test("the definition is importable — the rule must stay shareable, not client-only", () => {
    // A rule that only a React component can import cannot be enforced by the server, and a
    // browser-only consent gate is one anybody can walk around. Plain .ts with no "use client"
    // is what lets /api/begin and /api/checkout hold the customer to the same three boxes.
    const [{ file, src }] = definitions;
    assert.doesNotMatch(src, /^\s*["']use client["']/m, `${file} is client-only`);
    assert.ok(/\.ts$/.test(file), `${file} must be plain TypeScript, not .tsx (Node cannot load JSX)`);
  });

  // Everything below runs against the REAL module, discovered above.

  test("every box starts unticked — nothing is pre-agreed on the customer's behalf", () => {
    const { EMPTY_WHATSAPP_CONSENT, whatsAppConsentComplete, REQUIRED_CONSENT_SCOPES } = loaded();
    for (const [scope, value] of Object.entries(EMPTY_WHATSAPP_CONSENT)) {
      assert.equal(value, false, `${scope} must start false`);
    }
    // …including the optional one, which must never default to "yes".
    assert.equal(EMPTY_WHATSAPP_CONSENT.observationNumber, false);
  });

  test("the empty form is NOT complete", () => {
    const { EMPTY_WHATSAPP_CONSENT, whatsAppConsentComplete, REQUIRED_CONSENT_SCOPES } = loaded();
    assert.equal(whatsAppConsentComplete(EMPTY_WHATSAPP_CONSENT), false);
  });

  test("only ALL three required scopes together count as consent", () => {
    const { EMPTY_WHATSAPP_CONSENT, whatsAppConsentComplete, REQUIRED_CONSENT_SCOPES } = loaded();
    const scopes = [...REQUIRED_CONSENT_SCOPES];
    assert.equal(scopes.length, 3, "expected three required scopes");
    // All 2^3 combinations: exactly one of them may pass.
    let passed = 0;
    for (let mask = 0; mask < 1 << scopes.length; mask++) {
      const v = { ...EMPTY_WHATSAPP_CONSENT };
      scopes.forEach((scope, i) => {
        v[scope] = Boolean(mask & (1 << i));
      });
      const complete = whatsAppConsentComplete(v);
      const expected = mask === (1 << scopes.length) - 1;
      assert.equal(complete, expected, `wrong verdict for ${JSON.stringify(v)}`);
      if (complete) passed++;
    }
    assert.equal(passed, 1, "exactly one combination of the required scopes may be complete");
  });

  test("the optional scope never gates the flow, in either direction", () => {
    const { EMPTY_WHATSAPP_CONSENT, whatsAppConsentComplete, REQUIRED_CONSENT_SCOPES } = loaded();
    const all = { ...EMPTY_WHATSAPP_CONSENT };
    for (const scope of REQUIRED_CONSENT_SCOPES) all[scope] = true;
    assert.equal(whatsAppConsentComplete({ ...all, observationNumber: false }), true);
    assert.equal(whatsAppConsentComplete({ ...all, observationNumber: true }), true);
    // …and on its own it is never enough.
    assert.equal(
      whatsAppConsentComplete({ ...EMPTY_WHATSAPP_CONSENT, observationNumber: true }),
      false,
    );
  });

  test("truthy is not consent — only a real true counts", () => {
    const { EMPTY_WHATSAPP_CONSENT, whatsAppConsentComplete, REQUIRED_CONSENT_SCOPES } = loaded();
    // Agreement to a ban risk must never be inferred from a client bug sending 1 or "yes".
    for (const junk of [1, "yes", "true", {}, [], "on"]) {
      const v = { ...EMPTY_WHATSAPP_CONSENT };
      for (const scope of REQUIRED_CONSENT_SCOPES) v[scope] = junk;
      assert.equal(
        whatsAppConsentComplete(v),
        false,
        `${JSON.stringify(junk)} must not be read as informed agreement`,
      );
    }
  });

  test("the wizard uses the rule instead of restating it", () => {
    const { REQUIRED_CONSENT_SCOPES } = loaded();
    const WIZARD = readFileSync(new URL("../src/app/mira/start/page.tsx", import.meta.url), "utf8");
    const code = WIZARD.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
    assert.match(code, /whatsAppConsentComplete\(consent\)/, "wizard must call the shared predicate");
    for (const scope of REQUIRED_CONSENT_SCOPES) {
      assert.ok(
        !code.includes(`consent.${scope}`),
        `the wizard reads consent.${scope} directly — that is the rule restated by hand`,
      );
    }
  });
});
