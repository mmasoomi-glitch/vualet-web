# Content Strategy — Mira / Vualet

**Status:** active
**Owner:** whoever publishes. Publication is a human act with a human's name on it.
**Scope:** the public marketing surface (blog, landing copy, meta descriptions, link building).
**Constraint of record:** Jury #107, constraint 5 — *technical SEO foundation + DRAFTS-ONLY
content. Never auto-publish AI text to a live commercial site.*

The site takes real money from real people. Every sentence we publish is a promise a customer
can hold us to, and a claim a regulator or a competitor can test. This document is the standard
that keeps those promises true.

---

## 1. The one rule everything else hangs from

**A machine may draft. Only a human may publish.**

`scripts/content-pipeline.mjs` can produce a complete, SEO-ready article — front-matter,
canonical URL, JSON-LD, body, the lot. It cannot publish one, and this is enforced in code
rather than in policy:

| Enforcement | Where |
| --- | --- |
| `DRAFT_STATUS` is the frozen literal `"draft"`, assigned exactly once | `scripts/content-pipeline.mjs` |
| `generateDraft()` never reads a `status` from its input — passing `status: "published"` changes nothing | same |
| `serializeDraft()` writes `status:` from the constant, not from the object, so a mutated draft still serialises as a draft | same |
| `writeDraft()` throws if the status is anything but `draft` | same |
| No publish function, no `--publish` flag, no environment variable, no `process.env` read at all | asserted by test 5 and test 6 |
| Every draft carries a 12-item human-review checklist, unchecked | asserted by test 10 |

Turning a draft into a post therefore requires **editing source code**, not flipping a flag.
That asymmetry is deliberate: the cost of publishing must be paid in human attention.

Verified by `scripts/content-pipeline-test.mjs` — 28 tests, all passing.

---

## 2. What we can truthfully claim today

Every claim below is traceable to a file in this repo. If a claim is not on this list, it does
not go in a draft until the underlying source file says it does. Re-read the sources before a
campaign; the product moves and stale marketing is how a company gets caught.

**Sources of truth:** `src/lib/veridian-kb.ts`, `src/app/mira/_components/tiers.ts`,
`src/app/about/page.tsx`.

### The product
- Mira is an AI assistant you talk to **inside Telegram today, with WhatsApp coming soon**.
  No separate app, no second phone number. *(veridian-kb.ts:23-25)*
- It is **voice-first**: send a voice note and it understands and replies naturally, in your
  own language. *(veridian-kb.ts:28-30)*
- **Multilingual voice with warmth and tone**, not a flat robotic read. *(veridian-kb.ts:33-35)*
- You can **load your own knowledge** — notes, documents, study material — and it answers from
  exactly what you gave it. *(veridian-kb.ts:38-40)*
- **OCR**: it reads text out of photos, receipts and screenshots. *(veridian-kb.ts:48-50)*
- **Memory across conversations** — it holds what you told it and the persona you shaped.
  *(veridian-kb.ts:53-55)*
- **Grounded**: it answers from what it knows and says it does not know rather than inventing.
  *(veridian-kb.ts:58-60)*
- **Small builds — explicitly beta.** The word "beta" is mandatory in any copy that mentions it.
  *(veridian-kb.ts:43-45, tiers.ts:39)*
- **Private by design**: your conversations are yours; your assistant is sealed off from
  everyone else's. *(veridian-kb.ts:93-95)*

### Pricing — must match `tiers.ts` on the day of publication
| Plan | Price | Allowance |
| --- | --- | --- |
| Free | Free | 1,000,000 tokens / month |
| Companion | $14.99/mo | 15M tokens / month |
| Assistant | $39/mo | 60M tokens / month |
| Studio | $79/mo | 200M tokens / month |

Veridian CLS Unlimited is **coming soon, not released**. Describe it that way or not at all.
*(veridian-kb.ts:83-85)*

### The company
Mira is powered by Veridian and operated by **Afaq Alnaseem Trading LLC**, registered in Dubai,
United Arab Emirates. Vualet is a family of software products built in Dubai; Mira is its
flagship. *(about/page.tsx:20-34, veridian-kb.ts:88-90)*

---

## 3. What we must NOT claim

These are not stylistic preferences. Each one is a way companies get caught, and the claim guard
in `content-pipeline.mjs` flags every one of them mechanically.

### Invented numbers
No user counts, customer counts, download figures, country counts, growth percentages, accuracy
rates, uptime figures, or "X times faster". **We publish no such figures, so we may not cite
them.** A number that cannot be sourced to a file in this repo does not appear in copy.
→ guard rules `unsourced-statistic`, `unsourced-price`

### Fake testimonials
No quote from a person who did not say it. No composite customers, no "one user told us", no
stock-photo faces with invented names. A testimonial ships only when a **real, named person
actually said it and agreed in writing** to be quoted.
→ guard rule `testimonial`

### Unearned certifications and compliance
No SOC 2, ISO 27001, HIPAA, PCI DSS, FedRAMP, "GDPR certified", "audited", "patented",
"award-winning". We claim the certifications we hold. Today that list is what the sources say
it is — and the sources say nothing, so we claim nothing.
→ guard rule `unearned-credential`

### Absolutes and guarantees
No "the best", "#1", "world's leading", "unmatched", "guaranteed", "100% accurate",
"never wrong", "zero hallucinations". Note especially: **"grounded" is not "never hallucinates".**
The sourced claim is that Mira answers from what it knows and admits when it does not. Inflating
that into a perfection claim is the single most tempting and most dangerous edit in this whole
document.
→ guard rule `absolute-or-guarantee`

### Capabilities and integrations we have not shipped
No Slack, Notion, Salesforce, Zapier, calendar, CRM, public API, SDK, browser extension, desktop
app, mobile app, SSO, offline mode, or end-to-end encryption — unless and until a source file
says we have it. **WhatsApp is "coming soon", not "available".** Writing it as shipped is a false
statement about a paid product.
→ guard rule `unsupported-capability`

### Architecture and internals
`src/lib/veridian-kb.ts:9-14` forbids publishing infrastructure, endpoints, model names, API
keys, file paths, or **the mechanism behind grounding**. Describe the *outcome* to customers,
never the *how*. This is also Jury #107 constraint 1.

### Borrowed social proof
No "trusted by thousands", "join millions", "rated 5 stars", "loved by". These imply evidence we
do not have.
→ guard rule `unsourced-social-proof`

---

## 4. The claim guard — what it does and does not do

`guardClaims(body, { facts, langCode })` scans a draft sentence by sentence and returns findings
with a `rule`, a `severity` (`block` or `review`), the offending `sentence`, and a `detail`
explaining why.

**It flags. It never edits.** This is the important design decision. A guard that silently
rewrites bad copy means nobody ever sees that the model tried to invent a statistic — the
questionable text disappears and the reviewer approves a clean-looking draft with no idea what
was removed. Flagging keeps the failure visible and puts a human in front of it.

Demonstrated behaviour against a deliberately rogue model output (one paragraph, 15 blocking
findings):

```
[absolute-or-guarantee]  "the best" is an absolute claim.
[unsourced-social-proof] "trusted by" implies adoption we have no evidence for.
[unsourced-statistic]    "40,000 users" is an adoption number. We publish no such figure.
[unsourced-statistic]    "12 countries" is an adoption number.
[unearned-credential]    "soc 2" / "hipaa" / "certified" — no support in the sourced facts.
[unsupported-capability] "slack" / "notion" / "salesforce" / "api" — not in the sourced facts.
[absolute-or-guarantee]  "we guarantee" is an absolute claim.
[unsourced-price]        $9 does not match any price in tiers.ts.
[unsourced-statistic]    "99.9%" is a percentage claim. No percentage exists in the facts.
[testimonial]            Attributed quote — only ships if a real named person said it.
```

### Its honest limits
- **It is a net, not a judge.** It catches known-dangerous *shapes*. A fluent, plausible,
  entirely false sentence containing no numbers, brands or superlatives can pass it. Human
  review is the control; the guard only makes review cheaper.
- **The fact corpus is English.** For Arabic, Farsi and Gulf drafts it checks numbers, prices
  and Latin-script terms only. It therefore refuses to return a clean bill of health: every
  non-English draft is issued a **blocking** `translation-unverified` finding requiring a fluent
  speaker to sign off. We would rather admit the gap than fake coverage.
- **`review`-severity findings are prompts, not verdicts.** `unverified-wording` means "this
  sentence uses words the sources don't — check that it still only says what we can support."

---

## 5. Multilingual — Arabic, Farsi and the Gulf

These are real customers, verified in production, not a hypothetical market. Copy that treats
them as an afterthought reads exactly like an afterthought.

| Code | Language | `dir` | URL prefix |
| --- | --- | --- | --- |
| `en` | English | `ltr` | `/blog/…` |
| `ar` | Arabic | `rtl` | `/ar/blog/…` |
| `ar-AE` | Arabic (Gulf) | `rtl` | `/ar-ae/blog/…` |
| `fa` | Farsi | `rtl` | `/fa/blog/…` |

Rules:
- `lang` and `dir` are written into the front-matter and into the JSON-LD `inLanguage`. The
  rendering layer must apply both. Shipping an RTL article inside an LTR document is the most
  visible possible way to tell a reader you did not really mean it.
- **Slugs stay ASCII.** The language lives in the path prefix, not in percent-encoded Arabic.
  URLs stay readable, shareable and provably URL-safe.
- Each language gets its own canonical URL. Add `hreflang` pairs at the routing layer when the
  localised routes go live.
- **A machine translation is a draft of a translation.** A fluent speaker reviews meaning *and
  tone* before publication. Mira's voice is warm, short and human — that has to survive the
  crossing, and machine translation routinely turns warmth into stiffness.

---

## 6. The review workflow

```
  1. GENERATE   node scripts/content-pipeline.mjs --topic <id> --language <code>
                → content/drafts/<slug>.<lang>.md   (status: draft, always)

  2. TRIAGE     Read every claimFinding.
                Any `block` finding: fix the copy or delete the sentence.
                Never resolve a finding by weakening the guard.

  3. VERIFY     Walk the 12-item checklist in the front-matter.
                Re-open src/lib/veridian-kb.ts and tiers.ts and check the claims
                against them TODAY. Pricing drifts.

  4. LANGUAGE   Non-English: a fluent speaker signs off on meaning and tone.

  5. BYLINE     Attach a real, accountable human name. Not "the team". Not an AI.

  6. PUBLISH    A human moves the file out of drafts/ and sets the status BY HAND,
                in a reviewed commit, with the checklist ticked in the diff.
```

Non-negotiables:
- **Two people minimum**: the person who ran the pipeline may not be the sole approver.
- **The checklist ships in the diff**, so the review is auditable after the fact.
- **Never suppress a finding to make the pipeline quiet.** If the guard is wrong, fix the guard
  in its own reviewed commit with a test — a control that gets edited to stop complaining is
  worse than no control.
- Draft output is **not** wired into any route. `content/drafts/` sits outside `src/`, so nothing
  in it is routable even by accident.

---

## 7. Backlinks: earned, never bought

Buying links violates Google's spam policies and risks a manual action against a domain that is
currently taking real money. The downside is the whole commercial site; the upside is a few
positions. It is not a close call.

**We do not:** buy links, rent links, use PBNs, mass-post guest articles for links, swap links
reciprocally at scale, or drop links in comments and forums.

**We do:**
- **Build things worth citing.** Genuinely useful writing on grounded assistants, RTL/Arabic
  voice interfaces, and studying with your own material — subjects where we have real, specific
  experience others do not.
- **Be the primary source about ourselves.** Accurate docs, a clear pricing page, a real about
  page. Journalists and directories link to whoever is easiest to quote accurately.
- **Earn directory and marketplace listings on merit** — Telegram bot directories, UAE and Gulf
  tech listings, product directories. Real listings for a real product.
- **Show up where the audience already is**, under a real name, answering real questions, with
  a link only where it genuinely helps.
- **Partner honestly.** Named partners appear in copy only with written agreement.
- **Publish in Arabic and Farsi properly.** Almost nobody serves Gulf customers a genuinely
  well-written RTL assistant article. Doing it well earns links no purchase could.

**Technical foundation** (the part of SEO that is entirely within our control and carries no
integrity risk) is already in place and is owned separately from this work:
`src/app/robots.ts` keeps `/api/`, checkout, welcome, account, login and start out of the index,
and `src/app/sitemap.ts` builds the public route list from `src/lib/seo.ts`. Content work must
not duplicate or contradict those files — when `/blog` routes are built, they should be added to
the route table in `src/lib/seo.ts` so the sitemap picks them up automatically rather than being
hand-maintained here.

---

## 8. Known gaps in this work

Reported honestly rather than quietly:

1. **No npm script was added.** `package.json` was held by another agent's active
   context-ledger claim during this task, so it was not edited. Add by hand:
   `"test:content": "node --test scripts/content-pipeline-test.mjs"`.
2. **`SITE_ORIGIN` is duplicated, not shared.** The pipeline hardcodes
   `https://vualet.com`, which matches `ORIGIN_MAIN` in `src/lib/seo.ts` today — checked, they
   agree. They are not the *same* constant, because `content-pipeline.mjs` is plain ESM and
   cannot import a `.ts` module without a loader. **This is a drift risk:** if the origin ever
   changes in `src/lib/seo.ts`, update `SITE_ORIGIN` in the pipeline in the same commit.
3. **`/blog` routes do not exist yet.** The pipeline emits canonical URLs for a route structure
   that has not been built. Building it is separate work, and no draft may be published before
   it exists. Register the routes in `src/lib/seo.ts` so the sitemap covers them (see §7).
4. **The guard cannot judge fluent falsehoods.** See §4. Human review is the control.
5. **Facts were read on 2026-08-05.** The sourced-fact corpus in the pipeline is a snapshot with
   file:line citations. Re-read the cited files before any campaign; pricing in particular drifts.

---

## 9. Files

1. `C:\vualet-web\scripts\content-pipeline.mjs` — the drafts-only generator, topic model,
   sourced-fact corpus, claim guard, and CLI.
2. `C:\vualet-web\scripts\content-pipeline-test.mjs` — 28 tests, offline, injected fakes.
3. `C:\vualet-web\docs\CONTENT_STRATEGY.md` — this document.
