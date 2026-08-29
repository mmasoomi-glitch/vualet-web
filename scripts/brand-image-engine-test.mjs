// Tests for the offline brand image engine.
//
// No network, no filesystem writes, no API key. Every outside edge is injected:
// `fetch` is a fake that records what it was called with, `ocr` is a fake gate
// whose verdict the test controls, `env` is a plain object holding a FAKE key.
//
// The security assertions are the ones that matter most here: the whole point
// of an operator tool that holds a credential is that the credential never
// escapes into a return value, an error, or a log line.
//
// Run: node --test scripts/brand-image-engine-test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  BRAND,
  SECTIONS,
  SECTION_NAMES,
  NO_TEXT_INSTRUCTION,
  TEXT_WORD_CAP,
  API_KEY_ENV,
  DEFAULT_MODEL,
  OPENROUTER_IMAGE_URL,
  buildPrompt,
  parseCssTokens,
  buildBrand,
  paletteSwatches,
  countWords,
  judgeOcr,
  redact,
  generate,
  appendManifest,
  unavailableOcrGate,
  DEFAULT_OUT_DIR,
} from "./brand-image-engine.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// A fake that is obviously not a real credential, but is shaped like one so the
// redaction paths are genuinely exercised.
const FAKE_KEY = "sk-or-v1-FAKEKEYFORTESTSONLY0123456789abcdef";

// --- fakes -----------------------------------------------------------------

/** An image API that always succeeds, and records every call. */
function fakeFetch({ status = 200, b64 = "aGVsbG8=" } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ data: [{ b64_json: b64 }] }),
    };
  };
  fn.calls = calls;
  return fn;
}

/** An OCR gate whose reading is scripted per attempt. */
function fakeOcr(readings) {
  const queue = [...readings];
  return {
    name: "fake",
    async detect() {
      const next = queue.length > 1 ? queue.shift() : queue[0];
      return { supported: true, engine: "fake", text: next };
    },
  };
}

const okDeps = (over = {}) => ({
  fetch: fakeFetch(),
  ocr: fakeOcr([""]),
  env: { [API_KEY_ENV]: FAKE_KEY },
  now: () => new Date("2026-08-05T12:00:00.000Z"),
  ...over,
});

// ---------------------------------------------------------------------------
// 1. The palette is the REAL one, read off the real stylesheet
// ---------------------------------------------------------------------------

test("brand palette is parsed from the real mira-theme.css, not hardcoded prose", () => {
  // These are the values physically present in src/app/mira/mira-theme.css.
  // If the brand is recoloured, this test fails — which is the point.
  assert.equal(BRAND.palette.seal, "#E4A130", "amber verified-seal");
  assert.equal(BRAND.palette.sealDeep, "#C77D2E", "deep amber");
  assert.equal(BRAND.palette.sand, "#F7E7C6", "warm sand");
  assert.equal(BRAND.palette.aether, "#6366F1", "Vualet house indigo");
  assert.equal(BRAND.palette.aetherInk, "#4F46E5", "text-safe indigo");
  assert.equal(BRAND.palette.lavender, "#C7B8F0", "lavender");
  assert.equal(BRAND.palette.paper, "#F6F3EC", "warm paper");
  assert.equal(BRAND.palette.canvas, "#FCFAF5", "canvas");
  assert.equal(BRAND.palette.ink, "#1C1830", "deep indigo-plum ink");
  assert.equal(BRAND.palette.fog, "#E4E0D8", "warm hairline");
  assert.equal(BRAND.palette.verify, "#6BCE9B", "verification green");
});

test("CSS parsing ignores hex values that only appear inside comments", () => {
  // mira-theme.css quotes the RETIRED rose #E68A85 in a comment. A naive scan
  // would harvest a dead colour, so comments must be stripped first.
  const css = `.mira-root {
    /* was --mira-rose: #E68A85; the old pink */
    --mira-rose: #E4A130;
  }`;
  const tokens = parseCssTokens(css, ".mira-root");
  assert.equal(tokens["mira-rose"], "#E4A130");
  const themeSrc = readFileSync(join(root, "src", "app", "mira", "mira-theme.css"), "utf8");
  assert.match(themeSrc, /#E68A85/, "the retired rose is still quoted in a comment");
  assert.notEqual(BRAND.palette.sealDeep, "#E68A85", "must not pick up the retired rose");
});

test("a missing brand token fails loudly instead of producing a silent gap", () => {
  const io = {
    readFile: (p) =>
      p.includes("mira-theme")
        ? ".mira-root { --mira-rose: #E4A130; }" // everything else missing
        : "@theme { --color-vualet-indigo: #6366F1; }",
    themePath: "mira-theme.css",
    globalsPath: "globals.css",
  };
  assert.throws(() => buildBrand(io), /missing from mira-theme\.css/);
});

// ---------------------------------------------------------------------------
// 2. Prompts carry the real palette values
// ---------------------------------------------------------------------------

test("every section's prompt carries the real palette hex values", () => {
  for (const section of SECTION_NAMES) {
    const prompt = buildPrompt({ section, subject: "a folded sheet of warm paper" });
    for (const hex of ["#E4A130", "#6366F1", "#F6F3EC", "#1C1830", "#C7B8F0"]) {
      assert.ok(
        prompt.includes(hex),
        `section ${section} prompt is missing palette value ${hex}`,
      );
    }
  }
});

test("prompt carries the house style and the brand fonts", () => {
  const prompt = buildPrompt({ section: "hero", subject: "a quiet desk" });
  assert.match(prompt, /warm paper/i);
  assert.match(prompt, /indigo presence/i);
  assert.match(prompt, /amber verified-seal/i);
  assert.match(prompt, /Fraunces/);
  assert.match(prompt, /Inter/);
});

test("sections cover the real site surfaces and carry their routes", () => {
  assert.deepEqual(
    [...SECTION_NAMES].sort(),
    ["account", "blogHeader", "hero", "legal", "ogCard", "plans"],
  );
  assert.equal(SECTIONS.hero.route, "/mira");
  assert.equal(SECTIONS.plans.route, "/mira/plans");
  assert.equal(SECTIONS.account.route, "/mira/account");
  // Honesty: /blog does not exist in src/app yet, and the data says so.
  assert.equal(SECTIONS.hero.routed, true);
  // /blog shipped; ogCard is still art for a surface with no route of its own.
  assert.equal(SECTIONS.blogHeader.routed, true);
});

test("an unknown section is rejected rather than silently generating off-brand art", () => {
  assert.throws(() => buildPrompt({ section: "dashboard", subject: "x" }), /unknown section/);
  assert.throws(() => buildPrompt({ section: "hero" }), /requires a subject/);
});

// ---------------------------------------------------------------------------
// 3. The no-text-first rule
// ---------------------------------------------------------------------------

test("the no-text instruction is present on pass 1 for EVERY section", () => {
  for (const section of SECTION_NAMES) {
    const prompt = buildPrompt({ section, subject: "a seal pressed into wax" });
    assert.ok(
      prompt.includes(NO_TEXT_INSTRUCTION),
      `section ${section} pass-1 prompt is missing the no-text instruction`,
    );
    assert.match(prompt, /NO text, NO letters, NO words, NO numbers/);
  }
});

test("pass 1 is always no-text, even when the caller asked for nothing special", async () => {
  const deps = okDeps();
  await generate({ section: "hero", subject: "warm paper" }, deps);
  const body = JSON.parse(deps.fetch.calls[0].init.body);
  assert.ok(body.prompt.includes(NO_TEXT_INSTRUCTION));
  assert.equal(deps.fetch.calls[0].url, OPENROUTER_IMAGE_URL);
  assert.equal(body.model, DEFAULT_MODEL);
});

test("an OCR-detected text result FAILS the gate and triggers regeneration", async () => {
  // Attempt 1 comes back with legible text; attempt 2 is clean.
  const deps = okDeps({ ocr: fakeOcr(["Mira Ledger", ""]) });
  const res = await generate({ section: "hero", subject: "a warm desk" }, deps);

  assert.equal(res.ok, true);
  assert.equal(deps.fetch.calls.length, 2, "must have regenerated exactly once");
  assert.equal(res.attempts.length, 2);
  assert.equal(res.attempts[0].ocr.verdict, "text-detected");
  assert.equal(res.attempts[0].ocr.detectedWords, 2);
  assert.equal(res.attempts[1].ocr.verdict, "clean");
  // The retry prompt escalates the wording.
  assert.match(JSON.parse(deps.fetch.calls[1].init.body).prompt, /previous attempt was REJECTED/);
});

test("retries are BOUNDED — the engine gives up honestly instead of looping", async () => {
  const deps = okDeps({ ocr: fakeOcr(["Buy Mira Now"]) }); // never clean
  const res = await generate(
    { section: "plans", subject: "three folded sheets", maxAttempts: 3 },
    deps,
  );

  assert.equal(res.ok, false);
  assert.equal(res.reason, "ocr_gate_failed");
  assert.equal(deps.fetch.calls.length, 3, "must stop at maxAttempts, not retry forever");
  assert.equal(res.attempts.length, 3);
  assert.match(res.message, /gave up after 3 attempt/);
  assert.equal(res.manifestEntry.outcome, "gave-up");
});

test("with no OCR engine the gate FAILS CLOSED and does not burn retries", async () => {
  const deps = okDeps({ ocr: unavailableOcrGate });
  const res = await generate({ section: "hero", subject: "a seal", maxAttempts: 5 }, deps);

  assert.equal(res.ok, false);
  assert.equal(res.reason, "ocr_unavailable");
  assert.equal(deps.fetch.calls.length, 1, "an ungateable image must not be retried 5x");
  assert.match(res.message, /no OCR engine/);
});

test("acceptUnverified is an explicit override and is stamped UNVERIFIED", async () => {
  const deps = okDeps({ ocr: unavailableOcrGate });
  const res = await generate(
    { section: "hero", subject: "a seal", acceptUnverified: true },
    deps,
  );
  assert.equal(res.ok, true);
  assert.equal(res.verdict, "unverified", "must never be recorded as 'clean'");
  assert.equal(res.manifestEntry.attempts[0].ocr.supported, false);
});

// ---------------------------------------------------------------------------
// 4. The text variant, and its hard word cap
// ---------------------------------------------------------------------------

test("a text variant over the word cap is REJECTED before any API call", async () => {
  const deps = okDeps();
  const tooMany = "Mira keeps a private verifiable record of everything you own";
  assert.ok(countWords(tooMany) > TEXT_WORD_CAP);

  await assert.rejects(
    () => generate({ section: "ogCard", subject: "a seal", allowText: true, text: tooMany }, deps),
    /exceeds the cap of 6/,
  );
  assert.equal(deps.fetch.calls.length, 0, "must not spend a request on a rejected variant");
});

test("buildPrompt also rejects a too-busy text variant on its own", () => {
  assert.throws(
    () =>
      buildPrompt({
        section: "hero",
        subject: "a seal",
        allowText: true,
        text: "one two three four five six seven",
      }),
    /just enough beautiful/,
  );
  assert.throws(
    () => buildPrompt({ section: "hero", subject: "a seal", allowText: true, text: "  " }),
    /requires the exact text/,
  );
});

test("an approved text variant is allowed, and drops the no-text instruction", () => {
  const prompt = buildPrompt({
    section: "ogCard",
    subject: "a seal",
    allowText: true,
    text: "Kept, not guessed",
  });
  assert.ok(!prompt.includes(NO_TEXT_INSTRUCTION), "the no-text rule does not apply here");
  assert.match(prompt, /TEXT VARIANT, reviewed and approved/);
  assert.match(prompt, /"Kept, not guessed"/);
  assert.match(prompt, /#E4A130/, "still carries the brand palette");
});

test("OCR judging: a text variant that renders MORE words than approved is rejected", () => {
  const busier = judgeOcr(
    { supported: true, text: "one two three four five six seven" },
    { allowText: true },
  );
  assert.equal(busier.pass, false);
  assert.equal(busier.verdict, "too-busy");

  const unexpected = judgeOcr(
    { supported: true, text: "Kept not guessed and more" },
    { allowText: true, expectedText: "Kept, not guessed" },
  );
  assert.equal(unexpected.pass, false);
  assert.equal(unexpected.verdict, "unexpected-text");

  const good = judgeOcr(
    { supported: true, text: "Kept, not guessed" },
    { allowText: true, expectedText: "Kept, not guessed" },
  );
  assert.equal(good.pass, true);
});

// ---------------------------------------------------------------------------
// 5. The API key never escapes
// ---------------------------------------------------------------------------

test("the API key is NEVER present in the returned object", async () => {
  const deps = okDeps({ ocr: fakeOcr([""]) });
  const res = await generate({ section: "hero", subject: "a warm desk" }, deps);
  const serialised = JSON.stringify(res);
  assert.ok(!serialised.includes(FAKE_KEY), "the key leaked into the result object");
  assert.ok(!serialised.includes("Bearer"), "no authorization material in the result");
});

test("the API key is NEVER present in a thrown error", async () => {
  // Force the transport to throw with a message that echoes the credential back,
  // the way a badly-behaved HTTP client or proxy sometimes does.
  const leaky = async () => {
    throw new Error(`connect ECONNREFUSED; sent Authorization: Bearer ${FAKE_KEY}`);
  };
  const err = await generate({ section: "hero", subject: "x" }, okDeps({ fetch: leaky })).then(
    () => null,
    (e) => e,
  );
  assert.ok(err, "should have thrown");
  const dump = `${err.message} ${err.stack} ${JSON.stringify(err)}`;
  assert.ok(!dump.includes(FAKE_KEY), "the key leaked into the thrown error");
  assert.match(err.message, /\[redacted\]/);
});

test("the API key is NEVER present in any log line", async () => {
  const lines = [];
  const deps = okDeps({
    ocr: fakeOcr(["Mira", ""]), // forces a retry, so more lines are emitted
    log: (m) => lines.push(m),
  });
  await generate({ section: "hero", subject: "a warm desk" }, deps);
  assert.ok(lines.length > 0, "the run should have logged something");
  for (const line of lines) {
    assert.ok(!line.includes(FAKE_KEY), `key leaked into log line: ${line}`);
  }
});

test("a missing key names the ENV VAR and never invents a value", async () => {
  const deps = okDeps({ env: {} });
  const err = await generate({ section: "hero", subject: "x" }, deps).then(
    () => null,
    (e) => e,
  );
  assert.match(err.message, new RegExp(`set the ${API_KEY_ENV} environment variable`));
  assert.equal(deps.fetch.calls.length, 0);
});

test("redact scrubs whole keys, key fragments and bearer headers", () => {
  assert.equal(redact(`key=${FAKE_KEY}`, FAKE_KEY), "key=[redacted]");
  assert.ok(!redact(`head ${FAKE_KEY.slice(0, 20)}`, FAKE_KEY).includes("FAKEKEY"));
  assert.match(redact("Authorization: Bearer abc123def456", null), /Bearer \[redacted\]/);
});

test("the source file contains no inlined credential", () => {
  const src = readFileSync(join(root, "scripts", "brand-image-engine.mjs"), "utf8");
  // Keep the failure message small — a full-file diff is unreadable.
  assert.ok(!/sk-or-v1-[A-Za-z0-9]{16,}/.test(src), "no OpenRouter key may be inlined");
  assert.ok(src.includes("env[apiKeyEnv]"), "the key must be read from the injected env");
  assert.ok(src.includes("process.env"), "the default env is the real environment");
  assert.ok(src.includes(`"${API_KEY_ENV}"`), "the env var is referenced by NAME");
});

// ---------------------------------------------------------------------------
// 6. The manifest — no asset is a mystery
// ---------------------------------------------------------------------------

test("the manifest entry records prompt, model, OCR verdict and timestamp", async () => {
  const deps = okDeps({ ocr: fakeOcr([""]) });
  const res = await generate({ section: "legal", subject: "folded paper", mood: "sober" }, deps);
  const entry = res.manifestEntry;

  assert.equal(entry.section, "legal");
  assert.equal(entry.model, DEFAULT_MODEL);
  assert.equal(entry.variant, "no-text");
  assert.equal(entry.outcome, "accepted");
  assert.equal(entry.timestamp, "2026-08-05T12:00:00.000Z");
  assert.equal(entry.attempts[0].ocr.verdict, "clean");
  assert.ok(entry.attempts[0].prompt.includes("#E4A130"), "the exact prompt is recorded");
  assert.equal(entry.attempts[0].noTextInstruction, true);
});

test("appendManifest accumulates entries without losing earlier ones", async () => {
  let stored = JSON.stringify({ generator: "brand-image-engine", images: [{ section: "hero" }] });
  const io = {
    outDir: "/fake/out",
    mkdir: async () => {},
    readFile: async () => stored,
    writeFile: async (_p, data) => {
      stored = data;
    },
  };
  const out = await appendManifest({ section: "plans" }, io);
  assert.equal(out.count, 2);
  const parsed = JSON.parse(stored);
  assert.deepEqual(
    parsed.images.map((i) => i.section),
    ["hero", "plans"],
  );
});

// ---------------------------------------------------------------------------
// 7. Offline-only — jury #107 constraint 4
// ---------------------------------------------------------------------------

test("no route, page or lib in src/ imports the image engine", () => {
  // A source scan is the honest check: the engine must be unreachable from the
  // live customer path, not merely "not called today".
  const hits = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) {
        if (readFileSync(p, "utf8").includes("brand-image-engine")) hits.push(p);
      }
    }
  };
  walk(join(root, "src"));
  assert.deepEqual(hits, [], `the engine is imported from src/: ${hits.join(", ")}`);
});

test("output does NOT default into public/ — the manifest must not be web-served", async () => {
  // The manifest records prompts and model names; jury #107 constraint 1 puts
  // model names on the deny-list. public/ is served by Next, so a default of
  // public/brand-assets would publish them at a live URL.
  assert.ok(
    !DEFAULT_OUT_DIR.split(/[\\/]/).includes("public"),
    `default output must stay outside the served tree, got ${DEFAULT_OUT_DIR}`,
  );

  let written = null;
  await appendManifest(
    { section: "hero" },
    {
      mkdir: async () => {},
      readFile: async () => {
        throw new Error("none");
      },
      writeFile: async (p) => {
        written = p;
      },
    },
  );
  assert.ok(!written.split(/[\\/]/).includes("public"), `manifest written into public/: ${written}`);
});

test("importing the engine performs no network call and no generation", () => {
  // The module was imported at the top of this file with no fetch injected and
  // no key in the environment. If import had side effects, we'd never get here.
  assert.equal(typeof generate, "function");
  assert.equal(typeof paletteSwatches(BRAND)[0], "string");
  assert.ok(paletteSwatches(BRAND).some((s) => s.includes("#E4A130")));
});
