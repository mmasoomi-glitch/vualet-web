/**
 * content-pipeline-test.mjs — jury #107 constraint 5.
 *
 * The property under test is NOT "does it write nice copy". It is:
 *   nothing this pipeline produces can reach a live commercial site
 *   without a human deliberately changing it by hand.
 *
 * Everything is offline: the LLM client is injected as a fake, and the only
 * filesystem writes go to a throwaway temp directory. No network, no live DB.
 *
 * Run: node --test scripts/content-pipeline-test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  DRAFT_STATUS,
  DRAFTS_DIR,
  REVIEW_CHECKLIST,
  REQUIRED_FRONT_MATTER_KEYS,
  SOURCED_FACTS,
  TOPICS,
  AUDIENCES,
  LANGUAGES,
  generateDraft,
  serializeDraft,
  writeDraft,
  validateFrontMatter,
  guardClaims,
  factById,
  isUrlSafeSlug,
  slugify,
  canonicalUrlFor,
  draftFilename,
  listTopics,
  offlineComposer,
  runCli,
} from "./content-pipeline.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pipelineSrc = readFileSync(join(root, "scripts", "content-pipeline.mjs"), "utf8");
/**
 * Comments describe the rule ("there is no --publish flag"); code enforces it.
 * Scan the CODE, so prose about the prohibition can never satisfy or violate it.
 */
const pipelineCode = pipelineSrc.replace(/\/\*[\s\S]*?\*\//g, " ");

/** A fake LLM client. Records its inputs; never touches the network. */
function fakeLlm(body, sink) {
  return {
    kind: "fake-llm",
    async complete(args) {
      if (sink) sink.push(args);
      return typeof body === "function" ? body(args) : body;
    },
  };
}

const FIXED_NOW = "2026-08-05T00:00:00.000Z";
const baseDeps = () => ({ now: () => FIXED_NOW });

const blocking = (findings) => findings.filter((f) => f.severity === "block");
const rules = (findings) => [...new Set(findings.map((f) => f.rule))];

function tempDrafts() {
  return mkdtempSync(join(tmpdir(), "mira-drafts-"));
}

/* ---------------------------------------------------------------- 1. status */

test("1. every generated draft, for every topic and language, has status 'draft'", async () => {
  for (const topic of TOPICS) {
    for (const lang of Object.keys(LANGUAGES)) {
      const draft = await generateDraft(
        { topic: topic.id, audience: topic.audiences[0], language: lang },
        baseDeps(),
      );
      assert.equal(draft.frontMatter.status, "draft", `${topic.id}/${lang}`);
      assert.equal(draft.frontMatter.status, DRAFT_STATUS);
    }
  }
});

test("2. status cannot be overridden by caller input", async () => {
  const draft = await generateDraft(
    {
      topic: "voice-notes-in-your-own-language",
      language: "en",
      // every shape an attacker/careless dev might try:
      status: "published",
      publish: true,
      frontMatter: { status: "published" },
    },
    { ...baseDeps(), status: "published", publish: true },
  );
  assert.equal(draft.frontMatter.status, "draft");
});

test("3. serializeDraft emits 'status: draft' even if the draft object is mutated", async () => {
  const draft = await generateDraft({ topic: "load-your-own-knowledge" }, baseDeps());
  draft.frontMatter.status = "published"; // tamper
  const md = serializeDraft(draft);
  assert.match(md, /^status: draft$/m);
  assert.doesNotMatch(md, /^status: published$/m);
});

test("4. writeDraft refuses to write anything whose status is not 'draft'", async () => {
  const dir = tempDrafts();
  try {
    const draft = await generateDraft({ topic: "load-your-own-knowledge" }, baseDeps());
    draft.frontMatter.status = "published";
    assert.throws(() => writeDraft(draft, { dir }), /only writes drafts/);
    assert.equal(readdirSync(dir).length, 0, "nothing may be written");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* -------------------------------------------------- 2. no publish code path */

test("5. there is NO publish code path in the pipeline source", () => {
  assert.doesNotMatch(
    pipelineCode,
    /status\s*[:=]\s*["'`](published|public|live|approved)["'`]/,
    "no code may assign a published status",
  );
  assert.doesNotMatch(
    pipelineCode,
    /(export\s+(async\s+)?function|const)\s+publish\w*\s*[=(]/,
    "no publish function may exist",
  );
  assert.doesNotMatch(
    pipelineCode,
    /--publish|args\.(get|has)\(\s*["']publish/,
    "no CLI flag may publish",
  );
  // DRAFT_STATUS is assigned the literal "draft" exactly once, and nowhere else.
  assert.equal(
    (pipelineCode.match(/DRAFT_STATUS\s*=\s*["'][^"']*["']/g) || []).length,
    1,
    "DRAFT_STATUS must be assigned exactly once",
  );
  assert.match(pipelineCode, /export const DRAFT_STATUS = "draft";/);
  // The serializer must write the constant, not the (mutable) object field.
  assert.match(pipelineCode, /L\.push\(`status: \$\{DRAFT_STATUS\}`\)/);
  // Nothing may re-export or re-derive a status from the environment either.
  assert.doesNotMatch(pipelineCode, /process\.env/, "no env var may influence output");
});

test("6. the pipeline performs no network I/O at all", () => {
  assert.doesNotMatch(pipelineSrc, /\bfetch\s*\(/, "no fetch");
  assert.doesNotMatch(pipelineSrc, /XMLHttpRequest|axios|got\(|undici/, "no http client");
  assert.doesNotMatch(pipelineSrc, /from\s+["']node:(http|https|net|dgram|tls)["']/, "no net imports");
  // Only these node builtins may be imported.
  const imports = [...pipelineSrc.matchAll(/from\s+["'](node:[a-z/]+)["']/g)].map((m) => m[1]);
  for (const i of imports) {
    assert.ok(["node:fs", "node:url", "node:path"].includes(i), `unexpected import ${i}`);
  }
});

test("7. the only write target is the drafts directory, and traversal is refused", async () => {
  const dir = tempDrafts();
  try {
    const draft = await generateDraft({ topic: "built-in-dubai" }, baseDeps());
    const p = writeDraft(draft, { dir });
    assert.ok(p.startsWith(dir), `wrote outside temp drafts dir: ${p}`);
    assert.deepEqual(readdirSync(dir), ["built-in-dubai-mira-by-veridian.en.md"]);

    draft.frontMatter.slug = "../../src/app/page";
    assert.throws(() => writeDraft(draft, { dir }), /unsafe slug/);
    assert.throws(() => draftFilename("../evil", "en"), /unsafe slug/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.match(DRAFTS_DIR.replace(/\\/g, "/"), /\/content\/drafts$/);
});

/* ------------------------------------------------- 3. front-matter validity */

test("8. front-matter is complete and valid for every topic in every language", async () => {
  for (const topic of TOPICS) {
    for (const lang of Object.keys(LANGUAGES)) {
      const draft = await generateDraft({ topic: topic.id, language: lang }, baseDeps());
      const fm = draft.frontMatter;
      for (const k of REQUIRED_FRONT_MATTER_KEYS) {
        assert.ok(fm[k] !== undefined && fm[k] !== null, `${topic.id}/${lang} missing ${k}`);
      }
      const problems = validateFrontMatter(fm);
      assert.deepEqual(problems, [], `${topic.id}/${lang}: ${problems.join("; ")}`);
    }
  }
});

test("9. JSON-LD is a valid Article, matches the page, and carries no publication date", async () => {
  const draft = await generateDraft(
    { topic: "what-each-plan-actually-includes", language: "en" },
    baseDeps(),
  );
  const fm = draft.frontMatter;
  const ld = fm.jsonLd;
  assert.equal(ld["@context"], "https://schema.org");
  assert.equal(ld["@type"], "Article");
  assert.equal(ld.headline, fm.title);
  assert.equal(ld.description, fm.description);
  assert.equal(ld.inLanguage, fm.lang);
  assert.equal(ld.mainEntityOfPage["@id"], fm.canonical);
  assert.equal(ld.creativeWorkStatus, "draft");
  assert.equal(ld.datePublished, undefined, "a draft must never carry datePublished");
  assert.equal(ld.author, undefined, "a human byline is added by a human");

  // and it must survive a round trip through the serialised markdown
  const md = serializeDraft(draft);
  const line = md.split("\n").find((l) => l.startsWith("jsonLd: "));
  assert.ok(line, "jsonLd line present");
  const parsed = JSON.parse(line.slice("jsonLd: ".length));
  assert.equal(parsed["@type"], "Article");
});

test("10. every draft carries the full human-review checklist, unchecked", async () => {
  const draft = await generateDraft({ topic: "an-assistant-that-remembers-you" }, baseDeps());
  assert.deepEqual(draft.frontMatter.reviewChecklist, [...REVIEW_CHECKLIST]);
  assert.ok(REVIEW_CHECKLIST.length >= 10, "checklist must be substantive");
  const md = serializeDraft(draft);
  for (const item of REVIEW_CHECKLIST) {
    assert.ok(md.includes(`  - [ ] ${item}`), `checklist item missing/pre-checked: ${item}`);
  }
  assert.doesNotMatch(md, /- \[x\]/i, "no checklist item may ship pre-ticked");
  assert.match(md, /NOT FOR PUBLICATION/);
});

/* --------------------------------------------------------- 4. claim guard */

test("11. the claim guard flags an invented user count", async () => {
  const draft = await generateDraft(
    { topic: "built-in-dubai" },
    { ...baseDeps(), llm: fakeLlm("Mira is trusted by 40,000 users across 12 countries.") },
  );
  const f = draft.frontMatter.claimFindings;
  assert.ok(blocking(f).length > 0, "must block");
  assert.ok(rules(f).includes("unsourced-statistic"), rules(f).join(","));
  assert.ok(rules(f).includes("unsourced-social-proof"), rules(f).join(","));
  assert.ok(
    f.some((x) => /40,000|adoption/i.test(x.detail) || /40,000/.test(x.sentence)),
    "the finding must quote the offending claim so a human can see it",
  );
});

test("12. the claim guard flags an unearned certification", () => {
  const f = guardClaims("Mira is SOC 2 certified and fully HIPAA compliant.");
  assert.ok(blocking(f).length > 0);
  assert.ok(rules(f).includes("unearned-credential"), rules(f).join(","));
});

test("13. the claim guard flags an integration we have not shipped", () => {
  const f = guardClaims("Mira integrates with Slack and Salesforce, and offers a public API.");
  assert.ok(rules(f).includes("unsupported-capability"), rules(f).join(","));
  assert.ok(
    f.some((x) => /slack/i.test(x.detail)),
    "must name the unsupported term",
  );
  // ...but a surface that IS sourced passes clean
  const ok = guardClaims("Mira works inside Telegram today, with WhatsApp coming soon.");
  assert.equal(
    blocking(ok).filter((x) => x.rule === "unsupported-capability").length,
    0,
    "Telegram/WhatsApp are sourced and must not be flagged",
  );
});

test("14. the claim guard flags a price that is not in tiers.ts", () => {
  const bad = guardClaims("Mira Assistant costs just $19 per month.");
  assert.ok(rules(bad).includes("unsourced-price"), rules(bad).join(","));
  const good = guardClaims("Companion is $14.99 per month and Assistant is $39 per month.");
  assert.equal(good.filter((x) => x.rule === "unsourced-price").length, 0);
});

test("15. the claim guard flags testimonials and absolute guarantees", () => {
  const t = guardClaims('"Mira completely changed how I study." — Sara, Dubai');
  assert.ok(rules(t).includes("testimonial"), rules(t).join(","));

  const a = guardClaims("Mira is the best assistant in the world and is 100% accurate, guaranteed.");
  assert.ok(rules(a).includes("absolute-or-guarantee"), rules(a).join(","));
  assert.ok(blocking(a).length >= 1);
});

test("16. the claim guard FLAGS but never EDITS — the draft body is returned untouched", async () => {
  const dirty = "Mira is trusted by 40,000 users and is ISO 27001 certified.";
  const draft = await generateDraft(
    { topic: "built-in-dubai" },
    { ...baseDeps(), llm: fakeLlm(dirty) },
  );
  assert.equal(draft.body, dirty, "the guard must not rewrite the body");
  assert.ok(serializeDraft(draft).includes(dirty), "the questionable text stays visible to the reviewer");
  assert.ok(draft.frontMatter.blockingFindings > 0);
});

test("17. grounded, offline-composed English copy raises no BLOCKING findings", async () => {
  for (const topic of TOPICS) {
    const draft = await generateDraft({ topic: topic.id, language: "en" }, baseDeps());
    const b = blocking(draft.frontMatter.claimFindings);
    assert.deepEqual(
      b.map((x) => `${x.rule}: ${x.sentence}`),
      [],
      `${topic.id} should be clean when composed only from sourced facts`,
    );
  }
});

/* ------------------------------------------------------- 5. multilingual */

test("18. Arabic drafts carry lang 'ar', dir 'rtl' and an /ar path", async () => {
  const arabic = "ميرا مساعد يعمل داخل تيليجرام. يمكنك إرسال رسالة صوتية بلغتك.";
  const draft = await generateDraft(
    { topic: "voice-notes-in-your-own-language", language: "ar" },
    { ...baseDeps(), llm: fakeLlm(arabic) },
  );
  const fm = draft.frontMatter;
  assert.equal(fm.lang, "ar");
  assert.equal(fm.dir, "rtl");
  assert.equal(fm.languageName, "Arabic");
  assert.equal(fm.jsonLd.inLanguage, "ar");
  assert.equal(fm.canonical, "https://vualet.com/ar/blog/voice-notes-in-your-own-language");
  assert.equal(draft.filename, "voice-notes-in-your-own-language.ar.md");
  const md = serializeDraft(draft);
  assert.match(md, /^lang: ar$/m);
  assert.match(md, /^dir: rtl$/m);
  assert.deepEqual(validateFrontMatter(fm), []);
});

test("19. Farsi drafts carry lang 'fa', dir 'rtl' and an /fa path", async () => {
  const farsi = "میرا یک دستیار است که در تلگرام کار می‌کند.";
  const draft = await generateDraft(
    { topic: "an-assistant-that-remembers-you", language: "fa" },
    { ...baseDeps(), llm: fakeLlm(farsi) },
  );
  const fm = draft.frontMatter;
  assert.equal(fm.lang, "fa");
  assert.equal(fm.dir, "rtl");
  assert.equal(fm.languageName, "Farsi");
  assert.equal(fm.canonical, "https://vualet.com/fa/blog/an-ai-assistant-that-remembers-you");
  assert.equal(draft.filename, "an-ai-assistant-that-remembers-you.fa.md");
  assert.deepEqual(validateFrontMatter(fm), []);
});

test("20. Gulf Arabic (ar-AE) is a distinct locale with its own path and rtl", async () => {
  const draft = await generateDraft(
    { topic: "built-in-dubai", language: "ar-AE", audience: "gulf-professional" },
    { ...baseDeps(), llm: fakeLlm("ميرا مبنية في دبي.") },
  );
  assert.equal(draft.frontMatter.lang, "ar-AE");
  assert.equal(draft.frontMatter.dir, "rtl");
  assert.equal(draft.frontMatter.canonical, "https://vualet.com/ar-ae/blog/built-in-dubai-mira-by-veridian");
  assert.equal(draft.filename, "built-in-dubai-mira-by-veridian.ar-ae.md");
});

test("21. English is ltr with no path prefix", async () => {
  const draft = await generateDraft({ topic: "built-in-dubai", language: "en" }, baseDeps());
  assert.equal(draft.frontMatter.dir, "ltr");
  assert.equal(draft.frontMatter.canonical, "https://vualet.com/blog/built-in-dubai-mira-by-veridian");
});

test("22. an RTL draft always carries a blocking 'verify the translation' finding", async () => {
  // The fact corpus is English. The scanner must NOT return a false all-clear
  // on a language it cannot semantically check.
  for (const lang of ["ar", "ar-AE", "fa"]) {
    const draft = await generateDraft(
      { topic: "your-assistant-is-yours-alone", language: lang },
      { ...baseDeps(), llm: fakeLlm("نص عربي بسيط.") },
    );
    const f = draft.frontMatter.claimFindings;
    assert.ok(
      rules(f).includes("translation-unverified"),
      `${lang} must demand a human language check, got: ${rules(f).join(",")}`,
    );
    assert.ok(blocking(f).length > 0, `${lang} must block`);
  }
  // ...and Latin-script detectors still work inside RTL text
  const mixed = guardClaims("ميرا trusted by 90,000 users في دبي.", { langCode: "ar" });
  assert.ok(rules(mixed).includes("unsourced-social-proof"), rules(mixed).join(","));
});

/* ------------------------------------------------------ 6. slugs & topics */

test("23. every slug is URL-safe and unique across the topic catalogue", () => {
  const seen = new Map();
  for (const t of TOPICS) {
    assert.ok(isUrlSafeSlug(t.slug), `not URL-safe: ${t.slug}`);
    assert.equal(encodeURIComponent(t.slug), t.slug, `slug needs encoding: ${t.slug}`);
    assert.ok(!seen.has(t.slug), `duplicate slug ${t.slug} (${t.id} vs ${seen.get(t.slug)})`);
    seen.set(t.slug, t.id);
  }
  const ids = TOPICS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, "topic ids must be unique");
  assert.equal(listTopics().length, TOPICS.length);

  assert.equal(slugify("Why an assistant that says “I don’t know” is worth more"),
    "why-an-assistant-that-says-i-don-t-know-is-worth-more");
  assert.ok(isUrlSafeSlug(slugify("ميرا Mira — Built in Dubai!")));
  assert.equal(isUrlSafeSlug("Not Safe"), false);
  assert.equal(isUrlSafeSlug("trailing-"), false);
});

test("24. every topic is grounded: it cites real facts and declares what it must not claim", () => {
  assert.ok(TOPICS.length >= 8, "the catalogue must be substantive");
  for (const t of TOPICS) {
    assert.ok(t.factIds.length > 0, `${t.id} cites no facts`);
    for (const id of t.factIds) {
      const f = factById(id); // throws on an unknown fact id
      assert.ok(f.source.includes(".ts"), `${id} must cite a source file`);
    }
    assert.ok(t.mustNotClaim.length > 0, `${t.id} declares no boundary`);
    assert.ok(t.audiences.every((a) => AUDIENCES.includes(a)), `${t.id} bad audience`);
    assert.ok(t.description.length >= 50, `${t.id} description too short for SEO`);
  }
  // a topic may never cite a fact that does not exist
  assert.throws(() => factById("we-have-a-mobile-app"), /unknown fact id/);
  // and every fact must carry a file:line citation
  for (const f of SOURCED_FACTS) {
    assert.match(f.source, /\.(ts|tsx):\d+/, `fact ${f.id} lacks a file:line citation`);
  }
});

test("25. unknown topic, audience or language is rejected outright", async () => {
  await assert.rejects(
    () => generateDraft({ topic: "10-ways-mira-boosts-productivity" }, baseDeps()),
    /unknown topic/,
  );
  await assert.rejects(
    () => generateDraft({ topic: TOPICS[0].id, audience: "everyone" }, baseDeps()),
    /unknown audience/,
  );
  await assert.rejects(
    () => generateDraft({ topic: TOPICS[0].id, language: "de" }, baseDeps()),
    /unsupported language/,
  );
  // an off-catalogue topic object cannot be smuggled in either
  await assert.rejects(
    () =>
      generateDraft(
        { topic: { id: "fake", slug: "fake", title: "x", factIds: [], mustNotClaim: [] } },
        baseDeps(),
      ),
    /unknown topic/,
  );
});

/* ------------------------------------------------------- 7. injection & CLI */

test("26. the LLM client is injected and actually used; the default is offline", async () => {
  const sink = [];
  const draft = await generateDraft(
    { topic: "reading-a-photo-of-a-page", audience: "student", language: "en" },
    { ...baseDeps(), llm: fakeLlm("Mira reads text out of images and documents.", sink) },
  );
  assert.equal(sink.length, 1, "the injected client must be called exactly once");
  assert.equal(sink[0].audience, "student");
  assert.equal(sink[0].language, "en");
  assert.deepEqual(sink[0].facts.map((f) => f.id), ["ocr", "surface"]);
  assert.match(sink[0].system, /Never invent statistics/);
  assert.match(sink[0].system, /Never describe internal architecture/);
  assert.equal(draft.frontMatter.generator, "content-pipeline.mjs (fake-llm)");

  const offline = await generateDraft({ topic: "reading-a-photo-of-a-page" }, baseDeps());
  assert.equal(offline.frontMatter.generator, "content-pipeline.mjs (offline-deterministic)");
  assert.equal(offlineComposer().kind, "offline-deterministic");

  await assert.rejects(
    () => generateDraft({ topic: TOPICS[0].id }, { ...baseDeps(), llm: fakeLlm("   ") }),
    /empty body/,
  );
});

test("27. the CLI writes drafts only, and every file on disk says status: draft", async () => {
  const dir = tempDrafts();
  try {
    const r = await runCli(["--topic", "built-in-dubai,load-your-own-knowledge", "--language", "en"], {
      ...baseDeps(),
      dir,
    });
    assert.equal(r.written.length, 2);
    for (const p of r.written) {
      const md = readFileSync(p, "utf8");
      assert.match(md, /^status: draft$/m);
      assert.match(md, /MACHINE-GENERATED DRAFT/);
      assert.match(md, /- \[ \] /);
    }
    assert.match(r.text, /Nothing here is published\. A human publishes\./);

    const listing = await runCli(["--list"], baseDeps());
    assert.equal(listing.written.length, 0, "listing writes nothing");
    assert.match(listing.text, /never published/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("28. canonical URLs are absolute https and language-prefixed", () => {
  assert.equal(canonicalUrlFor("a-slug", "en"), "https://vualet.com/blog/a-slug");
  assert.equal(canonicalUrlFor("a-slug", "ar"), "https://vualet.com/ar/blog/a-slug");
  assert.equal(canonicalUrlFor("a-slug", "fa"), "https://vualet.com/fa/blog/a-slug");
  assert.equal(
    canonicalUrlFor("a-slug", "en", "https://staging.example.com"),
    "https://staging.example.com/blog/a-slug",
  );
  assert.throws(() => canonicalUrlFor("a-slug", "klingon"), /unsupported language/);
});

/* =========================================================================
 * 8. CLAIM-GUARD BYPASSES
 *
 * Every case below was a REAL, WORKING bypass of the first version of the
 * guard, found by attacking it rather than by reading it. Each one published
 * a claim the product cannot honour and drew zero blocking findings.
 *
 * They are named individually and asserted individually on purpose: when one
 * regresses, the failure names the exact hole that reopened.
 * ========================================================================= */

/** The property every bypass case asserts: a human is forced to look. */
function assertBlocked(body, opts, why) {
  const findings = guardClaims(body, opts);
  const b = blocking(findings);
  assert.ok(
    b.length > 0,
    `BYPASS REOPENED — ${why}\n  body: ${body}\n  findings: ${
      findings.length ? findings.map((f) => `${f.rule}(${f.severity})`).join(", ") : "NONE"
    }`,
  );
  return findings;
}

test("29. BYPASS: a capability claim with no grammatical subject", () => {
  // The core defect. The capability and statistic scans only ran when the
  // sentence named mira/veridian/vualet/afaq/we/our/us, carried a "$", or put a
  // number next to one of five units. Ordinary marketing prose asserts a
  // capability without a subject, and was scanned for nothing at all.
  const f = assertBlocked(
    "Integrates seamlessly with Slack, Salesforce and Notion.",
    {},
    "subjectless capability claim",
  );
  assert.ok(rules(f).includes("unsupported-capability"), rules(f).join(","));
  assert.ok(
    f.some((x) => /slack/i.test(x.detail)) && f.some((x) => /salesforce/i.test(x.detail)),
    "every unsupported integration must be named for the reviewer",
  );

  assertBlocked("Available on WhatsApp, iOS and Android today.", {}, "subjectless platform list");
  assertBlocked("## Salesforce, HubSpot and Notion", {}, "capability claim inside a heading");
});

test("30. BYPASS: a pronoun or an imperative instead of the product name", () => {
  assertBlocked("It connects to your CRM and exposes a public API.", {}, "pronoun subject 'it'");
  assertBlocked("Connect your Salesforce account and sync every contact.", {}, "imperative mood");
  assertBlocked("You can connect your Salesforce CRM and export to Excel.", {}, "second person");
  assertBlocked("Need Slack integration and single sign-on? Both are built in.", {}, "question form");
});

test("31. BYPASS: subjectless adoption and coverage numbers", () => {
  // isProductClaim's number test only recognised %, users, customers, languages
  // and countries. "businesses" and "teams" walked straight through.
  assertBlocked("Over 40,000 businesses rely on it every day.", {}, "adoption noun off the old list");
  assertBlocked("Cuts admin work by half for millions of teams.", {}, "adoption brag with no digit");
  assertBlocked("Mira is used by forty thousand businesses.", {}, "spelled-out adoption figure");
});

test("32. BYPASS: a statistic whose number collides with a sourced number", () => {
  // The old scan did `if (corpus.numbers.has(n)) continue` BEFORE classifying
  // the unit. $39 is the real Assistant price, so "39% faster" was waved
  // through as sourced — a fabricated benchmark cleared by a price.
  const pct = assertBlocked("Mira is 39% faster than every other assistant.", {}, "39% cleared by the $39 price");
  assert.ok(
    pct.some((x) => x.rule === "unsourced-statistic" && /percentage/i.test(x.detail)),
    rules(pct).join(","),
  );
  assertBlocked("Mira is used by 15 million people.", {}, "15 cleared by the 15M token allowance");
  assertBlocked("Mira is used by ٤٠,٠٠٠ users.", {}, "Arabic-Indic numerals evaded ASCII number patterns");
});

test("33. BYPASS: a price in any currency other than a dollar sign", () => {
  // The price scan was a single `\$\s?\d` pattern, so a price we do not charge
  // published cleanly the moment it was written any other way.
  assertBlocked("Mira Assistant costs just 19 USD per month.", {}, "trailing currency code");
  assertBlocked("Mira Companion is only AED 49 a month.", {}, "non-USD currency");
  assertBlocked("Mira Assistant costs €29 per month.", {}, "euro symbol");
  // ...and a real price recycled into an invented charge
  const fee = assertBlocked("There is a $79 one-time setup fee.", {}, "sourced price reused as a new fee");
  assert.ok(rules(fee).includes("unsourced-commercial-term"), rules(fee).join(","));

  // A price with NO subject must be checked exactly like one that names Mira.
  // (This regressed once already: a shared /g regex advanced its lastIndex
  // during the claim-shape test, so matchAll then skipped the only match, and
  // it only showed up on sentences that did not name the product.)
  for (const body of ["Only AED 49 a month, cancel whenever.", "Just $19 a month."]) {
    const f = assertBlocked(body, {}, "subjectless price claim");
    assert.ok(rules(f).includes("unsourced-price"), `${body} -> ${rules(f).join(",")}`);
  }
  const same = (s) => blocking(guardClaims(s)).filter((x) => x.rule === "unsourced-price").length;
  assert.equal(
    same("Just $19 a month."),
    same("Mira is just $19 a month."),
    "naming the product must not change how many price findings are raised",
  );
});

test("34. BYPASS: text hidden from the scanner but visible to the reader", () => {
  // splitSentences deleted whole code fences and anything inside a
  // `_(source: ...)_` marker. Both render in full on a published page.
  assertBlocked(
    "Here is the setup:\n```\nMira is SOC 2 certified and integrates with Slack.\n```\n",
    {},
    "claim parked inside a fenced block",
  );
  assertBlocked(
    "Mira works today. _(source: Mira integrates with Salesforce and is HIPAA compliant)_",
    {},
    "claim parked inside a fake citation marker",
  );
  // A genuine file:line citation is still treated as reviewer metadata.
  const real = guardClaims("Mira remembers you. _(source: src/lib/veridian-kb.ts:53-55)_");
  assert.equal(blocking(real).length, 0, "a real citation must not be scanned as prose");
});

test("35. BYPASS: term matching defeated by emphasis, zero-width or homoglyph characters", () => {
  // These render to a reader as "Salesforce" and "Slack" but broke a plain
  // substring match. It is not enough that SOMETHING blocks: the finding has to
  // name the actual vendor, or the reviewer cannot tell what is being claimed.
  for (const [body, why] of [
    ["Mira integrates with Sal*esforce* and Sl*ack*.", "markdown emphasis inside the word"],
    ["Mira integrates with Sl​ack and Sales​force.", "zero-width space inside the word"],
  ]) {
    const f = assertBlocked(body, {}, why);
    assert.ok(
      f.some((x) => /"slack"/.test(x.detail)) && f.some((x) => /"salesforce"/.test(x.detail)),
      `the finding must name the real term, not a fragment: ${JSON.stringify(f.map((x) => x.detail))}`,
    );
  }
  // Homoglyphs are not folded to ASCII, but the substituted word is no longer a
  // sourced word either, so the open-world half still forces a human look.
  assertBlocked("Mira integrates with Ѕlack and Saleѕforce.", {}, "Cyrillic homoglyph vendor names");
});

test("36. BYPASS: corpus substring suppression ('line' inside 'headline')", () => {
  // Support was tested with corpus.text.includes(term) — a raw substring match.
  // The word "headline" appears in a sourced fact, so the LINE messenger was
  // permanently considered a shipped integration.
  assertBlocked("Mira is available on LINE messaging today.", {}, "'line' suppressed by 'headline'");
  // All-lowercase, and no proper noun for the open-world check to catch, so
  // this case can ONLY be caught by matching the term list on word boundaries.
  const f = assertBlocked(
    "Mira offers line messaging in every chat.",
    {},
    "'line' suppressed by 'headline' (term list is the only detector here)",
  );
  assert.ok(
    f.some((x) => x.rule === "unsupported-capability" && /"line"/.test(x.detail)),
    `support must be tested on word boundaries, not substrings: ${JSON.stringify(f)}`,
  );
});

test("37. BYPASS: an integration nobody thought to deny-list", () => {
  // A fixed list can only catch the vendors somebody imagined. The guard now
  // reads the object of a capability predicate and grounds it against the facts.
  const f = assertBlocked("Mira syncs with Xero, QuickBooks and Airtable.", {}, "off-denylist vendors");
  assert.ok(
    f.some((x) => /xero/i.test(x.detail)) && f.some((x) => /quickbooks/i.test(x.detail)),
    "the reviewer must be told which name is unsupported",
  );
  assertBlocked("Works with Xero, QuickBooks and Airtable out of the box.", {}, "off-denylist, no subject");
  assertBlocked("Accepts PDF, DOCX and XLSX uploads of any size.", {}, "unsourced file formats");
  assertBlocked("Mira talks natively to Xero and QuickBooks.", {}, "adverb between verb and preposition");
});

test("38. BYPASS: subjectless capability prose with no vendor name at all", () => {
  assertBlocked("Ships production-grade, enterprise-ready applications in minutes.", {}, "output quality claim");
  assertBlocked("Reads handwriting from any scanned page with ease.", {}, "handwriting OCR is not sourced");
  assertBlocked("Places phone calls on your behalf and books your meetings.", {}, "telephony is not sourced");
  assertBlocked("Runs entirely offline on your own hardware.", {}, "offline/self-hosted is not sourced");
  assertBlocked("Unlimited messages on every plan, forever.", {}, "unlimited usage is not sourced");
  assertBlocked("Fully compliant with every major data protection regime.", {}, "compliance with no scheme named");
  assertBlocked("Cancel whenever you like, with a full refund.", {}, "refund terms are not sourced");
  assertBlocked("Certified to the highest security standards.", {}, "subjectless certification");
});

test("39. BYPASS: an attributed quote the testimonial pattern did not recognise", () => {
  // The old pattern demanded a double quote AND an uppercase attribution.
  const a = assertBlocked("'Mira completely changed how I study.' — Sara", {}, "single-quoted testimonial");
  assert.ok(rules(a).includes("testimonial"), rules(a).join(","));
  const b = assertBlocked("“Mira completely changed how I study.” — by sara", {}, "lowercase 'by' attribution");
  assert.ok(rules(b).includes("testimonial"), rules(b).join(","));
  // An ordinary possessive apostrophe must never be read as an opening quote.
  const ok = guardClaims("Your conversations are yours, and your assistant is sealed off from everyone else's.");
  assert.equal(
    ok.filter((x) => x.rule === "testimonial").length,
    0,
    "an apostrophe is not a testimonial",
  );
});

test("40. BYPASS: an unknown language silently scanned as English", () => {
  // LANGUAGES[langCode] || LANGUAGES.en meant guardClaims(body, {langCode:"de"})
  // returned a confident English-shaped all-clear for text it cannot read.
  const f = assertBlocked("Ein einfacher deutscher Satz.", { langCode: "de" }, "unknown langCode fell back to English");
  assert.ok(rules(f).includes("translation-unverified"), rules(f).join(","));
  assert.ok(
    f.some((x) => /not a supported language/i.test(x.detail)),
    "the finding must say the scan cannot be trusted",
  );
});

test("41. BYPASS: a caller widening the fact corpus to whitelist its own claims", () => {
  // guardClaims took `facts` from the caller and grounded against whatever it
  // was given. Hand it a fact that says the thing you want to claim and every
  // check passes.
  const forged = [
    { id: "surface", claim: "Mira is SOC 2 certified and integrates with Slack.", source: "made-up" },
  ];
  const f = assertBlocked("Mira is SOC 2 certified and integrates with Slack.", { facts: forged }, "forged fact corpus");
  assert.ok(rules(f).includes("corpus-tampered"), rules(f).join(","));
  assert.ok(rules(f).includes("unearned-credential"), "the forged fact must not have granted support");
  assert.ok(rules(f).includes("unsupported-capability"), rules(f).join(","));

  // A caller may still legitimately NARROW the corpus to the real facts.
  const narrowed = guardClaims("Mira remembers you across every conversation.", {
    facts: [SOURCED_FACTS.find((x) => x.id === "memory")],
  });
  assert.equal(
    narrowed.filter((x) => x.rule === "corpus-tampered").length,
    0,
    "an authentic subset of SOURCED_FACTS is not tampering",
  );
});

test("42. the guard still FLAGS and never EDITS, for every bypass case", async () => {
  // A guard that rewrote the copy would hide the very sentence a human needs to
  // see. Findings are information; the body is returned byte-for-byte.
  const dirty = "Integrates seamlessly with Slack, Salesforce and Notion.";
  const draft = await generateDraft(
    { topic: "built-in-dubai" },
    { ...baseDeps(), llm: fakeLlm(dirty) },
  );
  assert.equal(draft.body, dirty, "the guard must not rewrite the body");
  assert.ok(draft.frontMatter.blockingFindings > 0, "and it must block");
  const md = serializeDraft(draft);
  assert.ok(md.includes(dirty), "the questionable sentence stays visible to the reviewer");
  assert.match(md, /rule: unsupported-capability/);
});

/* =========================================================================
 * 9. OVER-FLAGGING — the other way a guard dies
 *
 * A guard that flags honest copy trains writers to skim past every finding,
 * and then the one real finding is skimmed past too. These sentences are all
 * drawn from the sourced facts and MUST come back clean of blocking findings.
 * ========================================================================= */

const LEGITIMATE_SENTENCES = [
  "Mira is an AI assistant you talk to inside the chat apps you already use — Telegram today, with WhatsApp coming soon.",
  "You can send it a voice note on Telegram today and it understands you and can reply naturally, in your own language.",
  "Mira speaks many languages, out loud, with warmth and tone rather than a flat robotic read.",
  "You can load Mira with your own knowledge — your notes, documents, study material, or reference text.",
  "Mira can read text out of images and documents (OCR).",
  "Mira remembers you across every conversation.",
  "When it does not know something, it tells you it does not know instead of inventing an answer.",
  "Free: 1,000,000 tokens per month at no cost.",
  "Companion: $14.99 per month, 15M tokens per month.",
  "Assistant: $39 per month, 60M tokens per month.",
  "Studio: $79 per month, 200M tokens per month.",
  "Mira has a small-builds capability, currently in beta.",
  "Your conversations are yours, and your assistant is sealed off from everyone else's.",
  "Veridian CLS Unlimited is a coming-soon flagship tier for Mira; it is not yet released.",
  "Vualet is a family of software products built in Dubai, and Mira is its flagship.",
  "Mira is backed by Satellite Electronic Trading, a Dubai technology company.",
  "There is no separate app to install and no new phone number to manage.",
  "You can send it a photo of a page, a receipt, or a screenshot, and it can pull the text and work with it.",
];

test("43. legitimate, sourced sentences raise NO blocking findings", () => {
  assert.ok(LEGITIMATE_SENTENCES.length >= 8, "the anti-over-flagging corpus must be substantive");
  const overflagged = [];
  for (const s of LEGITIMATE_SENTENCES) {
    const b = blocking(guardClaims(s));
    if (b.length) overflagged.push(`${s}\n     -> ${b.map((x) => `${x.rule}: ${x.detail}`).join("\n     -> ")}`);
  }
  assert.deepEqual(
    overflagged,
    [],
    "over-flagging honest copy teaches writers to ignore the guard, which is how it stops working",
  );
});

test("44. tightening the guard did not make grounded drafts noisy", async () => {
  // The same property as test 17, restated against the hardened guard: every
  // topic, composed only from sourced facts, must still come back clean.
  for (const topic of TOPICS) {
    const draft = await generateDraft({ topic: topic.id, language: "en" }, baseDeps());
    assert.deepEqual(
      blocking(draft.frontMatter.claimFindings).map((x) => `${x.rule}: ${x.sentence}`),
      [],
      `${topic.id} must stay clean`,
    );
  }
  // Sourced prices and token allowances must not be mistaken for inventions.
  const priced = guardClaims(
    "Companion is $14.99 per month with 15M tokens, Assistant is $39 with 60M tokens, Studio is $79 with 200M tokens.",
  );
  assert.equal(blocking(priced).length, 0, JSON.stringify(priced, null, 1));
});

test("45. a finding is never reported twice for the same sentence", () => {
  // A reviewer shown the same line four times stops reading the report.
  const f = guardClaims("Mira is SOC 2 certified, SOC 2 certified and SOC 2 certified.");
  const keys = f.map((x) => `${x.rule}|${x.severity}|${x.sentence}|${x.detail}`);
  assert.equal(new Set(keys).size, keys.length, "findings must be de-duplicated");
});

/* =========================================================================
 * 10. THE DRAFTS-ONLY INVARIANT, RESTATED
 *
 * Hardening the guard must not have opened a way to publish. This is the
 * property the whole file exists to protect, so it is asserted again here,
 * against the finished module rather than against the source text alone.
 * ========================================================================= */

test("46. there is still NO publish path: not an export, not a flag, not an env var", async () => {
  // (a) Nothing exported can publish, whatever it is called.
  const mod = await import("./content-pipeline.mjs");
  for (const [name, value] of Object.entries(mod)) {
    assert.doesNotMatch(
      name,
      /publish|deploy|release|goLive|commit|push|upload/i,
      `export "${name}" is named like a publish path`,
    );
    if (typeof value === "string") {
      assert.notEqual(value, "published", `export "${name}" carries a published status`);
    }
  }
  assert.equal(mod.DRAFT_STATUS, "draft");

  // (b) No CLI argument, in any combination, produces anything but a draft.
  const dir = tempDrafts();
  try {
    for (const argv of [
      ["--topic", "built-in-dubai"],
      ["--topic", "built-in-dubai", "--publish"],
      ["--topic", "built-in-dubai", "--status", "published"],
      ["--topic", "built-in-dubai", "--live", "true"],
    ]) {
      const r = await runCli(argv, { ...baseDeps(), dir });
      for (const p of r.written) {
        const md = readFileSync(p, "utf8");
        assert.match(md, /^status: draft$/m, `${argv.join(" ")} produced a non-draft`);
        assert.doesNotMatch(md, /^status: (published|live|public|approved)$/m);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // (c) The guard cannot be turned off, and its findings cannot become a
  //     licence to publish: a clean scan still ships as status draft.
  const clean = await generateDraft(
    { topic: "an-assistant-that-remembers-you" },
    { ...baseDeps(), llm: fakeLlm("Mira remembers you across every conversation.") },
  );
  assert.equal(blocking(clean.frontMatter.claimFindings).length, 0, "this copy is sourced");
  assert.equal(clean.frontMatter.status, "draft", "a clean scan is still only a draft");
  assert.match(serializeDraft(clean), /^status: draft$/m);

  // (d) The claim guard is not optional — every generated draft carries a
  //     findings array, so "no findings key" can never mean "not checked".
  assert.ok(Array.isArray(clean.frontMatter.claimFindings));
  assert.equal(typeof clean.frontMatter.blockingFindings, "number");
});

test("47. KNOWN RESIDUALS — recorded so they are chosen, not forgotten", () => {
  // Honesty about what this guard still cannot do. Both are deliberate; both
  // are asserted, so a future change that closes them fails loudly here and
  // this note gets updated rather than quietly becoming false.

  // (1) HTML comments are not scanned. They do not render to a reader, so they
  //     are not published claims. If the rendering layer ever emits comments as
  //     visible text, this must change.
  const comment = guardClaims("Mira is great. <!-- Mira is ISO 27001 certified --> Read on.");
  assert.equal(blocking(comment).length, 0, "HTML comments are intentionally not scanned");

  // (2) An all-lowercase vendor name after an unlisted verb defeats the
  //     proper-noun half of the capability check. It is NOT silent — the
  //     lexical rule still surfaces the unknown words to the reviewer — but it
  //     does not block.
  const lower = guardClaims("mira talks natively to xero and quickbooks.");
  assert.equal(blocking(lower).length, 0, "documented residual: lowercase vendor names");
  assert.ok(
    lower.some((x) => x.rule === "unverified-wording" && /xero/i.test(x.detail)),
    "the residual must at least be visible to a human, not silent",
  );
});
