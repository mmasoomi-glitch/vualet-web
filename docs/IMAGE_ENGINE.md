# Brand Image Engine

An **offline** marketing-image generator for the Mira brand.

> ## OFFLINE-ONLY — read this first
>
> **This tool is not part of the website.** It is a build-time / operator tool,
> run by hand from a terminal by someone who already holds the operator API key.
>
> - It is **never imported** by any route, page, layout, middleware or server
>   action. A test asserts this by scanning all of `src/` on every run.
> - It **never touches** the live customer path: no payments, no sessions, no
>   customer data, no database.
> - It **never runs in production**. Nothing in the deployed app calls it, and
>   nothing schedules it.
> - Importing the module has **no side effects** — no network call, no file
>   write, no key read.
>
> This is jury #107, constraint 4, and it is the reason the engine lives in
> `scripts/` as a standalone `.mjs` rather than anywhere under `src/`.

---

## Files

| Path | What it is |
| --- | --- |
| `C:\vualet-web\scripts\brand-image-engine.mjs` | The engine + CLI |
| `C:\vualet-web\scripts\brand-image-engine-test.mjs` | Test suite (28 cases, no network) |
| `C:\vualet-web\docs\IMAGE_ENGINE.md` | This document |

---

## Environment variables

Referenced **by name only**. Never write a key into a file, a prompt, a commit,
or a log.

| Name | Required | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | yes, to generate | Bearer credential for OpenRouter |

The key is read from the environment at call time, sent only in the
`Authorization` header, and scrubbed by `redact()` from anything that leaves the
engine. The test suite asserts the key never appears in the returned object, in
a thrown error, or in any log line — including the case where the HTTP client
itself echoes the header back in an error message.

```powershell
# PowerShell, current session only — do not persist it into a file
$env:OPENROUTER_API_KEY = "<paste-key>"
```

---

## Running it

### Compose a prompt without spending anything

```powershell
node scripts/brand-image-engine.mjs --section hero `
  --subject "a single folded sheet of warm paper, one amber seal at the corner" `
  --mood "unhurried morning light" --print-prompt
```

`--print-prompt` makes **no network call** and needs **no API key**. Use it to
review wording before generating.

### Generate

```powershell
node scripts/brand-image-engine.mjs --section hero --subject "a quiet desk corner"
```

### Flags

| Flag | Meaning |
| --- | --- |
| `--section` | `hero` \| `plans` \| `account` \| `legal` \| `blogHeader` \| `ogCard` |
| `--subject` | what the picture is of (required) |
| `--mood` | optional mood modifier |
| `--out` | output directory (default `brand-assets/` at the repo root) |
| `--model` | default `openai/gpt-image-1`, routed via OpenRouter |
| `--attempts` | bounded retries, default `3` |
| `--text` | **text variant** — max 6 words, explicit opt-in |
| `--print-prompt` | compose and print only; no network, no key |
| `--accept-unverified` | accept an asset with **no** OCR gate (recorded as `unverified`) |

### Tests

```powershell
node --test scripts/brand-image-engine-test.mjs
```

No npm script was added: `package.json` is currently claimed by another agent in
the context ledger, and this task does not own that file. Whoever owns it next
can add:

```json
"test:image": "node --test scripts/brand-image-engine-test.mjs"
```

---

## Where assets land

Default output directory: **`C:\vualet-web\brand-assets\`** (repo root).

```
brand-assets/
  hero-2026-08-05T12-00-00-000Z.png
  manifest.json
```

**This is deliberately NOT under `public/`.** Next serves everything in
`public/` at a live URL, and the manifest records prompts and **model names** —
which jury #107 constraint 1 puts on the deny-list. A default of
`public/brand-assets/` would publish that at `/brand-assets/manifest.json`.

Promoting a finished asset to the site is therefore a **deliberate manual copy
of the image only**. The manifest never goes with it. A test enforces the
default path.

### The manifest — so no asset is ever a mystery

Every generation appends one entry recording, per image: the **full prompt**,
the **model**, the **OCR verdict**, the attempt history, and a **timestamp**.

```json
{
  "generator": "brand-image-engine",
  "offlineOnly": true,
  "images": [
    {
      "section": "hero",
      "subject": "a quiet desk corner",
      "variant": "no-text",
      "model": "openai/gpt-image-1",
      "outcome": "accepted",
      "finalVerdict": "clean",
      "attempts": [
        {
          "attempt": 1,
          "prompt": "Marketing image for the Mira brand — hero (/mira) …",
          "noTextInstruction": true,
          "ocr": { "engine": "fake", "supported": true, "verdict": "clean", "detectedWords": 0 },
          "timestamp": "2026-08-05T12:00:00.000Z"
        }
      ]
    }
  ]
}
```

If you add `brand-assets/` to source control, note that the manifest is
internal-only. It is simplest to leave the directory untracked.

---

## The no-text-first rule

The owner's rule, implemented literally.

1. **Pass 1 is always no-text.** Every prompt carries `NO_TEXT_INSTRUCTION`:
   no text, letters, words, numbers, logos, wordmarks, watermarks, signage, UI
   labels or captions. A test asserts this is present for *every* section.
2. **OCR gate.** The result is read by an OCR adapter. If **any** legible text
   is detected, the image **fails** and is regenerated with escalated wording
   ("a previous attempt was REJECTED because legible text was detected…").
3. **Bounded retries.** At most `--attempts` (default 3) total. Then the engine
   **gives up honestly**: it returns `{ ok: false, reason: "ocr_gate_failed" }`
   and still writes the failure into the manifest. It never loops.
4. **Text variants are opt-in and capped.** Text is only permitted when
   `--text` is passed explicitly. The cap is **6 words** — "not too much, just
   enough beautiful". Anything busier is rejected *before* an API call is made,
   so a rejected variant costs nothing. After generation the OCR gate re-checks:
   more words than approved is also a rejection.

### OCR status — said plainly

**This repo has no OCR engine, so the gate ships as a pluggable interface and
the no-text path is the default.**

`sharp` does appear in `node_modules`, but it is a **transitive dependency of
`next@16.2.6`** (confirmed with `npm ls sharp`) and it is an image-processing
library, **not** an OCR engine. Adding a real OCR dependency to a repo that is
live and taking real money is not a decision this tool makes on its own.

Consequently the default adapter, `unavailableOcrGate`, reports
`supported: false`, and the engine **fails closed**:

```
FAILED: ocr_unavailable — no OCR engine wired in — pass deps.ocr,
or set acceptUnverified to accept an UNVERIFIED asset
```

That is intentional. An unchecked image is never silently called "clean". Two
ways forward:

**A. Wire in a real gate** (recommended). Pass any object with this shape:

```js
const ocr = {
  name: "tesseract",
  async detect(imageBytes, meta) {
    return { supported: true, engine: "tesseract", text: "<everything legible>" };
  },
};
await generate({ section: "hero", subject: "…" }, { fetch, ocr });
```

Candidates, none of which are added here: `tesseract.js` (pure JS, no native
build), a local Tesseract binary over `child_process`, or the
`Windows.Media.Ocr` path already proven in the Inline Polish work.

**B. Accept unverified**, with your eyes open:

```powershell
node scripts/brand-image-engine.mjs --section hero --subject "…" --accept-unverified
```

The manifest then records the verdict as `"unverified"` — never `"clean"` — so
an ungated asset can always be told apart later.

---

## The palette is read from the real CSS

`buildBrand()` parses the live tokens out of
`src/app/mira/mira-theme.css` (`.mira-root`) and `src/app/globals.css`
(`@theme`) at load time. Nothing is hardcoded.

CSS comments are stripped before parsing — `mira-theme.css` quotes the
**retired** rose `#E68A85` in a comment explaining the 2026-07-27 "Notary"
recolour, and a naive scan would harvest a dead colour out of prose.

Values found in the file and carried into every prompt:

| Role | Token | Value |
| --- | --- | --- |
| amber verified-seal | `--mira-rose` | `#E4A130` |
| deep amber | `--mira-rose-deep` | `#C77D2E` |
| text-safe bronze | `--mira-rose-ink` | `#935312` |
| warm sand | `--mira-petal` | `#F7E7C6` |
| indigo presence | `--aether` | `#6366F1` |
| text-safe indigo | `--mira-aether-ink` | `#4F46E5` |
| lavender | `--mira-lavender` | `#C7B8F0` |
| warm paper | `--mira-cream` | `#F6F3EC` |
| canvas | `--mira-canvas` | `#FCFAF5` |
| indigo-plum ink | `--mira-ink` | `#1C1830` |
| warm hairline | `--mira-fog` | `#E4E0D8` |
| verification green | `--mira-verify` | `#6BCE9B` |

> **Note on token names.** The `--mira-rose-*` family carries **amber**, not
> pink. The Notary recolour changed values only, keeping names so no component
> markup had to move — `mira-theme.css` says so in its own comment. Likewise
> `--color-vualet-lime` in `globals.css` holds `#E4A130`, the amber seal.

Fonts: **Fraunces** (display/wordmark), **Inter** (UI), **IBM Plex Sans**
(house body), **IBM Plex Mono** — confirmed in `src/app/layout.tsx` and
`src/app/mira/layout.tsx`.

Because the palette is *read* rather than copied, a brand recolour makes the
test suite fail loudly instead of silently shipping art in a retired palette.

---

## Sections

Verified against `src/app` on disk. `routed` is honest about whether the surface
exists in the repo **today**.

| Section | Surface | Routed today |
| --- | --- | --- |
| `hero` | `/mira` | yes |
| `plans` | `/mira/plans` | yes |
| `account` | `/mira/account` | yes |
| `legal` | `/legal` (terms, privacy, refund, ai-disclosure) | yes |
| `blogHeader` | `/blog` | **no** — no `/blog` route exists yet |
| `ogCard` | opengraph / social share card | **no** — no `opengraph-image` route found |

`blogHeader` exists for the SEO track. Per jury #107 constraint 5 that track is
**drafts-only**: generating banner art early is safe, auto-publishing is not.

---

## Programmatic use

Every outside edge is injected, which is why the tests never open a socket.

```js
import { generate, appendManifest } from "./scripts/brand-image-engine.mjs";

const result = await generate(
  { section: "hero", subject: "a folded sheet of warm paper", mood: "quiet" },
  {
    fetch: globalThis.fetch,   // required — inject the HTTP client
    ocr: myOcrAdapter,         // optional — defaults to fail-closed
    env: process.env,          // optional
    log: console.log,          // optional — always redacted
  },
);

if (!result.ok) console.error(result.reason, result.message);
```

`generate()` returns `{ ok, section, model, prompt, verdict, imageBase64,
manifestEntry, attempts }` on success and `{ ok: false, reason, message,
manifestEntry, attempts }` when it gives up. **Neither ever contains the API
key.**

---

## Safety summary

| Rule | How it is enforced |
| --- | --- |
| Offline-only, unreachable from the live path | Test scans all of `src/` for any import |
| No secret in output | `redact()` on every exit path; 6 tests assert it |
| No secret inlined | Test greps the engine source for key-shaped strings |
| No text by default | `NO_TEXT_INSTRUCTION` on pass 1, asserted per section |
| Unverified ≠ clean | Fail-closed default; override stamped `"unverified"` |
| No infinite spend | Bounded retries; ungateable images are not retried at all |
| Text stays restrained | 6-word cap, rejected before any API call |
| Model names not published | Default output directory is outside `public/` |
