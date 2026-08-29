// Mira brand image engine — OFFLINE marketing asset generator.
//
// JURY #107, CONSTRAINT 4: this is an operator / build-time tool. It is NOT
// imported by any route, page, middleware or server action, and it must never
// become reachable from the live customer path. Nothing here touches payments,
// sessions, or customer data. It is a standalone .mjs run by hand from a
// terminal by someone who already has the operator API key.
//
// THE OWNER'S RULE, IMPLEMENTED LITERALLY — "no text first":
//   Pass 1 always asks for an image with NO text, letters, words, numbers or
//   logos. The result is then OCR-GATED: if legible text is detected, the image
//   FAILS and is regenerated (bounded retries, then we give up and say so).
//   Text is only ever allowed when a text variant is explicitly requested, and
//   then only "not too much, just enough beautiful" — a hard word cap.
//
// OCR STATUS — SAID PLAINLY: this repo has NO OCR engine. `sharp` is present in
// node_modules but it is a TRANSITIVE dependency of next@16.2.6 (verified with
// `npm ls sharp`) and it is an image-processing library, not an OCR engine.
// Adding a real OCR dependency to a live payments repo is not a call this tool
// gets to make on its own. So the gate is a PLUGGABLE INTERFACE (see OcrGate
// below) and the default adapter reports "unsupported", which makes generate()
// FAIL CLOSED rather than silently pretend an unchecked image is clean.
// See the TODO on `unavailableOcrGate`.
//
// SECRETS: the OpenRouter key is read from an env var BY NAME. It is never
// inlined, never logged, never returned, and never placed in an error message.
// `redact()` scrubs it from anything on its way out, and the test suite asserts
// this against the returned object, the thrown error, and every log line.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Name of the env var holding the OpenRouter key. The NAME only — never a value. */
export const API_KEY_ENV = "OPENROUTER_API_KEY";

/** OpenRouter's OpenAI-compatible image endpoint. */
export const OPENROUTER_IMAGE_URL = "https://openrouter.ai/api/v1/images/generations";

/** An OpenAI image model, addressed through OpenRouter's namespaced id. */
export const DEFAULT_MODEL = "openai/gpt-image-1";

/** "Not too much, just enough beautiful" — a text variant may carry at most this many words. */
export const TEXT_WORD_CAP = 6;

/** Bounded retries: pass 1 plus this many regenerations before we give up honestly. */
export const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * The literal no-text instruction. Asserted by the tests to be present on
 * EVERY pass-1 prompt. Kept as one exported constant so it cannot drift.
 */
export const NO_TEXT_INSTRUCTION =
  "STRICT: the image must contain NO text, NO letters, NO words, NO numbers, " +
  "NO logos, NO wordmarks, NO watermarks, NO signage, NO UI labels and NO " +
  "captions of any kind. Purely visual composition. If any glyph would appear, " +
  "replace it with abstract form, texture or empty space.";

/** Escalated wording used when a retry is triggered by a failed OCR gate. */
export const NO_TEXT_RETRY_INSTRUCTION =
  "A previous attempt was REJECTED because legible text was detected. " +
  "Remove every glyph. Do not render signage, book spines, screens with " +
  "writing, keyboards, posters, or any surface that implies lettering.";

// ---------------------------------------------------------------------------
// 1. Brand palette — DERIVED FROM THE REAL CSS, not from a summary
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..");
export const THEME_CSS_PATH = join(REPO_ROOT, "src", "app", "mira", "mira-theme.css");
export const GLOBALS_CSS_PATH = join(REPO_ROOT, "src", "app", "globals.css");

/**
 * Parse the custom properties out of a CSS rule block.
 *
 * Comments are stripped FIRST: mira-theme.css carries explanatory comments that
 * quote old hex values (e.g. the retired rose #E68A85), and a naive scan would
 * happily harvest a dead colour out of prose. We only want live declarations.
 *
 * @param {string} css      full stylesheet text
 * @param {string} selector rule to read, e.g. ".mira-root"
 * @returns {Record<string,string>} token name (without --) -> value
 */
export function parseCssTokens(css, selector) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const start = withoutComments.indexOf(selector);
  if (start === -1) throw new Error(`selector ${selector} not found in stylesheet`);
  const open = withoutComments.indexOf("{", start);
  const close = withoutComments.indexOf("}", open);
  if (open === -1 || close === -1) throw new Error(`malformed rule for ${selector}`);
  const body = withoutComments.slice(open + 1, close);

  const tokens = {};
  const re = /--([\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

/**
 * Read the live brand tokens off disk.
 *
 * Reading rather than hardcoding is deliberate: if someone recolours the brand
 * in mira-theme.css, this engine follows automatically and the test suite —
 * which asserts the values it expects — fails loudly instead of silently
 * shipping marketing art in a retired palette.
 *
 * @param {{readFile?: (p: string) => string, themePath?: string, globalsPath?: string}} [io]
 */
export function loadBrandTokens(io = {}) {
  const readFile = io.readFile ?? ((p) => readFileSync(p, "utf8"));
  const themePath = io.themePath ?? THEME_CSS_PATH;
  const globalsPath = io.globalsPath ?? GLOBALS_CSS_PATH;
  return {
    mira: parseCssTokens(readFile(themePath), ".mira-root"),
    theme: parseCssTokens(readFile(globalsPath), "@theme"),
  };
}

/**
 * Build the brand descriptor the prompts are composed from.
 *
 * Everything in `palette` comes off the stylesheet. The prose in `houseStyle`
 * is the human reading of it, and it matches what the CSS comments themselves
 * say the "Notary" recolour is for: indigo presence + amber verified-seal on
 * warm paper, deep indigo-plum ink.
 */
export function buildBrand(io = {}) {
  const { mira, theme } = loadBrandTokens(io);

  const need = (name) => {
    const v = mira[name];
    if (!v) throw new Error(`brand token --${name} missing from mira-theme.css`);
    return v;
  };

  const palette = {
    // The amber "verified seal" family. Token NAMES still say "rose" because the
    // 2026-07-27 Notary recolour changed VALUES only, to avoid markup churn —
    // the CSS comment in mira-theme.css says so explicitly. The colour is AMBER.
    seal: need("mira-rose"),               // #E4A130
    sealLight: need("mira-rose-light"),    // #F3C775
    sealDeep: need("mira-rose-deep"),      // #C77D2E
    sealInk: need("mira-rose-ink"),        // #935312 — text-safe bronze
    sand: need("mira-petal"),              // #F7E7C6 — warm sand
    // Indigo presence.
    aether: need("aether"),                // #6366F1 — Vualet house indigo
    aetherInk: need("mira-aether-ink"),    // #4F46E5
    lavender: need("mira-lavender"),       // #C7B8F0
    // Warm paper + ink.
    paper: need("mira-cream"),             // #F6F3EC
    canvas: need("mira-canvas"),           // #FCFAF5
    frost: need("mira-frost"),             // #EFEBE2
    fog: need("mira-fog"),                 // #E4E0D8 — warm hairline
    ink: need("mira-ink"),                 // #1C1830 — deep indigo-plum
    graphite: need("mira-graphite"),       // #4A4560
    slate: need("mira-slate"),             // #665F73
    // Verification green.
    verify: need("mira-verify"),           // #6BCE9B
    verifyDeep: need("mira-verify-deep"),  // #12784E
  };

  const gradients = {
    presence: need("mira-grad-presence"),
    aura: need("mira-grad-aura"),
  };

  return Object.freeze({
    palette: Object.freeze(palette),
    gradients: Object.freeze(gradients),
    /** Read from globals.css so the house-token remap is visible too. */
    houseTokens: Object.freeze({
      indigo: theme["color-vualet-indigo"],
      seal: theme["color-vualet-lime"], // NAME says lime, VALUE is the amber seal
      ink: theme["color-vualet-ink"],
    }),
    fonts: Object.freeze({
      display: "Fraunces",      // wordmark / display — src/app/layout.tsx
      ui: "Inter",              // UI + Mira surfaces
      body: "IBM Plex Sans",    // house body
      mono: "IBM Plex Mono",    // --mira-mono
    }),
    /** Short house-style descriptor, confirmed against the CSS comments. */
    houseStyle:
      "Warm paper, indigo presence, amber verified-seal. A quiet, unhurried, " +
      "editorial calm — like good stationery and a notary's desk, not a tech " +
      "dashboard. Soft warm light, generous negative space, rounded geometry, " +
      "matte paper grain, gentle shadow. Never neon, never corporate-glossy, " +
      "never cold blue-grey, never pink.",
  });
}

/** The live brand, read once at module load. */
export const BRAND = buildBrand();

/** Palette values as a flat list — used to prove a prompt actually carries them. */
export function paletteSwatches(brand = BRAND) {
  const p = brand.palette;
  return [
    `warm paper ${p.paper}`,
    `canvas ${p.canvas}`,
    `deep indigo-plum ink ${p.ink}`,
    `indigo presence ${p.aether}`,
    `deeper indigo ${p.aetherInk}`,
    `lavender ${p.lavender}`,
    `amber verified-seal ${p.seal}`,
    `deep amber ${p.sealDeep}`,
    `warm sand ${p.sand}`,
    `warm hairline ${p.fog}`,
    `verification green ${p.verify}`,
  ];
}

// ---------------------------------------------------------------------------
// 2. Sections — the REAL site surfaces
// ---------------------------------------------------------------------------

/**
 * Verified against src/app on disk. `route` is the surface the asset dresses;
 * `routed` is honest about whether that route exists in the repo TODAY.
 */
export const SECTIONS = Object.freeze({
  hero: {
    route: "/mira",
    routed: true,
    aspect: "16:9",
    intent:
      "Wide calm opening image. A sense of a private record being kept well: " +
      "warm paper surface, a single soft indigo presence, one small amber seal " +
      "glow off-centre. Nothing busy, nothing technological.",
  },
  plans: {
    route: "/mira/plans",
    routed: true,
    aspect: "4:3",
    intent:
      "Three quiet tiers implied through form alone — three stacked paper " +
      "planes, three folded sheets, three depths of light. No pricing, no " +
      "tables, no cards with labels.",
  },
  account: {
    route: "/mira/account",
    routed: true,
    aspect: "4:3",
    intent:
      "Personal, settled, in-hand. A warm desk corner, a closed ledger, an " +
      "amber seal already pressed. Calm ownership, not administration.",
  },
  legal: {
    route: "/legal (terms, privacy, refund, ai-disclosure)",
    routed: true,
    aspect: "3:2",
    intent:
      "Sober and reassuring. Folded warm paper, a straight edge, restrained " +
      "indigo shadow. Serious without being cold or intimidating.",
  },
  blogHeader: {
    route: "/blog",
    // /blog now exists: src/app/blog/page.tsx and src/app/blog/[slug]/page.tsx,
    // both in the sitemap. This flag was false while the section was art for a
    // route that did not exist yet; it is true because the route shipped.
    routed: true,
    aspect: "21:9",
    intent:
      "Narrow banner. An editorial still life with one idea in it. Reads well " +
      "cropped and behind a headline set in Fraunces.",
  },
  ogCard: {
    route: "opengraph-image / social share card",
    routed: false,
    aspect: "1.91:1",
    intent:
      "Legible as a thumbnail at 200px wide. One strong shape, one warm light " +
      "source, huge margins. Must survive heavy downscaling.",
  },
});

export const SECTION_NAMES = Object.freeze(Object.keys(SECTIONS));

// ---------------------------------------------------------------------------
// 3. Prompt composition
// ---------------------------------------------------------------------------

/** Count words the way a reviewer would — collapse whitespace, ignore empties. */
export function countWords(text) {
  return String(text ?? "").trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Compose an image prompt carrying the brand palette and house style.
 *
 * @param {object} o
 * @param {string} o.section  one of SECTION_NAMES
 * @param {string} o.subject  what the picture is of
 * @param {string} [o.mood]   optional mood modifier
 * @param {boolean} [o.allowText=false]  TEXT VARIANT — off by default, always
 * @param {string} [o.text]   the exact words, when allowText is true
 * @param {boolean} [o.retry=false] strengthen the no-text wording after a gate failure
 * @param {object} [o.brand=BRAND]
 * @returns {string}
 */
export function buildPrompt({
  section,
  subject,
  mood,
  allowText = false,
  text,
  retry = false,
  brand = BRAND,
} = {}) {
  const spec = SECTIONS[section];
  if (!spec) {
    throw new Error(
      `unknown section "${section}" — expected one of: ${SECTION_NAMES.join(", ")}`,
    );
  }
  if (!subject || !String(subject).trim()) {
    throw new Error("buildPrompt requires a subject");
  }

  const parts = [
    `Marketing image for the Mira brand — ${section} (${spec.route}), aspect ${spec.aspect}.`,
    `Subject: ${String(subject).trim()}.`,
    mood ? `Mood: ${String(mood).trim()}.` : null,
    `Composition intent: ${spec.intent}`,
    `House style: ${brand.houseStyle}`,
    `Palette, use these exact colours: ${paletteSwatches(brand).join(", ")}.`,
    `Background must read as warm paper ${brand.palette.paper}, never white, never grey.`,
    `Typographic pairing of the brand, for tone reference only: ${brand.fonts.display} display with ${brand.fonts.ui} UI.`,
  ];

  if (allowText) {
    // A text variant is only reachable through an explicit request AND review.
    const words = countWords(text);
    if (words === 0) {
      throw new Error("a text variant requires the exact text to render");
    }
    if (words > TEXT_WORD_CAP) {
      throw new Error(
        `text variant rejected: ${words} words exceeds the cap of ${TEXT_WORD_CAP} ` +
          `— not too much, just enough beautiful`,
      );
    }
    parts.push(
      `TEXT VARIANT, reviewed and approved. Render exactly these ${words} word(s) ` +
        `and nothing else: "${String(text).trim()}". Set in ${brand.fonts.display}, ` +
        `generous letter-spacing, ${brand.palette.ink} on the warm paper. ` +
        `No other lettering anywhere in the frame — no numbers, no logos, no captions.`,
    );
  } else {
    parts.push(NO_TEXT_INSTRUCTION);
    if (retry) parts.push(NO_TEXT_RETRY_INSTRUCTION);
  }

  return parts.filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// 4. The OCR gate (pluggable)
// ---------------------------------------------------------------------------

/**
 * @typedef {object} OcrResult
 * @property {boolean} supported  false when no engine is wired in
 * @property {string}  [text]     everything legible the engine found
 * @property {string}  [engine]   adapter name, recorded in the manifest
 */

/**
 * The default adapter. There is deliberately no OCR engine in this repo, so
 * this reports "unsupported" and generate() FAILS CLOSED — an unchecked image
 * is never silently called clean.
 *
 * TODO(operator): to enable the gate, pass `deps.ocr` — any object with
 *   `async detect(imageBytes, meta) -> { supported: true, text: string }`.
 *   Reasonable choices, none of which are added here because this is a LIVE
 *   payments repo and its dependency surface is not this tool's to grow:
 *     - tesseract.js            (pure JS, no native build, slow but portable)
 *     - a local Tesseract binary driven over child_process
 *     - the Windows.Media.Ocr path already proven in the Inline Polish work
 *   Wire one in a scratch project or behind an operator-only devDependency,
 *   then hand it to generate() as deps.ocr.
 */
export const unavailableOcrGate = Object.freeze({
  name: "unavailable",
  async detect() {
    return { supported: false, engine: "unavailable" };
  },
});

/**
 * Judge an OCR reading against the rule that applies to this image.
 *
 * @param {OcrResult} ocr
 * @param {{allowText: boolean, expectedText?: string}} rule
 * @returns {{pass: boolean, verdict: string, detectedWords: number, reason?: string}}
 */
export function judgeOcr(ocr, { allowText, expectedText } = {}) {
  if (!ocr || ocr.supported !== true) {
    return {
      pass: false,
      verdict: "unverified",
      detectedWords: 0,
      reason: "no OCR engine wired in — see deps.ocr",
    };
  }

  const found = String(ocr.text ?? "").trim();
  const detectedWords = countWords(found);

  if (!allowText) {
    // Pass 1 rule: ANY legible text fails.
    return detectedWords === 0
      ? { pass: true, verdict: "clean", detectedWords: 0 }
      : {
          pass: false,
          verdict: "text-detected",
          detectedWords,
          reason: `expected no text, OCR read ${detectedWords} word(s)`,
        };
  }

  // Text variant: at most the cap, and nothing beyond what was approved.
  if (detectedWords > TEXT_WORD_CAP) {
    return {
      pass: false,
      verdict: "too-busy",
      detectedWords,
      reason: `${detectedWords} words exceeds the cap of ${TEXT_WORD_CAP}`,
    };
  }
  if (expectedText && countWords(expectedText) < detectedWords) {
    return {
      pass: false,
      verdict: "unexpected-text",
      detectedWords,
      reason: "image carries more words than were approved",
    };
  }
  return { pass: true, verdict: "text-ok", detectedWords };
}

// ---------------------------------------------------------------------------
// 5. Secret hygiene
// ---------------------------------------------------------------------------

/**
 * Scrub a secret out of anything on its way to a log, an error or a return
 * value. Everything that leaves generate() goes through this.
 */
export function redact(value, secret) {
  let s = typeof value === "string" ? value : String(value ?? "");
  if (secret && secret.length >= 4) {
    // Whole key, then any long fragment of it (defends against truncated echoes).
    s = s.split(secret).join("[redacted]");
    const head = secret.slice(0, Math.max(8, Math.floor(secret.length / 2)));
    if (head.length >= 8) s = s.split(head).join("[redacted]");
  }
  // Belt and braces: anything shaped like a bearer credential.
  s = s.replace(/\b(sk|or)-[A-Za-z0-9_-]{8,}/g, "[redacted]");
  s = s.replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer [redacted]");
  return s;
}

/** Error type that carries no credential material by construction. */
export class ImageEngineError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ImageEngineError";
    Object.assign(this, details);
  }
}

// ---------------------------------------------------------------------------
// 6. Generation
// ---------------------------------------------------------------------------

function nowIso(deps) {
  return (deps.now ? deps.now() : new Date()).toISOString();
}

/**
 * Generate one brand image, no-text-first, OCR-gated.
 *
 * @param {object} opts
 * @param {string} opts.section
 * @param {string} opts.subject
 * @param {string} [opts.mood]
 * @param {boolean} [opts.allowText=false] request the TEXT VARIANT explicitly
 * @param {string} [opts.text] the approved words for a text variant
 * @param {string} [opts.model=DEFAULT_MODEL]
 * @param {number} [opts.maxAttempts=DEFAULT_MAX_ATTEMPTS]
 * @param {string} [opts.apiKeyEnv=API_KEY_ENV] env var NAME, never a value
 * @param {boolean} [opts.acceptUnverified=false] operator override when no OCR
 *
 * @param {object} deps  everything that touches the outside world, injected so
 *                       the tests never open a socket or a file
 * @param {Function} deps.fetch
 * @param {object}   [deps.ocr=unavailableOcrGate]
 * @param {object}   [deps.env=process.env]
 * @param {Function} [deps.now]
 * @param {Function} [deps.log]
 *
 * @returns {Promise<object>} a result record — never contains the API key
 */
export async function generate(opts = {}, deps = {}) {
  const {
    section,
    subject,
    mood,
    allowText = false,
    text,
    model = DEFAULT_MODEL,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    apiKeyEnv = API_KEY_ENV,
    acceptUnverified = false,
    brand = BRAND,
  } = opts;

  const env = deps.env ?? process.env;
  const ocr = deps.ocr ?? unavailableOcrGate;
  const httpFetch = deps.fetch;
  const apiKey = env[apiKeyEnv];

  // Every log line is redacted before it is emitted.
  const log = (msg) => {
    if (deps.log) deps.log(redact(msg, apiKey));
  };

  if (typeof httpFetch !== "function") {
    throw new ImageEngineError("deps.fetch is required — inject an HTTP client");
  }
  if (!apiKey) {
    // The NAME, never a value.
    throw new ImageEngineError(
      `missing API key: set the ${apiKeyEnv} environment variable`,
      { apiKeyEnv },
    );
  }
  if (maxAttempts < 1) {
    throw new ImageEngineError("maxAttempts must be at least 1");
  }

  // A text variant is validated BEFORE any money is spent on a request.
  if (allowText) {
    const words = countWords(text);
    if (words > TEXT_WORD_CAP) {
      throw new ImageEngineError(
        `text variant rejected: ${words} words exceeds the cap of ${TEXT_WORD_CAP}`,
        { words, cap: TEXT_WORD_CAP },
      );
    }
  }

  const attempts = [];
  let result = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const prompt = buildPrompt({
      section,
      subject,
      mood,
      allowText,
      text,
      retry: attempt > 1,
      brand,
    });

    log(`attempt ${attempt}/${maxAttempts} — section=${section} model=${model}`);

    let image;
    try {
      image = await requestImage({ prompt, model, apiKey, fetch: httpFetch });
    } catch (err) {
      // Redact anything the transport may have echoed back at us.
      throw new ImageEngineError(redact(err?.message ?? err, apiKey), {
        section,
        model,
        attempt,
      });
    }

    const reading = await ocr.detect(image.bytes, { section, attempt });
    const verdict = judgeOcr(reading, { allowText, expectedText: text });

    attempts.push({
      attempt,
      prompt,
      model,
      noTextInstruction: !allowText,
      ocr: {
        engine: reading?.engine ?? ocr.name ?? "unknown",
        supported: reading?.supported === true,
        verdict: verdict.verdict,
        detectedWords: verdict.detectedWords,
        reason: verdict.reason ?? null,
      },
      timestamp: nowIso(deps),
    });

    if (verdict.pass) {
      log(`attempt ${attempt} PASSED the OCR gate (${verdict.verdict})`);
      result = { ok: true, image, verdict, prompt };
      break;
    }

    if (verdict.verdict === "unverified") {
      if (acceptUnverified) {
        // Explicit operator override. Stamped into the manifest as UNVERIFIED so
        // the asset is never mistaken for a gated one.
        log(`attempt ${attempt} accepted UNVERIFIED — no OCR engine, operator override`);
        result = { ok: true, image, verdict, prompt };
        break;
      }
      // Fail closed, and do not burn retries on a gate that cannot ever pass.
      log("OCR gate unavailable — failing closed");
      break;
    }

    log(`attempt ${attempt} FAILED the OCR gate (${verdict.verdict}) — regenerating`);
  }

  const manifestEntry = {
    section,
    subject,
    mood: mood ?? null,
    variant: allowText ? "text" : "no-text",
    approvedText: allowText ? String(text ?? "").trim() : null,
    model,
    attempts,
    attemptCount: attempts.length,
    maxAttempts,
    outcome: result?.ok ? "accepted" : "gave-up",
    finalVerdict: attempts.at(-1)?.ocr.verdict ?? "none",
    timestamp: nowIso(deps),
  };

  if (!result) {
    const last = attempts.at(-1);
    return {
      ok: false,
      reason: last?.ocr.verdict === "unverified" ? "ocr_unavailable" : "ocr_gate_failed",
      message:
        last?.ocr.verdict === "unverified"
          ? "no OCR engine wired in — pass deps.ocr, or set acceptUnverified to accept an UNVERIFIED asset"
          : `gave up after ${attempts.length} attempt(s): the model kept putting text in the image`,
      manifestEntry,
      attempts,
    };
  }

  return {
    ok: true,
    section,
    model,
    prompt: result.prompt,
    verdict: result.verdict.verdict,
    imageBase64: result.image.b64,
    manifestEntry,
    attempts,
  };
}

/**
 * One call to the OpenRouter image endpoint.
 * The key travels in the Authorization header only — never in the URL, never
 * in a query string, never in a log.
 */
async function requestImage({ prompt, model, apiKey, fetch: httpFetch }) {
  const res = await httpFetch(OPENROUTER_IMAGE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, prompt, n: 1 }),
  });

  if (!res.ok) {
    // Status only. The response body is NOT interpolated raw — an upstream
    // error can echo a request header back, and that must not become our message.
    throw new Error(`image request failed with status ${res.status}`);
  }

  const json = await res.json();
  const first = json?.data?.[0];
  if (!first) throw new Error("image response contained no data");

  // Validate before trusting. An adversarial review injected a transport that
  // echoed the request's Authorization header back as `b64_json`; because the
  // value was passed straight through to result.imageBase64, the API key came
  // back verbatim inside JSON.stringify(result) — i.e. into any log or manifest
  // that stringified the result. Never hand an upstream string onward just
  // because it arrived in the field we expected.
  //
  // Two independent checks, because either alone is weak:
  //  1. Direct: the value must not contain the key we just sent. This is exact,
  //     not heuristic, and catches the echo attack whatever shape it takes.
  //  2. Shape: after stripping the whitespace real base64 may be wrapped with,
  //     it must use the STANDARD base64 alphabet only. Note the alphabet
  //     excludes space and '-', so a bearer token ("Bearer sk-or-v1-…") fails
  //     on both counts. An earlier version of this check allowed \s inside the
  //     character class, which let "Bearer …" through on alphabet grounds — the
  //     length floor was doing all the work, and it also rejected small
  //     legitimate payloads. Both faults are fixed here.
  const raw = first.b64_json;
  const stripped = typeof raw === "string" ? raw.replace(/\s+/g, "") : "";
  const containsKey = Boolean(apiKey) && typeof raw === "string" && raw.includes(apiKey);
  const validBase64 =
    typeof raw === "string" &&
    stripped.length > 0 &&
    stripped.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(stripped);

  if (raw != null && (containsKey || !validBase64)) {
    // Do NOT include the offending value in the message — that would move the
    // leak from the return value into the exception text.
    throw new Error(
      containsKey
        ? "image response echoed the credential back; refusing to pass it through"
        : `image response b64_json failed base64 validation (type=${typeof raw}, length=${
            typeof raw === "string" ? raw.length : "n/a"
          }); refusing to pass it through`,
    );
  }

  const b64 = validBase64 && !containsKey ? stripped : null;
  return {
    b64,
    url: typeof first.url === "string" ? first.url : null,
    bytes: b64 ? Buffer.from(b64, "base64") : null,
  };
}

// ---------------------------------------------------------------------------
// 7. Manifest — so no asset is ever a mystery
// ---------------------------------------------------------------------------

export const MANIFEST_NAME = "manifest.json";

/**
 * Default output directory — deliberately at the REPO ROOT, not under public/.
 *
 * public/ is served by Next, so anything written there is a live URL. The
 * manifest records prompts and MODEL NAMES, and jury #107 constraint 1 puts
 * model names and infrastructure on the deny-list. Writing it under public/
 * would publish exactly that at /brand-assets/manifest.json. So generated
 * output stays outside the served tree, and promoting a finished IMAGE into
 * public/ is a deliberate manual copy — the manifest never goes with it.
 */
export const DEFAULT_OUT_DIR = join(REPO_ROOT, "brand-assets");

/**
 * Append an entry to the manifest that sits beside the generated assets.
 * Records, per image: the prompt, the model, the OCR verdict, and a timestamp.
 *
 * @param {object} entry  a manifestEntry from generate()
 * @param {object} deps   { outDir, readFile, writeFile, mkdir }
 */
export async function appendManifest(entry, deps = {}) {
  const outDir = deps.outDir ?? DEFAULT_OUT_DIR;
  const path = join(outDir, MANIFEST_NAME);

  if (deps.mkdir) await deps.mkdir(outDir, { recursive: true });

  let manifest = { generator: "brand-image-engine", offlineOnly: true, images: [] };
  try {
    const raw = await deps.readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.images)) manifest = parsed;
  } catch {
    // No manifest yet — start a fresh one.
  }

  manifest.images.push(entry);
  await deps.writeFile(path, JSON.stringify(manifest, null, 2), "utf8");
  return { path, count: manifest.images.length };
}

// ---------------------------------------------------------------------------
// 8. CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.section) {
    console.log(`
Mira brand image engine — OFFLINE operator tool.

  node scripts/brand-image-engine.mjs --section hero --subject "a folded sheet of warm paper"

  --section   ${SECTION_NAMES.join(" | ")}
  --subject   what the picture is of (required)
  --mood      optional mood modifier
  --out       output directory (default brand-assets/ at the repo root —
              NOT public/, which Next would serve to the internet)
  --model     default ${DEFAULT_MODEL}
  --attempts  bounded retries, default ${DEFAULT_MAX_ATTEMPTS}
  --text      TEXT VARIANT — max ${TEXT_WORD_CAP} words, explicit opt-in
  --print-prompt   compose and print the prompt, make no network call
  --accept-unverified   accept an asset with NO OCR gate (recorded as UNVERIFIED)

Needs ${API_KEY_ENV} in the environment. There is no OCR engine in this repo,
so without a plugged-in gate the run FAILS CLOSED unless you pass
--accept-unverified. See docs/IMAGE_ENGINE.md.
`);
    return;
  }

  if (args["print-prompt"]) {
    console.log(
      buildPrompt({
        section: args.section,
        subject: args.subject,
        mood: args.mood,
        allowText: Boolean(args.text),
        text: typeof args.text === "string" ? args.text : undefined,
      }),
    );
    return;
  }

  const { mkdir, readFile, writeFile } = await import("node:fs/promises");
  const outDir = args.out ?? DEFAULT_OUT_DIR;
  await mkdir(outDir, { recursive: true });

  const result = await generate(
    {
      section: args.section,
      subject: args.subject,
      mood: args.mood,
      allowText: Boolean(args.text),
      text: typeof args.text === "string" ? args.text : undefined,
      model: args.model,
      maxAttempts: args.attempts ? Number(args.attempts) : undefined,
      acceptUnverified: Boolean(args["accept-unverified"]),
    },
    { fetch: globalThis.fetch, log: (m) => console.log(m) },
  );

  await appendManifest(result.manifestEntry, { outDir, mkdir, readFile, writeFile });

  if (!result.ok) {
    console.error(`FAILED: ${result.reason} — ${result.message}`);
    process.exitCode = 1;
    return;
  }

  if (result.imageBase64) {
    const stamp = nowIso({}).replace(/[:.]/g, "-");
    const file = join(outDir, `${args.section}-${stamp}.png`);
    await writeFile(file, Buffer.from(result.imageBase64, "base64"));
    console.log(`wrote ${file}`);
  }
  console.log(`OCR verdict: ${result.verdict}`);
}

// Only runs when invoked directly — importing this module never executes it.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    // The key is already redacted inside generate(); redact again at the boundary.
    console.error(redact(err?.message ?? err, process.env[API_KEY_ENV]));
    process.exitCode = 1;
  });
}
