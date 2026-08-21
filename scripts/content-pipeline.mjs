/**
 * content-pipeline.mjs — DRAFTS-ONLY blog/content pipeline.
 *
 * Jury #107 constraint 5: "SEO: technical foundation + DRAFTS-ONLY content.
 * Never auto-publish AI text to a live commercial site."
 *
 * This module can generate a complete, SEO-ready article draft. It cannot
 * publish one. There is no publish function, no `--publish` flag, no
 * `status` option, and no environment variable that changes the outcome.
 * Every artefact this file produces is written with status = DRAFT_STATUS,
 * which is the frozen constant "draft". Turning a draft into a published
 * post requires a human editing the file by hand, in a reviewed commit.
 * Bypassing that is a CODE CHANGE to this file, which is exactly the point.
 *
 * ------------------------------------------------------------------------
 * GROUNDING — every topic and every fact below is traceable to real source.
 * These citations were read on 2026-08-05; re-read them before trusting this
 * summary, because the product moves and stale marketing is how a company
 * gets caught claiming something it cannot do.
 *
 *   src/lib/veridian-kb.ts                 — the public marketing fact set
 *   src/app/mira/_components/tiers.ts      — the single source of truth for plans
 *   src/app/about/page.tsx                 — the corporate identity statements
 *
 * NOTHING may be claimed in a draft that is not supported by those files.
 * The claim guard below enforces it mechanically and flags — never silently
 * rewrites — anything it cannot support. A human sees every flag.
 * ------------------------------------------------------------------------
 *
 * No network. This file performs no I/O other than writing draft files to the
 * drafts directory. A real LLM client is INJECTED by the caller; the built-in
 * default composer is deterministic and offline, so the test suite (and CI)
 * never touches the network.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, sep } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..");

/* =========================================================================
 * 1. THE HARD OUTPUT RULE
 * ========================================================================= */

/**
 * The ONLY status this pipeline can emit. Frozen, not configurable, not
 * derived from input. Every write path asserts against this exact value.
 */
export const DRAFT_STATUS = "draft";

/** Where drafts land. Deliberately NOT inside src/ — nothing here is routable. */
export const DRAFTS_DIR = join(REPO_ROOT, "content", "drafts");

/**
 * Canonical origin for blog URLs. UNVERIFIED against DNS by this script — it is
 * a constant a human confirms at review time, and the checklist says so.
 */
export const SITE_ORIGIN = "https://vualet.com";

/**
 * Required before a human may flip status by hand. Every draft carries it.
 * Order matters: these run cheapest-to-most-expensive for a reviewer.
 */
export const REVIEW_CHECKLIST = Object.freeze([
  "A named human has read this draft end to end.",
  "Every product claim was checked against src/lib/veridian-kb.ts and src/app/mira/_components/tiers.ts.",
  "All claim-guard findings below are resolved or consciously accepted, with initials.",
  "No invented statistics, user counts, revenue figures, or growth numbers.",
  "No testimonials or quotes that a real named person did not actually say.",
  "No certification, compliance, award or partnership we have not actually earned.",
  "Pricing in the body still matches src/app/mira/_components/tiers.ts today.",
  "Beta features are described as beta; roadmap items are described as not yet released.",
  "Canonical URL and slug confirmed against the live site routing.",
  "For non-English drafts: a fluent speaker of that language has verified meaning and tone.",
  "Author byline is a real accountable human, not 'the team' and not an AI.",
  "Human sets status from 'draft' to published BY HAND, in a reviewed commit.",
]);

/* =========================================================================
 * 2. SOURCED FACTS — the entire universe a draft may claim from
 * ========================================================================= */

/**
 * @typedef {{ id: string, claim: string, source: string }} SourcedFact
 * `source` is a file:line citation, so a reviewer can verify in one jump.
 */

/** @type {readonly SourcedFact[]} */
export const SOURCED_FACTS = Object.freeze([
  {
    id: "surface",
    claim:
      "Mira is an AI assistant you talk to inside WhatsApp — the chat app you already use. There is no separate app to install and no new phone number to manage: Mira works through your own WhatsApp account, in a group you create.",
    source: "src/lib/veridian-kb.ts:23-25",
  },
  {
    id: "voice",
    claim:
      "Mira is voice-first. You can send it a voice note on WhatsApp and it understands you and can reply naturally, in your own language.",
    source: "src/lib/veridian-kb.ts:28-30",
  },
  {
    id: "whatsapp-linking",
    claim:
      "Mira works inside WhatsApp through the customer's own WhatsApp account, not a number of ours. You link your account once when you sign up, then you create a WhatsApp group and talk to Mira there, and Mira replies into that group through your linked account. WhatsApp will not let you create a group containing only yourself, so you add one contact at the moment you create it and can remove them afterwards. Linking a personal account to an automated assistant carries a real risk that WhatsApp restricts or blocks the connected number.",
    source: "src/lib/veridian-kb.ts:98-100",
  },
  {
    id: "multilingual",
    claim:
      "Mira speaks many languages, out loud, with warmth and tone rather than a flat robotic read. You talk to it by voice in your own language and it replies in kind. Multilingual voice is one of Mira's headline strengths.",
    source: "src/lib/veridian-kb.ts:33-35",
  },
  {
    id: "kb",
    claim:
      "You can load Mira with your own knowledge — your notes, documents, study material, or reference text — and it draws on exactly what you gave it. Useful for study, exam prep, language practice, and answering questions grounded in your own material.",
    source: "src/lib/veridian-kb.ts:38-40",
  },
  {
    id: "builds",
    claim:
      "Mira has a small-builds capability, currently in beta: you can describe a small web app or website in plain words and Mira assembles it and hands it back to you. It is an early beta feature and improving over time.",
    source: "src/lib/veridian-kb.ts:43-45; src/app/mira/_components/tiers.ts:39",
  },
  {
    id: "ocr",
    claim:
      "Mira can read text out of images and documents (OCR). You can send it a photo of a page, a receipt, or a screenshot, and it can pull the text and work with it.",
    source: "src/lib/veridian-kb.ts:48-50",
  },
  {
    id: "memory",
    claim:
      "Mira remembers you across every conversation. It holds the context of what you told it and the persona you shape, so you do not have to repeat yourself. People describe this as a photographic memory for your world.",
    source: "src/lib/veridian-kb.ts:53-55",
  },
  {
    id: "grounded",
    claim:
      "Mira is built to be grounded: it answers from what it actually knows rather than guessing. When it does not know something, it tells you it does not know instead of inventing an answer.",
    source: "src/lib/veridian-kb.ts:58-60",
  },
  {
    id: "privacy",
    claim:
      "Your Mira is private by design. Your conversations are yours, and your assistant is sealed off from everyone else's. Privacy is a core part of the product's design.",
    source: "src/lib/veridian-kb.ts:93-95",
  },
  {
    id: "plan-free",
    claim:
      "Free: 1,000,000 tokens per month at no cost. Includes chat, voice notes, and memory of you across chats, with a cap on voice minutes.",
    source: "src/lib/veridian-kb.ts:63-65; src/app/mira/_components/tiers.ts:16-23",
  },
  {
    id: "plan-companion",
    claim:
      "Companion: $14.99 per month, 15M tokens per month. Everything in Free, plus a persona you shape and the ability to load Mira's knowledge base with your own text.",
    source: "src/lib/veridian-kb.ts:68-70; src/app/mira/_components/tiers.ts:24-32",
  },
  {
    id: "plan-assistant",
    claim:
      "Assistant: $39 per month, 60M tokens per month. Everything in Companion, plus the small-builds pipeline (beta) for small web apps and sites, and priority replies.",
    source: "src/lib/veridian-kb.ts:73-75; src/app/mira/_components/tiers.ts:33-42",
  },
  {
    id: "plan-studio",
    claim:
      "Studio: $79 per month, 200M tokens per month. Everything in Assistant, plus the highest monthly cap and top-of-the-queue priority.",
    source: "src/lib/veridian-kb.ts:78-80; src/app/mira/_components/tiers.ts:43-51",
  },
  {
    id: "roadmap-cls",
    claim:
      "Veridian CLS Unlimited is a coming-soon flagship tier for Mira. Terms and conditions apply. It is on the roadmap and not yet released; details will be announced closer to launch.",
    source: "src/lib/veridian-kb.ts:83-85",
  },
  {
    id: "company",
    claim:
      "Mira is a product powered by Veridian — its proprietary technology — operated by Afaq Alnaseem Trading LLC, a company registered in Dubai, United Arab Emirates. Vualet is a family of software products built in Dubai, and Mira is its flagship. Mira is backed by Satellite Electronic Trading, a Dubai technology company.",
    source: "src/app/about/page.tsx:20-34; src/lib/veridian-kb.ts:88-90",
  },
]);

const FACT_BY_ID = new Map(SOURCED_FACTS.map((f) => [f.id, f]));

/** Look up a fact, or throw — a topic may never cite a fact that does not exist. */
export function factById(id) {
  const f = FACT_BY_ID.get(id);
  if (!f) throw new Error(`unknown fact id: ${id} (topics may only cite SOURCED_FACTS)`);
  return f;
}

/* =========================================================================
 * 3. THE TOPIC MODEL — grounded in what the product actually does
 * ========================================================================= */

export const AUDIENCES = Object.freeze([
  "curious-newcomer",
  "student",
  "small-business-owner",
  "privacy-conscious",
  "gulf-professional",
]);

/**
 * Every topic must cite the facts it rests on. A topic that cannot cite a fact
 * is a topic that promises something we cannot deliver, and it does not ship.
 * `mustNotClaim` is carried into the draft so the reviewer sees the boundary.
 *
 * @typedef {{ id: string, slug: string, title: string, description: string,
 *             factIds: string[], audiences: string[], intent: string,
 *             mustNotClaim: string[] }} Topic
 */

/** @type {readonly Topic[]} */
export const TOPICS = Object.freeze([
  {
    id: "assistant-in-the-chat-you-already-use",
    slug: "ai-assistant-inside-whatsapp-no-new-app",
    title: "An AI assistant that lives in the chat app you already use",
    description:
      "Mira works inside WhatsApp — no separate app to install and no second phone number to manage, because it runs through your own WhatsApp account in a group you create.",
    factIds: ["surface", "whatsapp-linking", "voice", "memory"],
    audiences: ["curious-newcomer", "gulf-professional"],
    intent: "informational",
    mustNotClaim: [
      "Do not say WhatsApp is 'coming soon', not yet available, or on the roadmap — the sourced fact is that WhatsApp is the channel Mira works in (decisions#340).",
      "Do not offer Telegram, or name it as a channel a new customer can choose — it is not in the sourced surface (decisions#340).",
      "Do not describe the WhatsApp link without the restriction risk — the sourced fact states both, and splitting them is how the old copy became dishonest.",
      "Do not name chat platforms we have not shipped (Slack, Discord, iMessage, SMS).",
    ],
  },
  {
    id: "voice-notes-in-your-own-language",
    slug: "voice-notes-in-your-own-language",
    title: "Send a voice note in your own language and be understood",
    description:
      "Mira is voice-first: send a voice note on WhatsApp in the language you think in, and it replies out loud with warmth and tone.",
    factIds: ["voice", "multilingual", "surface"],
    audiences: ["gulf-professional", "curious-newcomer"],
    intent: "informational",
    mustNotClaim: [
      "Do not publish a count of supported languages — no sourced number exists.",
      "Do not claim real-time phone calls; the sourced surface is chat voice notes.",
    ],
  },
  {
    id: "load-your-own-knowledge",
    slug: "load-your-own-notes-into-an-ai-assistant",
    title: "Load your own notes and get answers grounded in them",
    description:
      "Load Mira with your notes, documents or study material and it draws on exactly what you gave it — useful for study, exam prep and language practice.",
    factIds: ["kb", "grounded", "memory"],
    audiences: ["student", "small-business-owner"],
    intent: "informational",
    mustNotClaim: [
      "Do not state a file-size, page-count or document-count limit — none is sourced.",
      "Do not claim specific file format support (PDF, DOCX) — not in the sourced facts.",
    ],
  },
  {
    id: "an-assistant-that-says-i-dont-know",
    slug: "an-ai-that-says-i-dont-know",
    title: "Why an assistant that says “I don’t know” is worth more",
    description:
      "Mira answers from what it actually knows and tells you when it does not know, instead of inventing an answer that reads convincingly.",
    factIds: ["grounded", "memory", "kb"],
    audiences: ["small-business-owner", "privacy-conscious"],
    intent: "thought-leadership",
    mustNotClaim: [
      "Never claim zero hallucinations, 100% accuracy, or any accuracy percentage.",
      "Never describe the mechanism behind grounding — veridian-kb.ts:14 forbids it.",
    ],
  },
  {
    id: "reading-a-photo-of-a-page",
    slug: "read-text-from-a-photo-with-ocr",
    title: "Photograph a page and get the text back",
    description:
      "Send Mira a photo of a page, a receipt or a screenshot and it pulls the text out and works with it.",
    factIds: ["ocr", "surface"],
    audiences: ["student", "small-business-owner"],
    intent: "informational",
    mustNotClaim: [
      "Do not claim an OCR accuracy rate or a supported-language count for OCR.",
      "Do not claim handwriting support — not sourced.",
    ],
  },
  {
    id: "describe-a-small-site-get-a-small-site",
    slug: "describe-a-small-web-app-in-plain-words-beta",
    title: "Describe a small site in plain words (beta)",
    description:
      "Mira's small-builds capability is in beta: describe a small web app or website in plain words and it assembles it and hands it back.",
    factIds: ["builds", "plan-assistant"],
    audiences: ["small-business-owner", "curious-newcomer"],
    intent: "informational",
    mustNotClaim: [
      "The word 'beta' must appear — this is an early feature and saying otherwise oversells it.",
      "Do not claim production-grade, deployable or enterprise output.",
    ],
  },
  {
    id: "what-each-plan-actually-includes",
    slug: "what-each-mira-plan-actually-includes",
    title: "What each Mira plan actually includes",
    description:
      "Free, Companion, Assistant and Studio — what you get on each, in plain language, with the token allowance for each tier.",
    factIds: ["plan-free", "plan-companion", "plan-assistant", "plan-studio", "roadmap-cls"],
    audiences: ["curious-newcomer", "small-business-owner"],
    intent: "commercial",
    mustNotClaim: [
      "Prices must match src/app/mira/_components/tiers.ts on the day of publication.",
      "Veridian CLS Unlimited must be described as not yet released.",
      "Do not invent discounts, trials or refund terms in a blog post.",
    ],
  },
  {
    id: "your-assistant-is-yours-alone",
    slug: "a-private-ai-assistant-by-design",
    title: "Your assistant is sealed off from everyone else’s",
    description:
      "Privacy is part of Mira's design: your conversations are yours, and your assistant is separated from every other customer's.",
    factIds: ["privacy", "memory", "company"],
    audiences: ["privacy-conscious", "small-business-owner"],
    intent: "thought-leadership",
    mustNotClaim: [
      "Never claim a certification we do not hold (SOC 2, ISO 27001, HIPAA, GDPR-certified).",
      "Never describe infrastructure, hosting, encryption internals or architecture.",
    ],
  },
  {
    id: "built-in-dubai",
    slug: "built-in-dubai-mira-by-veridian",
    title: "Built in Dubai: who is behind Mira",
    description:
      "Mira is powered by Veridian and operated by Afaq Alnaseem Trading LLC, a company registered in Dubai, United Arab Emirates.",
    factIds: ["company", "surface"],
    audiences: ["gulf-professional", "privacy-conscious"],
    intent: "brand",
    mustNotClaim: [
      "Do not invent headcount, funding, founding year or customer counts.",
      "Do not name partners or clients who have not agreed in writing to be named.",
    ],
  },
  {
    id: "an-assistant-that-remembers-you",
    slug: "an-ai-assistant-that-remembers-you",
    title: "An assistant that remembers you, so you stop repeating yourself",
    description:
      "Mira holds the context of what you told it and the persona you shape, across every conversation.",
    factIds: ["memory", "grounded", "plan-companion"],
    audiences: ["curious-newcomer", "student"],
    intent: "informational",
    mustNotClaim: [
      "Do not claim a retention period, storage duration or memory capacity — none is sourced.",
      "Do not describe how memory is implemented — veridian-kb.ts:14 forbids the mechanism.",
    ],
  },
]);

export function listTopics() {
  return TOPICS.map((t) => ({ id: t.id, slug: t.slug, title: t.title, audiences: t.audiences }));
}

export function topicById(id) {
  return TOPICS.find((t) => t.id === id);
}

/* =========================================================================
 * 4. LANGUAGES — Arabic, Farsi and Gulf customers are real, verified users
 * ========================================================================= */

/**
 * dir/lang are carried into the front-matter so the rendering layer sets
 * <html lang> and dir correctly. Getting dir wrong on an RTL page is the
 * single most visible way to tell a reader you did not really mean it.
 */
export const LANGUAGES = Object.freeze({
  en: { lang: "en", dir: "ltr", name: "English", script: "latin", pathPrefix: "" },
  ar: { lang: "ar", dir: "rtl", name: "Arabic", script: "arabic", pathPrefix: "/ar" },
  "ar-AE": {
    lang: "ar-AE",
    dir: "rtl",
    name: "Arabic (Gulf)",
    script: "arabic",
    pathPrefix: "/ar-ae",
  },
  fa: { lang: "fa", dir: "rtl", name: "Farsi", script: "arabic", pathPrefix: "/fa" },
});

export function languageMeta(code) {
  const meta = LANGUAGES[code];
  if (!meta) {
    throw new Error(
      `unsupported language: ${code} (supported: ${Object.keys(LANGUAGES).join(", ")})`,
    );
  }
  return meta;
}

/* =========================================================================
 * 5. SLUGS
 * ========================================================================= */

/** URL-safe slug: lowercase ASCII words joined by single hyphens. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(input) {
  const s = String(input)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!s) throw new Error("slugify produced an empty slug");
  return s;
}

export function isUrlSafeSlug(s) {
  return typeof s === "string" && SLUG_RE.test(s) && s.length <= 80;
}

/**
 * Localised slugs stay ASCII on purpose: the language lives in the path prefix
 * (/ar/blog/...), not in percent-encoded Arabic characters. Readable, shareable,
 * and it keeps every slug provably URL-safe.
 */
export function canonicalUrlFor(slug, langCode, origin = SITE_ORIGIN) {
  const meta = languageMeta(langCode);
  return `${origin}${meta.pathPrefix}/blog/${slug}`;
}

/* =========================================================================
 * 6. THE FACTUAL-CLAIM GUARD
 * ========================================================================= */

/**
 * DESIGN RULE, learned by attacking the previous version of this guard:
 *
 *   A CLAIM IS A CLAIM REGARDLESS OF ITS GRAMMATICAL SUBJECT.
 *
 * The first version only scanned for unsupported capabilities and unsourced
 * statistics when a sentence named the company ("Mira", "we", "our"), showed a
 * "$", or carried a number next to one of five units. Ordinary subjectless
 * marketing prose — the single most common shape an LLM produces — was scanned
 * for nothing at all:
 *
 *   "Integrates seamlessly with Slack, Salesforce and Notion."   <- was clean
 *   "Connect your Salesforce account and sync every contact."    <- was clean
 *   "Over 40,000 businesses rely on it every day."               <- was clean
 *
 * So the capability and statistic scans now run on EVERY sentence, and there is
 * a second, open-world detector: when a sentence uses a capability predicate
 * ("integrates with", "works with", "available on", "exports to", ...) every
 * proper noun and acronym after that predicate must appear in the sourced
 * facts, or it is flagged. That catches vendors nobody thought to deny-list.
 *
 * The lexical "unverified-wording" nudge keeps a claim-shape gate, because it
 * is review-severity noise and firing it on every line would train writers to
 * ignore the whole report — which is the other way a guard dies.
 */

const STOPWORDS = new Set(
  ("a about above after again against all am an and any are as at be because been before being " +
    "below between both but by can cannot could did do does doing down during each few for from " +
    "further had has have having he her here hers him his how i if in into is it its itself just " +
    "like me more most my no nor not now of off on once only or other our ours out over own same " +
    "she should so some such than that the their theirs them then there these they this those " +
    "through to too under until up very was we were what when where which while who whom why will " +
    "with you your yours also get got make makes made take takes want need needs use uses using " +
    "one two three way ways thing things much many lot really actually simply " +
    "means mean meant work works working help helps helped give gives given " +
    "day days week weeks month months year years time times " +
    "read reads reading write writes writing send sends sending ask asks asking " +
    "know knows knowing tell tells telling say says said back down out again")
    .split(/\s+/),
);

/** Words that, when unsourced, are the ones that get a company in trouble. */
const CREDENTIAL_TERMS = [
  "soc 2", "soc2", "iso 27001", "iso27001", "iso 9001", "hipaa", "pci dss", "pci-dss",
  "fedramp", "ccpa", "gdpr compliant", "gdpr-compliant", "gdpr certified", "certified",
  "certification", "accredited", "award-winning", "award winning", "patented", "patent-pending",
  "patent pending", "audited", "compliance certified",
  // A subjectless sentence can assert compliance without naming a scheme:
  // "Fully compliant with every major data protection regime."
  "compliant", "compliance", "regulated", "licensed", "iso certified", "penetration tested",
  "independently verified", "third-party audited", "third party audited",
];

const ABSOLUTE_TERMS = [
  "the best", "#1", "number one", "world's leading", "worlds leading", "industry-leading",
  "industry leading", "market-leading", "market leading", "unmatched", "unbeatable",
  "guaranteed", "we guarantee", "100% accurate", "100 % accurate", "always accurate",
  "never wrong", "never fails", "zero hallucination", "zero hallucinations", "flawless",
  "perfect accuracy", "fastest", "most advanced", "revolutionary", "unlimited everything",
  // NOTE: bare "unlimited" is NOT listed — "Veridian CLS Unlimited" is a real,
  // sourced product name and flagging it would train reviewers to ignore us.
  "unlimited messages", "unlimited usage", "unlimited tokens", "unlimited access",
  "unlimited plan", "truly unlimited", "no limits", "never goes down", "always available",
];

const SOCIAL_PROOF_TERMS = [
  "trusted by", "used by thousands", "join thousands", "join millions", "thousands of users",
  "millions of users", "our customers say", "rated", "five stars", "5 stars", "testimonial",
  "loved by", "voted", "customers agree", "as seen in", "featured in", "case study",
];

/**
 * Adoption bragging with no digit in it at all — "millions of teams" — slipped
 * past both the statistic scan (which needs a number) and the fixed social-proof
 * phrases (which only covered "users").
 */
const ADOPTION_NOUN_ALT =
  "users?|customers?|clients?|companies|businesses|organi[sz]ations?|teams?|people|" +
  "professionals?|students?|subscribers?|members?|readers?|developers?|downloads?|installs?|" +
  "countries|cities|languages";

const VAGUE_ADOPTION_RE = new RegExp(
  "\\b(?:tens|dozens|scores|hundreds|thousands|millions|billions|countless|numerous)\\s+of\\s+" +
    `(?:happy\\s+|paying\\s+|active\\s+|satisfied\\s+)?(?:${ADOPTION_NOUN_ALT})\\b`,
  "i",
);

/**
 * Spelled-out adoption figures — "forty thousand businesses" — carry no digit,
 * so neither the statistic scan nor the "thousands of" pattern saw them.
 * "many" is deliberately excluded: "Mira speaks many languages" is sourced copy.
 */
const SPELLED_ADOPTION_RE = new RegExp(
  "\\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|" +
    "thirty|forty|fifty|sixty|seventy|eighty|ninety)?\\s*" +
    "(?:hundreds?|thousands?|millions?|billions?)\\s+" +
    `(?:of\\s+)?(?:happy\\s+|paying\\s+|active\\s+)?(?:${ADOPTION_NOUN_ALT})\\b`,
  "i",
);

/**
 * Commercial terms. A price the corpus happens to contain can be recycled into
 * a charge we never announced — "There is a $79 one-time setup fee" reuses the
 * Studio price and so cleared the price check entirely. The fee language is
 * what gives it away, so that is what gets flagged.
 */
const COMMERCIAL_TERMS = [
  "setup fee", "set-up fee", "one-time fee", "one time fee", "onboarding fee",
  "activation fee", "installation fee", "annual fee", "surcharge", "deposit",
  "add-on", "per seat", "per user", "per device", "billed annually", "billed yearly",
  "annual plan", "yearly plan", "discount", "coupon", "promo code", "price lock",
];

/**
 * Terms that describe a capability, surface or integration. They are NOT
 * banned — they are simply required to appear in the sourced facts. If a term
 * is in the corpus (whatsapp, ocr, voice) it passes; if it is not
 * (slack, api, sso, offline) it is flagged for a human.
 */
const CAPABILITY_TERMS = [
  // "telegram" is here for the same reason as every other name on this list:
  // it must appear in the sourced facts to pass. It did until decisions#340
  // retired it as a customer channel, and it does not any more. Naming it
  // here (rather than only relying on the proper-noun scan) is what catches
  // it in a sentence with no capability predicate, e.g. "send it a voice
  // note on Telegram" — which scanned perfectly clean without this line.
  "telegram",
  "slack", "discord", "signal", "imessage", "sms", "messenger", "wechat", "line", "viber",
  "notion", "zapier", "salesforce", "hubspot", "gmail", "outlook", "google drive", "dropbox",
  "zoom", "teams", "jira", "trello", "shopify", "stripe", "paypal", "calendar", "crm",
  "api", "webhook", "sdk", "plugin", "browser extension", "extension", "self-hosted",
  "self hosted", "on-premise", "on premise", "sso", "saml", "oidc", "2fa", "mfa",
  "end-to-end encryption", "end to end encryption", "encrypted at rest", "zero-knowledge",
  "offline mode", "desktop app", "mobile app", "ios app", "android app", "chrome extension",
  "phone call", "phone calls", "video call", "video calls", "spreadsheet", "database access",
  "open source", "open-source", "free forever", "lifetime deal", "money-back", "money back",
  "refund guarantee", "cancel anytime", "no credit card",
  // Capability shapes a subjectless sentence can assert without naming a vendor.
  "offline", "on-device", "on device", "runs locally", "your own hardware", "your own server",
  "single sign-on", "single sign on", "handwriting", "handwritten",
  "production-grade", "production grade", "production ready", "production-ready",
  "enterprise-ready", "enterprise ready", "enterprise-grade", "enterprise grade", "enterprise",
  "full refund", "refund", "free trial", "money back guarantee", "no questions asked",
];

/**
 * Verbs and phrases that assert a capability. Their presence makes a sentence
 * claim-shaped no matter what the subject is — including no subject at all.
 * Everything AFTER the predicate is treated as the claimed object and must be
 * grounded in the sourced facts.
 *
 * Deliberately NOT included: "powered by" / "backed by" / "built in", which are
 * attribution and geography in our own sourced copy ("built in Dubai"), not
 * capability. Flagging those would be exactly the over-flagging that kills a guard.
 */
const CAPABILITY_PREDICATE_RE = new RegExp(
  "\\b(?:" +
    [
      "integrat(?:e|es|ed|ing|ion|ions)(?:\\s+(?:with|into))?",
      "connects?(?:\\s+(?:to|with))?", "connected\\s+to", "connecting\\s+to",
      "sync(?:s|ed|ing)?\\s+(?:with|to)", "synchronis\\w+\\s+with", "synchroniz\\w+\\s+with",
      "works?\\s+with", "working\\s+with", "compatible\\s+with", "interoperat\\w+\\s+with",
      // An adverb between verb and preposition ("talks natively to Xero") used
      // to break the match, so one optional -ly adverb is tolerated throughout.
      "plugs?\\s+into", "hooks?\\s+into", "links?\\s+to", "pairs?\\s+with",
      "talks?(?:\\s+\\w+ly)?\\s+to", "connects?(?:\\s+\\w+ly)?\\s+(?:to|with)",
      "works?(?:\\s+\\w+ly)?\\s+with", "integrat(?:es?|ing)(?:\\s+\\w+ly)?\\s+with",
      "supports?", "supported", "supporting",
      "available\\s+(?:on|in|for|via|through)", "runs?\\s+on", "deploys?\\s+to",
      "exports?(?:\\s+to)?", "imports?(?:\\s+from)?", "uploads?\\s+to", "downloads?\\s+from",
      "accepts?", "reads?\\s+from", "writes?\\s+to",
      "built\\s+into", "comes?\\s+with", "ships?\\s+with", "bundled\\s+with",
      "works?\\s+(?:inside|within)", "lives?\\s+(?:inside|in)",
    ].join("|") +
    ")\\b",
  "i",
);

/**
 * Capitalised words and acronyms — the shape a vendor, platform or file format
 * takes in English prose. This is what lets the guard flag "Xero, QuickBooks and
 * Airtable" without anyone having deny-listed them.
 */
const PROPER_TOKEN_RE = /\b(?:[A-Z][a-zA-Z0-9]+|[a-zA-Z]*[A-Z]{2,}[a-zA-Z0-9]*)\b/g;

/**
 * Acronyms that are ordinary English/geography rather than product capability.
 * Kept deliberately tiny: every addition is a hole.
 */
const SAFE_ACRONYMS = new Set(["uae", "eu", "us", "usa", "uk", "gcc", "faq", "faqs", "ok", "am", "pm"]);

const PCT_UNITS = new Set(["%", "percent", "percentage"]);

/** Nouns that turn a number into an adoption / coverage brag. Always blocking. */
const ADOPTION_NOUNS = new Set([
  "user", "users", "customer", "customers", "client", "clients", "companies", "company",
  "business", "businesses", "organisation", "organisations", "organization", "organizations",
  "team", "teams", "people", "person", "persons", "student", "students", "professional",
  "professionals", "subscriber", "subscribers", "member", "members", "reader", "readers",
  "developer", "developers", "download", "downloads", "install", "installs",
  "country", "countries", "city", "cities", "language", "languages",
  "review", "reviews", "star", "stars", "rating", "ratings",
]);

/** Nouns that turn a number into a duration/allowance promise. Review-severity. */
const TIME_NOUNS = new Set([
  "hour", "hours", "minute", "minutes", "second", "seconds", "day", "days",
  "week", "weeks", "month", "months", "year", "years",
]);

const NUMBER_UNIT_RE =
  /\b(\d[\d,._]*)\s*(%|percent|percentage)?\s*(million|billion|trillion|bn|k|m)?\s*(x|times faster|times)?\s*([a-z]+)?/gi;

/**
 * Prices. The old version only understood "$", so "19 USD per month" and
 * "AED 49" walked straight past a guard whose entire job is to stop us
 * publishing a price we do not charge.
 */
const PRICE_LEADING_RE =
  /(\$|£|€|₹|\bAED\b|\bUSD\b|\bEUR\b|\bGBP\b|\bSAR\b|\bQAR\b|\bKWD\b|\bINR\b)\s?(\d[\d,]*(?:\.\d{1,2})?)/gi;
const PRICE_TRAILING_RE =
  /(\d[\d,]*(?:\.\d{1,2})?)\s?(USD|AED|EUR|GBP|SAR|QAR|KWD|INR|dollars?|euros?|pounds?|dirhams?|riyals?|rupees?)\b/gi;

/** The only currency our sourced pricing is expressed in. */
const USD_TOKENS = new Set(["$", "usd", "dollar", "dollars"]);

/**
 * An attributed quote. Widened from the original, which required a double quote
 * AND an uppercase first letter in the attribution — so `'...' — by sara` was
 * invisible. The leading boundary is required so an ordinary apostrophe
 * ("everyone else's") can never open a "quote".
 */
const TESTIMONIAL_RE =
  /(?:^|[\s(>[])["“”'‘’«„]([^"“”'‘’«»„]{15,})["“”'‘’»„]\s*[—–\-−]{1,2}\s*(?:by\s+)?\p{L}/u;

function normaliseNumber(raw) {
  return String(raw).replace(/[,_\s]/g, "").replace(/\.0+$/, "");
}

/**
 * Arabic-Indic and Eastern-Arabic digits render as numerals to every reader but
 * matched none of the ASCII number patterns, so "Mira is used by ٤٠,٠٠٠ users"
 * scanned clean. Numbers are folded to ASCII before any numeric rule runs.
 */
const EASTERN_DIGIT_RE = new RegExp("[\\u0660-\\u0669\\u06F0-\\u06F9]", "g");
function normaliseDigits(s) {
  return String(s).replace(EASTERN_DIGIT_RE, (d) => {
    const c = d.codePointAt(0);
    return String(c >= 0x06f0 ? c - 0x06f0 : c - 0x0660);
  });
}

/**
 * Classify one NUMBER_UNIT_RE match into the kind of claim it makes.
 * Shared by the corpus builder and the scanner so "sourced" means the same
 * thing in both directions.
 */
function classifyNumberMatch(m) {
  const n = normaliseNumber(m[1]);
  const pct = (m[2] || "").toLowerCase();
  const magnitude = (m[3] || "").toLowerCase();
  const multiplier = (m[4] || "").toLowerCase();
  const noun = (m[5] || "").toLowerCase();
  if (PCT_UNITS.has(pct)) return { n, kind: "percentage", unit: "percent", text: m[0].trim() };
  if (ADOPTION_NOUNS.has(noun)) return { n, kind: "adoption", unit: noun, text: m[0].trim() };
  if (magnitude || multiplier) {
    return { n, kind: "magnitude", unit: magnitude || multiplier, text: m[0].trim() };
  }
  if (TIME_NOUNS.has(noun)) return { n, kind: "duration", unit: noun, text: m[0].trim() };
  return { n, kind: "bare", unit: "", text: m[0].trim() };
}

/**
 * Everything a draft is allowed to rest on, flattened for lookup.
 *
 * `facts` is caller-supplied, so it is verified against SOURCED_FACTS: a caller
 * that could widen the corpus could whitelist any claim it liked, which would
 * make the whole guard decorative. Foreign facts are dropped and reported.
 */
function buildCorpus(facts = SOURCED_FACTS) {
  const authentic = [];
  const foreign = [];
  for (const f of facts || []) {
    const known = f && f.id ? FACT_BY_ID.get(f.id) : undefined;
    if (known && known.claim === f.claim) authentic.push(known);
    else foreign.push(f);
  }
  const text = authentic.map((f) => f.claim).join("\n").toLowerCase();
  const words = new Set(text.match(/[a-z][a-z'-]*/g) || []);
  const numbers = new Set();
  const numberUnits = new Set();
  for (const m of text.matchAll(/\d[\d,._]*/g)) numbers.add(normaliseNumber(m[0]));
  // Token allowances are written as "15M"/"60M"; also index the bare digits.
  for (const m of text.matchAll(/(\d[\d,._]*)\s*m\b/g)) numbers.add(normaliseNumber(m[1]));
  for (const m of text.matchAll(NUMBER_UNIT_RE)) {
    const c = classifyNumberMatch(m);
    numberUnits.add(`${c.n}|${c.kind}|${c.unit}`);
  }
  return { text, words, numbers, numberUnits, foreign };
}

/**
 * Word-boundary lookup into the corpus.
 *
 * The previous version used `corpus.text.includes(term)`, a raw substring test,
 * so "line" was silently considered sourced because the word "headline" appears
 * in a fact. "Mira is available on LINE messaging" therefore passed clean.
 */
function corpusHasTerm(corpus, term) {
  return new RegExp(
    `(?:^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^a-z0-9]|$)`,
    "i",
  ).test(corpus.text);
}

/** Is this word (or a simple inflection of it) present in the sourced facts? */
function corpusHasWord(corpus, word) {
  if (corpus.words.has(word)) return true;
  const stems = [
    word.replace(/s$/, ""), word.replace(/es$/, ""),
    word.replace(/ing$/, ""), word.replace(/ed$/, ""), word.replace(/ies$/, "y"),
  ];
  return stems.some((s) => s.length > 2 && corpus.words.has(s));
}

/**
 * The text the term scanners actually see.
 *
 * Markdown emphasis and zero-width characters are removed, because
 * "Sal*esforce*" and "Sl​ack" render to a reader as "Salesforce" and "Slack"
 * but defeated a plain substring match. The ORIGINAL sentence is what gets
 * reported, so the reviewer sees exactly what the writer wrote.
 */
// Soft hyphen, zero-width space/non-joiner/joiner, LRM/RLM, word joiner, BOM.
// Written as escapes on purpose: a file about honesty must not hide characters.
const INVISIBLE_RE = new RegExp("[\\u00AD\\u200B-\\u200F\\u2060\\uFEFF]", "g");

function scanText(sentence) {
  return String(sentence)
    .replace(INVISIBLE_RE, "")
    .replace(/[*_`~]+/g, "")
    .toLowerCase();
}

/**
 * Split on Latin and Arabic/Farsi sentence terminators.
 *
 * Citation markers and HTML comments are stripped first: they are reviewer
 * metadata (file paths, line numbers), not assertions to the reader, and
 * scanning them would bury the real findings in noise.
 */
export function splitSentences(body) {
  return String(body)
    // Fenced blocks are NOT skipped any more. The old version deleted them
    // wholesale, so `​```\nMira is SOC 2 certified.\n```​` was invisible to the
    // guard while rendering to the reader in full. Only the fence markers go.
    .replace(/^[ \t]*`{3,}[a-zA-Z0-9+#-]*[ \t]*$/gm, "\n")
    // Citation markers are reviewer metadata, not assertions — but only real
    // file:line citations are stripped. The old pattern removed ANYTHING inside
    // `_(source: ...)_`, so a whole false claim could be parked there and still
    // render on the page as ordinary italic text.
    .replace(/_\(source:[^)]*\.tsx?:\d[^)]*\)_/g, " ")
    // HTML comments do not render to a reader, so they are genuinely not claims.
    .replace(/<!--[\s\S]*?-->/g, " ")
    .split(/(?<=[.!?؟۔…])\s+|\n{2,}|\n(?=#)/)
    .map((s) => s.replace(/^[#>*\-\s]+/, "").trim())
    .filter((s) => s.length > 0);
}

// Latin product nouns, plus the Arabic/Farsi renderings of "Mira" and "Veridian",
// so an RTL sentence is still recognised as a claim about the product.
const PRODUCT_SUBJECT_RE =
  /\b(mira|veridian|vualet|afaq|we|our|us)\b|ميرا|میرا|فيريديان|فریدیان/i;

/**
 * Is this sentence CLAIM-SHAPED?
 *
 * Note what this is and is not used for. The capability scan and the statistic
 * scan no longer consult it at all — they run on every sentence, because a
 * capability claim is a capability claim whether or not it names the company.
 * This only gates the review-severity lexical nudge, where firing on every line
 * would be noise.
 *
 * The old `isProductClaim` required a company name, a "$", or a number next to
 * one of five units. Subjectless prose ("Integrates seamlessly with Slack"),
 * pronoun prose ("It connects to your CRM") and imperative prose ("Connect your
 * Salesforce account") were all invisible. Grammatical subject is now irrelevant.
 */
/**
 * Every price in a sentence, in any currency, in either word order.
 *
 * Collected ONCE and passed around. `RegExp.prototype.test` on a /g regex
 * advances `lastIndex`, and `String.prototype.matchAll` copies that index into
 * the iterator it clones — so asking "does this sentence contain a price?" and
 * then "which prices?" against the same shared regex silently skipped the first
 * match. That bug ate subjectless price claims specifically, because a sentence
 * naming Mira returned early and never tripped it.
 */
function pricesIn(numeric) {
  const found = [];
  for (const [re, symIdx, numIdx] of [[PRICE_LEADING_RE, 1, 2], [PRICE_TRAILING_RE, 2, 1]]) {
    re.lastIndex = 0;
    for (const m of numeric.matchAll(re)) {
      found.push({ text: m[0].trim(), currency: m[symIdx], number: normaliseNumber(m[numIdx]) });
    }
  }
  return found;
}

function isClaimShaped(sentence, lower, numeric, prices) {
  if (PRODUCT_SUBJECT_RE.test(sentence)) return true;
  // Money, in any currency, is a claim wherever it appears.
  if (prices.length > 0) return true;
  // Any number carrying a unit is a claim, not decoration.
  for (const m of numeric.matchAll(NUMBER_UNIT_RE)) {
    if (classifyNumberMatch(m).kind !== "bare") return true;
  }
  // A capability predicate makes the sentence an assertion about what the
  // product does, with or without a subject: "Works with Xero and QuickBooks."
  if (CAPABILITY_PREDICATE_RE.test(sentence)) return true;
  if (VAGUE_ADOPTION_RE.test(lower) || SPELLED_ADOPTION_RE.test(lower)) return true;
  // Naming any capability, credential, absolute, commercial or social-proof term.
  for (const list of [CAPABILITY_TERMS, CREDENTIAL_TERMS, ABSOLUTE_TERMS, SOCIAL_PROOF_TERMS, COMMERCIAL_TERMS]) {
    if (containsAny(lower, list).length > 0) return true;
  }
  return false;
}

/**
 * Open-world capability detection.
 *
 * A deny-list can only ever catch the vendors somebody thought of. "Mira syncs
 * with Xero, QuickBooks and Airtable" named three integrations we do not have
 * and matched no listed term. So: find the capability predicate, then treat
 * every proper noun and acronym AFTER it as the claimed object. Anything not
 * present in the sourced facts is flagged for a human.
 *
 * Scanning only after the predicate is what keeps this quiet: the verb itself
 * ("Connect", "Works") is never reported as a phantom integration, and prose
 * with no capability predicate is not scanned for proper nouns at all.
 */
function unsourcedCapabilityObjects(sentence, corpus, alreadyReported = []) {
  const pred = CAPABILITY_PREDICATE_RE.exec(sentence);
  if (!pred) return [];
  const object = sentence.slice(pred.index + pred[0].length);
  const out = [];
  for (const m of object.matchAll(PROPER_TOKEN_RE)) {
    const token = m[0];
    const lower = token.toLowerCase();
    if (lower.length < 2) continue;
    if (STOPWORDS.has(lower) || SAFE_ACRONYMS.has(lower)) continue;
    if (corpusHasWord(corpus, lower)) continue;
    // The deny-list already named this one; saying it twice adds no information.
    if (alreadyReported.some((t) => t === lower || t.includes(lower) || lower.includes(t))) continue;
    out.push(token);
  }
  return [...new Set(out)];
}

/**
 * Which of `terms` appear in the text, on word boundaries.
 *
 * Overlapping hits are collapsed to the longest: "with a full refund" should
 * report `full refund`, not `full refund` AND `refund`. Two findings for one
 * phrase is the sort of padding that makes a reviewer skim.
 */
function containsAny(haystackLower, terms) {
  const hits = [];
  for (const t of terms) {
    const re = new RegExp(`(?:^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^a-z0-9]|$)`, "i");
    if (re.test(haystackLower)) hits.push(t);
  }
  return hits.filter((t) => !hits.some((other) => other !== t && other.includes(t)));
}

/**
 * Scan a draft body for product claims that the sourced facts do not support.
 *
 * FLAGS. NEVER EDITS. A finding is information for a human reviewer, not an
 * instruction to a rewriter — silently "fixing" copy is how a wrong claim
 * survives review, because nobody ever saw it.
 *
 * @returns {{rule:string, severity:"block"|"review", sentence:string, detail:string}[]}
 */
export function guardClaims(body, { facts = SOURCED_FACTS, langCode = "en" } = {}) {
  const corpus = buildCorpus(facts);
  const known = Object.prototype.hasOwnProperty.call(LANGUAGES, langCode);
  const meta = known ? LANGUAGES[langCode] : LANGUAGES.en;
  const findings = [];
  const push = (rule, severity, sentence, detail) =>
    findings.push({ rule, severity, sentence: String(sentence).slice(0, 240), detail });

  // A caller may narrow the fact set but never widen it. Anything that is not
  // byte-identical to a SOURCED_FACT has already been excluded from the corpus;
  // say so loudly rather than scanning against a corpus somebody handed us.
  for (const f of corpus.foreign) {
    push("corpus-tampered", "block", `[fact: ${(f && f.id) || "unnamed"}]`,
      "A fact was supplied to the guard that is not in SOURCED_FACTS (or whose text differs). " +
        "It was IGNORED — the guard only ever grounds against src/lib/veridian-kb.ts, " +
        "src/app/mira/_components/tiers.ts and src/app/about. Widening the corpus would let a " +
        "caller whitelist any claim it liked.");
  }

  for (const sentence of splitSentences(body)) {
    // Emphasis- and zero-width-stripped copy for term matching; the ORIGINAL
    // sentence is always what gets reported back to the human.
    const lower = scanText(sentence);
    // Every numeric rule reads this copy, so Arabic-Indic numerals and
    // non-breaking spaces cannot hide a figure from an ASCII pattern.
    const numeric = normaliseDigits(sentence).replace(/[  ]/g, " ");
    const prices = pricesIn(numeric);
    const claimish = isClaimShaped(sentence, lower, numeric, prices);

    // -- credentials we have not earned ------------------------------------
    for (const hit of containsAny(lower, CREDENTIAL_TERMS)) {
      if (!corpusHasTerm(corpus, hit)) {
        push("unearned-credential", "block", sentence,
          `"${hit}" is a certification/credential claim with no support in the sourced facts.`);
      }
    }

    // -- absolutes and guarantees ------------------------------------------
    for (const hit of containsAny(lower, ABSOLUTE_TERMS)) {
      push("absolute-or-guarantee", "block", sentence,
        `"${hit}" is an absolute claim. The sourced facts never promise perfection or rank.`);
    }

    // -- borrowed social proof ---------------------------------------------
    for (const hit of containsAny(lower, SOCIAL_PROOF_TERMS)) {
      push("unsourced-social-proof", "block", sentence,
        `"${hit}" implies adoption or ratings we have no sourced evidence for.`);
    }
    for (const re of [VAGUE_ADOPTION_RE, SPELLED_ADOPTION_RE]) {
      const vague = re.exec(lower);
      if (vague) {
        push("unsourced-social-proof", "block", sentence,
          `"${vague[0].trim()}" is an adoption claim. We publish no such figure.`);
      }
    }

    // -- commercial terms we have never announced ----------------------------
    for (const hit of containsAny(lower, COMMERCIAL_TERMS)) {
      if (!corpusHasTerm(corpus, hit)) {
        push("unsourced-commercial-term", "block", sentence,
          `"${hit}" is a charge, discount or billing term that appears nowhere in ` +
            "src/app/mira/_components/tiers.ts. Reusing a real price does not make a new fee real.");
      }
    }

    if (TESTIMONIAL_RE.test(sentence)) {
      push("testimonial", "block", sentence,
        "Looks like an attributed quote. A testimonial may only ship if a real named person said it and agreed in writing.");
    }

    // -- prices, in ANY currency ---------------------------------------------
    // Sourced pricing exists only in USD. A figure in AED, EUR or a bare "USD"
    // suffix is a price we have never published, whichever way round it is written.
    for (const p of prices) {
      if (!USD_TOKENS.has(p.currency.toLowerCase())) {
        push("unsourced-price", "block", sentence,
          `"${p.text}" quotes a price in ${p.currency.toUpperCase()}. Sourced pricing in ` +
            "src/app/mira/_components/tiers.ts is USD only.");
      } else if (!corpus.numbers.has(p.number)) {
        push("unsourced-price", "block", sentence,
          `"${p.text}" does not match any price in src/app/mira/_components/tiers.ts.`);
      }
    }

    // -- statistics (EVERY sentence; a number is a claim without a subject) ---
    for (const m of numeric.matchAll(NUMBER_UNIT_RE)) {
      const c = classifyNumberMatch(m);
      const pair = `${c.n}|${c.kind}|${c.unit}`;
      if (c.kind === "percentage") {
        // Deliberately NOT suppressed by a bare-number match. The old code did
        // `if (corpus.numbers.has(n)) continue` first, so "39% faster" was waved
        // through purely because $39 is a sourced price.
        if (!corpus.numberUnits.has(pair)) {
          push("unsourced-statistic", "block", sentence,
            `"${c.text}" is a percentage claim. No percentage exists in the sourced facts.`);
        }
        continue;
      }
      if (c.kind === "adoption") {
        if (!corpus.numberUnits.has(pair)) {
          push("unsourced-statistic", "block", sentence,
            `"${c.text}" is an adoption/coverage number. We publish no such figure.`);
        }
        continue;
      }
      // Magnitudes and durations may legitimately reuse a sourced figure
      // ("15M tokens"), so a bare-number match is enough to clear them.
      if (corpus.numbers.has(c.n)) continue;
      if (c.kind === "magnitude") {
        push("unsourced-statistic", "review", sentence,
          `"${c.text}" is a magnitude claim not present in the sourced facts.`);
      } else if (c.kind === "duration") {
        push("unsourced-statistic", "review", sentence,
          `"${c.text}" promises a duration or allowance that is not in the sourced facts.`);
      }
    }

    // -- capabilities and integrations we have not shipped -------------------
    // No claim-shape gate. "Integrates seamlessly with Slack, Salesforce and
    // Notion." names no subject and is exactly the sentence that must be caught.
    const namedTerms = [];
    for (const hit of containsAny(lower, CAPABILITY_TERMS)) {
      if (!corpusHasTerm(corpus, hit)) {
        namedTerms.push(hit);
        push("unsupported-capability", "block", sentence,
          `"${hit}" describes a capability or integration that is not in the sourced facts.`);
      }
    }
    // ...and the open-world half, for vendors nobody deny-listed.
    if (meta.script === "latin" || /[A-Za-z]/.test(sentence)) {
      for (const obj of unsourcedCapabilityObjects(sentence, corpus, namedTerms)) {
        push("unsupported-capability", "block", sentence,
          `"${obj}" is named as something we work with, but it does not appear in the sourced ` +
            "facts. Either it is an integration we do not have, or the fact set needs updating first.");
      }
    }

    // -- general lexical support (English only; see note below) --------------
    if (claimish && meta.script === "latin") {
      const novel = [];
      for (const w of lower.match(/[a-z][a-z'-]{3,}/g) || []) {
        if (STOPWORDS.has(w) || corpusHasWord(corpus, w)) continue;
        novel.push(w);
      }
      if (novel.length > 0) {
        push("unverified-wording", "review", sentence,
          `Words not present in the sourced facts: ${[...new Set(novel)].slice(0, 12).join(", ")}. Confirm the sentence still only says what we can support.`);
      }
    }
  }

  // -- honesty about our own limits -----------------------------------------
  // The fact corpus is English. We do NOT pretend this scanner understands
  // Arabic or Farsi semantics, so a non-English draft always carries a
  // mandatory human-language review finding rather than a false all-clear.
  if (!known) {
    // Silently treating an unknown language as English was itself a bypass:
    // guardClaims(body, { langCode: "de" }) returned a clean English-shaped
    // report for text this scanner cannot read at all.
    push("translation-unverified", "block", `[whole document: language "${langCode}"]`,
      `"${langCode}" is not a supported language for this pipeline (supported: ${Object.keys(LANGUAGES).join(", ")}). ` +
        "The scan fell back to English rules and cannot be trusted. A fluent speaker must verify every claim.");
  } else if (meta.script !== "latin") {
    push("translation-unverified", "block", `[whole document: ${meta.name}]`,
      `The claim corpus is English. This scanner checked numbers, prices and Latin-script terms only. A fluent ${meta.name} speaker must verify every claim before this draft can be published.`);
  }

  // One finding per distinct (rule, sentence, detail). A reviewer who is shown
  // the same line four times stops reading the report.
  const seen = new Set();
  return findings.filter((f) => {
    const key = `${f.rule} ${f.severity} ${f.sentence} ${f.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* =========================================================================
 * 7. THE OFFLINE COMPOSER (default) + injectable LLM
 * ========================================================================= */

/**
 * Deterministic, network-free composer used when no LLM client is injected.
 * It only recombines sourced fact text, so its output is grounded by
 * construction. A real LLM client may be injected instead — and then the claim
 * guard earns its keep, because a model will happily invent a statistic.
 *
 * A client is any object with:  async complete({ system, prompt }) -> string
 */
export function offlineComposer() {
  return {
    kind: "offline-deterministic",
    async complete({ topic, facts, language }) {
      const meta = languageMeta(language);
      const lines = [];
      lines.push(`## ${topic.title}`, "");
      lines.push(facts[0].claim, "");
      lines.push("### What this means in practice", "");
      for (const f of facts) {
        lines.push(`- ${f.claim} _(source: ${f.source})_`);
      }
      // The "must not claim" boundaries deliberately do NOT go in the body —
      // they live in the front-matter, where a reviewer reads them. Putting
      // them in prose would trip the claim guard on our own guard-rails and
      // bury the real findings.
      lines.push(
        "",
        "### Try it yourself",
        "",
        "The honest test is your own: tell Mira something about your world, come back the next day, and see whether it recalled it.",
        "",
      );
      if (meta.script !== "latin") {
        lines.push(
          `> TRANSLATION PENDING (${meta.name}). This body is the English source text. The offline composer does not translate. Either inject a translation-capable client, or have a fluent ${meta.name} writer produce the body. Front-matter lang/dir are already set correctly.`,
          "",
        );
      }
      return lines.join("\n");
    },
  };
}

/* =========================================================================
 * 8. DRAFT GENERATION
 * ========================================================================= */

function buildJsonLd({ title, description, canonical, lang, createdAt }) {
  // NOTE: no datePublished and no author person — this is a DRAFT. A human adds
  // a real byline and a real publication date at publication time.
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title,
    description,
    inLanguage: lang,
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
    publisher: {
      "@type": "Organization",
      name: "Afaq Alnaseem Trading LLC",
      brand: "Vualet",
    },
    dateCreated: createdAt,
    creativeWorkStatus: DRAFT_STATUS,
  };
}

/**
 * Generate one draft.
 *
 * @param {{topic: string|Topic, audience?: string, language?: string}} input
 * @param {{llm?: object, now?: () => string, origin?: string, facts?: SourcedFact[]}} deps
 */
export async function generateDraft(input, deps = {}) {
  const { topic: topicRef, audience = "curious-newcomer", language = "en" } = input || {};

  const topic = typeof topicRef === "string" ? topicById(topicRef) : topicRef;
  if (!topic || !topicById(topic.id)) {
    throw new Error(
      `unknown topic: ${String(typeof topicRef === "string" ? topicRef : topicRef?.id)} — ` +
        "topics must come from the grounded TOPICS catalogue",
    );
  }
  if (!AUDIENCES.includes(audience)) {
    throw new Error(`unknown audience: ${audience} (allowed: ${AUDIENCES.join(", ")})`);
  }
  const langMeta = languageMeta(language);

  const facts = topic.factIds.map(factById);
  const llm = deps.llm || offlineComposer();
  const now = (deps.now || (() => new Date().toISOString()))();
  const origin = deps.origin || SITE_ORIGIN;

  const system =
    "You write grounded marketing prose. You may ONLY assert what the supplied facts assert. " +
    "Never invent statistics, user counts, testimonials, certifications or prices. " +
    "Never describe internal architecture, infrastructure, model names or API endpoints. " +
    "If you cannot support a sentence from the facts, leave it out.";

  const body = await llm.complete({
    system,
    topic,
    facts,
    audience,
    language,
    languageMeta: langMeta,
    prompt:
      `Write an article for the audience "${audience}" in ${langMeta.name} about: ${topic.title}. ` +
      `Use only these facts:\n${facts.map((f) => `- ${f.claim}`).join("\n")}`,
  });

  if (typeof body !== "string" || body.trim().length === 0) {
    throw new Error("composer returned an empty body");
  }

  const slug = topic.slug;
  if (!isUrlSafeSlug(slug)) throw new Error(`topic ${topic.id} has a non-URL-safe slug: ${slug}`);

  const canonical = canonicalUrlFor(slug, language, origin);
  const findings = guardClaims(body, { facts: deps.facts || SOURCED_FACTS, langCode: language });

  const frontMatter = {
    // --- HARD RULE: never derived from input, always the frozen constant ---
    status: DRAFT_STATUS,
    statusNote:
      "MACHINE-GENERATED DRAFT. Not publishable. A named human must complete the review checklist and change this status by hand.",
    title: topic.title,
    slug,
    description: topic.description,
    canonical,
    lang: langMeta.lang,
    dir: langMeta.dir,
    languageName: langMeta.name,
    topicId: topic.id,
    audience,
    intent: topic.intent,
    generator: `content-pipeline.mjs (${llm.kind || "injected-client"})`,
    generatedAt: now,
    sources: facts.map((f) => ({ id: f.id, source: f.source })),
    mustNotClaim: topic.mustNotClaim,
    reviewChecklist: [...REVIEW_CHECKLIST],
    claimFindings: findings,
    blockingFindings: findings.filter((f) => f.severity === "block").length,
    jsonLd: buildJsonLd({
      title: topic.title,
      description: topic.description,
      canonical,
      lang: langMeta.lang,
      createdAt: now,
    }),
  };

  return { frontMatter, body, topic, language, filename: draftFilename(slug, language) };
}

export function draftFilename(slug, langCode) {
  const meta = languageMeta(langCode);
  if (!isUrlSafeSlug(slug)) throw new Error(`refusing unsafe slug: ${slug}`);
  return `${slug}.${meta.lang.toLowerCase()}.md`;
}

/** Required front-matter keys. Missing any of these is a hard failure. */
export const REQUIRED_FRONT_MATTER_KEYS = Object.freeze([
  "status", "statusNote", "title", "slug", "description", "canonical", "lang", "dir",
  "languageName", "topicId", "audience", "intent", "generator", "generatedAt",
  "sources", "mustNotClaim", "reviewChecklist", "claimFindings", "jsonLd",
]);

/** @returns {string[]} problems; empty array means valid. */
export function validateFrontMatter(fm) {
  const problems = [];
  for (const k of REQUIRED_FRONT_MATTER_KEYS) {
    if (fm[k] === undefined || fm[k] === null) problems.push(`missing front-matter key: ${k}`);
  }
  if (fm.status !== DRAFT_STATUS) problems.push(`status must be "${DRAFT_STATUS}", got "${fm.status}"`);
  if (!isUrlSafeSlug(fm.slug)) problems.push(`slug is not URL-safe: ${fm.slug}`);
  if (!/^https:\/\//.test(String(fm.canonical))) problems.push("canonical must be an absolute https URL");
  if (!["ltr", "rtl"].includes(fm.dir)) problems.push(`dir must be ltr or rtl, got ${fm.dir}`);
  const d = String(fm.description || "");
  if (d.length < 50 || d.length > 200) problems.push(`description length ${d.length} outside 50-200 chars`);
  if (!Array.isArray(fm.reviewChecklist) || fm.reviewChecklist.length < REVIEW_CHECKLIST.length) {
    problems.push("reviewChecklist must carry the full checklist");
  }
  if (!fm.jsonLd || fm.jsonLd["@type"] !== "Article") problems.push("jsonLd must be an Article");
  if (fm.jsonLd && fm.jsonLd.inLanguage !== fm.lang) problems.push("jsonLd.inLanguage must match lang");
  if (fm.jsonLd && fm.jsonLd.datePublished) problems.push("a draft must not carry datePublished");
  return problems;
}

function yamlScalar(v) {
  const s = String(v);
  return /^[A-Za-z0-9][A-Za-z0-9 ._:/؀-ۿ-]*$/.test(s) && !/: /.test(s)
    ? s
    : JSON.stringify(s);
}

/**
 * Serialise to markdown with YAML front-matter.
 * `status` is written from the DRAFT_STATUS constant, NOT from the object — so
 * even a mutated draft object cannot serialise as published.
 */
export function serializeDraft(draft) {
  const fm = draft.frontMatter;
  const L = [];
  L.push("---");
  L.push(`status: ${DRAFT_STATUS}`);
  L.push(`statusNote: ${yamlScalar(fm.statusNote)}`);
  L.push(`title: ${yamlScalar(fm.title)}`);
  L.push(`slug: ${fm.slug}`);
  L.push(`description: ${yamlScalar(fm.description)}`);
  L.push(`canonical: ${fm.canonical}`);
  L.push(`lang: ${fm.lang}`);
  L.push(`dir: ${fm.dir}`);
  L.push(`languageName: ${yamlScalar(fm.languageName)}`);
  L.push(`topicId: ${fm.topicId}`);
  L.push(`audience: ${fm.audience}`);
  L.push(`intent: ${fm.intent}`);
  L.push(`generator: ${yamlScalar(fm.generator)}`);
  L.push(`generatedAt: ${fm.generatedAt}`);
  L.push(`blockingFindings: ${fm.blockingFindings}`);
  L.push("sources:");
  for (const s of fm.sources) L.push(`  - ${s.id}: ${yamlScalar(s.source)}`);
  L.push("mustNotClaim:");
  for (const m of fm.mustNotClaim) L.push(`  - ${yamlScalar(m)}`);
  L.push("reviewChecklist:");
  for (const c of fm.reviewChecklist) L.push(`  - [ ] ${c}`);
  L.push("claimFindings:");
  if (fm.claimFindings.length === 0) {
    L.push("  [] # none raised — this is NOT permission to publish unreviewed");
  }
  for (const f of fm.claimFindings) {
    L.push(`  - rule: ${f.rule}`);
    L.push(`    severity: ${f.severity}`);
    L.push(`    sentence: ${yamlScalar(f.sentence)}`);
    L.push(`    detail: ${yamlScalar(f.detail)}`);
  }
  L.push(`jsonLd: ${JSON.stringify(fm.jsonLd)}`);
  L.push("---");
  L.push("");
  L.push(`<!-- DRAFT — NOT FOR PUBLICATION. Generated by scripts/content-pipeline.mjs.`);
  L.push(`     ${fm.blockingFindings} blocking claim finding(s). A human must review. -->`);
  L.push("");
  L.push(draft.body.trim());
  L.push("");
  return L.join("\n");
}

/**
 * Write a draft to the drafts directory. This is the ONLY write path in this
 * module, and it refuses anything whose status is not the frozen constant.
 */
export function writeDraft(draft, { dir = DRAFTS_DIR, fs } = {}) {
  if (!draft || !draft.frontMatter) throw new Error("writeDraft: not a draft object");
  if (draft.frontMatter.status !== DRAFT_STATUS) {
    throw new Error(
      `writeDraft refuses status "${draft.frontMatter.status}" — this pipeline only writes drafts`,
    );
  }
  const name = draftFilename(draft.frontMatter.slug, draft.frontMatter.lang);
  const target = resolve(dir, name);
  if (!target.startsWith(resolve(dir) + sep)) {
    throw new Error(`refusing to write outside the drafts directory: ${target}`);
  }
  const io = fs || { writeFileSync, mkdirSync, existsSync };
  if (!io.existsSync(dir)) io.mkdirSync(dir, { recursive: true });
  io.writeFileSync(target, serializeDraft(draft), "utf8");
  return target;
}

/* =========================================================================
 * 9. CLI — generates drafts, and only drafts
 * ========================================================================= */

export async function runCli(argv, deps = {}) {
  const args = new Map();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) args.set(a.slice(2), argv[i + 1]?.startsWith("--") ? true : argv[++i]);
  }
  if (args.has("list") || argv.length === 0) {
    const out = ["Grounded topics (all drafts, never published):"];
    for (const t of listTopics()) out.push(`  ${t.id}\n    -> /blog/${t.slug}`);
    out.push("", "Usage: node scripts/content-pipeline.mjs --topic <id> --language en|ar|ar-AE|fa [--audience <a>]");
    return { text: out.join("\n"), written: [] };
  }
  const language = args.get("language") || "en";
  const audience = args.get("audience") || "curious-newcomer";
  const ids = args.get("topic") === true || !args.has("topic")
    ? TOPICS.map((t) => t.id)
    : String(args.get("topic")).split(",");

  const written = [];
  const lines = [];
  for (const id of ids) {
    const draft = await generateDraft({ topic: id, audience, language }, deps);
    const problems = validateFrontMatter(draft.frontMatter);
    if (problems.length) throw new Error(`front-matter invalid for ${id}: ${problems.join("; ")}`);
    const path = writeDraft(draft, deps);
    written.push(path);
    lines.push(`draft: ${path}  [${draft.frontMatter.blockingFindings} blocking finding(s)]`);
  }
  lines.push("", "All output is status: draft. Nothing here is published. A human publishes.");
  return { text: lines.join("\n"), written };
}

const isDirect =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isDirect) {
  runCli(process.argv.slice(2))
    .then((r) => {
      process.stdout.write(r.text + "\n");
    })
    .catch((e) => {
      process.stderr.write(`content-pipeline failed: ${e.message}\n`);
      process.exitCode = 1;
    });
}
