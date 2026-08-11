# SYSTEM MAP — what Mira actually is, today

**Generated:** 2026-08-05
**Method:** read-only compilation from source. Every claim below carries a `file:line`.
**Companion file:** `C:\vualet-web\docs\SYSTEM_MAP.json` — the same content, machine-readable, for drawing the visual map.

Paths without a prefix are relative to `C:\vualet-web`.
Paths prefixed `engine:` are relative to `C:\Ballerina-Motasadea-V1`.

**Status words mean exactly one thing each:**

| Word | Meaning |
|---|---|
| **REAL** | It runs today. |
| **SCAFFOLD** | The code exists and reads well, but it does not work end to end. |
| **DEAD** | Unreachable, or reachable and provably unable to change behaviour. |
| **PLANNED** | Specified or advertised only. |

---

## The honest ratio

| | Count |
|---|---|
| Features that run today (**REAL**) | **34** |
| Written but not working end to end (**SCAFFOLD**) | **12** |
| Unreachable or inert (**DEAD**) | **3** |
| Advertised only (**PLANNED**) | **4** |
| **Total inventoried** | **53** |

| Journey step status | Count |
|---|---|
| WORKING | 16 |
| PARTIAL | 4 |
| NOT_BUILT | 5 |
| **Total steps** | **25** |

Serving the owner's intention: **39 of 53**. Working against it: **14**.

**How to read that number.** 34 of 53 is a healthy product on paper. But the 19 that do not run are not scattered — they cluster on exactly two things:

1. **Doing the work for the customer.** The tool-calling loop, the build executor, any task surface.
2. **Remembering the customer.** The tenant knowledge base, the hash-chained context ledger, content-at-rest encryption.

Those two are the things the product is named for. Everything that works today — payments, auth, safety, OCR, voice-in, commands — is the *plumbing around* the promise rather than the promise itself.

---

## 1. The tiers — what each one unlocks

The tier list at `src/app/mira/_components/tiers.ts:15-52` is the single source of truth for the site, and the engine's cap table at `engine:apps/control-plane/src/limits.mjs:39-46` **matches it exactly**. That consistency is verified, not assumed.

| Tier | Price | Chat tokens/mo | Local OCR/mo | Premium OCR/mo | Sold as |
|---|---|---|---|---|---|
| **Free** | Free | 1,000,000 | 30 | **0** | Chat + voice notes, remembers you, capped voice minutes |
| **Companion** | $14.99/mo | 15,000,000 | 500 | 20 | + a persona you shape, + load her knowledge base |
| **Assistant** | $39/mo | 60,000,000 | 2,000 | 100 | + build pipeline (beta), + priority replies |
| **Studio** | $79/mo | 200,000,000 | 10,000 | 400 | + your own WhatsApp number, + top of the queue |
| *Enterprise* | *not sold* | 1,000,000,000 | 100,000 | 2,000 | Exists in the engine cap table only; no storefront card, no checkout path (`engine:apps/control-plane/src/limits.mjs:45`) |

The storefront word "free" maps to the engine tier `trial`, and both resolve to the same 1M cap (`engine:apps/control-plane/src/limits.mjs:103-105`).

### What tier actually gates

**It gates quota:**
- Monthly chat tokens (`limits.mjs:54-56`)
- Monthly local-OCR count (`limits.mjs:90-93`)
- Build-job credit affordability (`engine:apps/engine/src/mira.mjs:81`)

**It gates exactly one capability:**
- **Premium OCR.** Free and trial get zero; paid tiers get a quota (`limits.mjs:78-84`, `engine:apps/engine/src/ocr.mjs:139-145`). This is the only place in the entire engine where a tier decides *what Mira can do* rather than *how much*.

**It does not gate, despite being sold that way:**

| Sold as a tier feature | Reality |
|---|---|
| "A persona you shape" (Companion) | `/mira/start` posts to `/api/begin` with no plan check at all — the free tier shapes a persona too (`src/app/api/begin/route.ts:23-59`) |
| "Load her knowledge base with your own text" (Companion) | No tier check exists because **no writer exists**. `setTenantKb` has zero callers repo-wide (`engine:apps/engine/src/kb.mjs:20`) |
| "Build pipeline (beta)" (Assistant) | The affordability gate fires, then the executor crashes on a missing directory |
| "Your own WhatsApp number" (Studio) | The gateway exists; nothing in the purchase flow reaches it |
| Voice reply frequency (0.2 free → 0.6 Studio) | The ratio test can never be true (see §4) |

---

## 2. The customer journey — what someone can actually do today

### Getting in

**1. Land on mira.vualet.com — PARTIAL.**
Both primary calls-to-action say *"Join the waitlist"* and go to `/mira/signup` (`src/app/mira/page.tsx:40,179`). The paid path exists and works, but the front door does not lead to it.

**2. Join the waitlist — WORKING.**
Native form POST, works without JavaScript, appends to a durable JSONL file kept outside the deploy tree (`src/app/mira/signup/page.tsx:39`, `src/app/api/waitlist/route.ts:7-14`).

**3. Try the demo at /veridian — WORKING.**
Answers strictly from a curated public knowledge base and says "I don't know" for anything outside it. It remembers a returning visitor by cookie and speaks with ElevenLabs TTS, degrading to browser speech rather than failing (`src/app/api/veridian-demo/route.ts:20-40`, `src/app/api/veridian-voice/route.ts:3-13`). This demo is a genuinely good piece of work: it is honest about its own boundaries in the product's own voice.

**4. See the plans — WORKING.** (`src/app/mira/plans/page.tsx:58`)

**5. Shape your Mira — WORKING.**
Five steps: Name, Vibe, Role, Channel, Review. WhatsApp appears as a channel and is correctly disabled with "Coming soon" (`src/app/mira/start/page.tsx:22-27`).

### Paying

**6. Free plan checkout — WORKING.**
Mints an HMAC-signed connect token, stores the persona, returns a Telegram deep link. Touches no payment provider (`src/app/api/begin/route.ts:48-65`).

**7. Enter a discount code — NOT BUILT.**
The field is on the page and the customer can type into it, but every code is refused. See §5, gate 6 — this was a live mischarge trap and killing it was the right call.

**8. Paid checkout — WORKING.**
The server validates the email server-side (a browser `required` attribute is not a guard), requires both `DODO_PAYMENTS_LIVE=1` and the plan's product id, then creates a Dodo payment link (`src/app/api/checkout/route.ts:34-50`, `src/lib/dodo.ts:64-66`).

**9. Pay on Dodo — PARTIAL.**
Dodo is the merchant of record. The create-subscription body sends **no trial parameter** (`src/lib/dodo.ts:100-116`), while the checkout page promises "14-day free trial, no charge for 14 days" three separate times (`src/app/mira/checkout/page.tsx:180,206,348`). A trial may be configured on the Dodo product itself — that cannot be verified from this repo, so treat it as unproven.

**10. Land on /mira/welcome — WORKING.** (`src/app/mira/welcome/page.tsx:17-28`)

**11. Webhook activates the tier — WORKING.**
Signature verified against the raw body, deduped on the webhook id, and a handler error returns 500 *without* marking the event processed so Dodo retries (`src/app/api/webhooks/dodo/route.ts:64-71,83-119`). Careful, correct work.

### Using it

**12. Bind Telegram with `/start <token>` — WORKING.**
Single-use claim: the first Telegram id owns the token, any other id is rejected with 409. The bot authenticates with a shared bind secret (`engine:apps/engine/telegram-bot.mjs:698-703`, `src/app/api/connect/route.ts:34-64`).

**13. First contact — WORKING.**
Mira introduces herself, and this greeting is **forced to voice regardless of the ratio** (`engine:apps/engine/telegram-bot.mjs:370-387`). It is the only TTS a customer reliably hears.

**14. Text chat — WORKING.**
Crisis check → moderation → classify → memory → LLM with provider failover → leak filter → quota debit. Replies are capped at **160 tokens**, roughly 120 words (`engine:apps/engine/src/mira.mjs:164`). An assistant advertised as building websites cannot deliver much through a 160-token pipe.

**15. Send a voice note — WORKING.** ElevenLabs STT feeds the same pipeline (`engine:apps/engine/telegram-bot.mjs:720-723`).

**16. Hear a voice reply — NOT BUILT.** See §4.

**17. Send a photo — WORKING.**
Tier-metered OCR: local tesseract for everyone within a cap, the paid AFAQ engine only for paid tiers. Over-cap gets a warm limit message, not an error (`engine:apps/engine/telegram-bot.mjs:728-742`). This is the best-built capability in the engine and the closest thing to "she does the work" that actually works.

**18. Slash commands — WORKING.**
`/help /whoami /tenant /switch /organizations /phone /privacy /unlink`. The router is pure and injected, loaded lazily so a broken router can never take the live bot down, and it runs after the entitlement gate and before any model call so a command never costs money (`engine:apps/engine/telegram-bot.mjs:617-626,711-717`).

> **Correction to the engine's own FEATURE_AUDIT.** That document lists the command surface as *"IN FLIGHT"* and states `/start` is the only command. It has since landed. `telegram-bot.mjs` is now 842 lines, and every line number that document cites for that file (317, 396, 405) is stale.

**19. Ask her to build something — NOT BUILT.**
Classified as a job (`engine:apps/engine/src/router.mjs:7`), charged a 400+ credit affordability gate, answered *"On it 💛"* (`mira.mjs:96`), then the executor import fails because `C:\fleet\bridge` does not exist on this machine — verified 2026-08-05 (`engine:apps/control-plane/src/veridian.mjs:5,11`).

**20. Load your own knowledge — NOT BUILT.**
Sold on Companion. Retrieval works. The only writer of tenant KB text has **zero callers anywhere**, so every tenant's knowledge base is structurally empty (`engine:apps/engine/src/kb.mjs:20`).

### Managing the account

**21. Sign in — WORKING.**
Single-use 15-minute magic link. Always answers 200 so the endpoint cannot be used to enumerate which emails have accounts. Rate limited per IP and per email (`src/app/api/auth/request/route.ts:8-26`).

**22. See your plan — PARTIAL.** See §5, gate 5. This is the most consequential gap on the web side.

**23. Cancel — PARTIAL.**
The route itself is excellent: identity comes only from the verified session, so the caller cannot name whose subscription to cancel, and it resolves from the Dodo-populated store and cancels at period end (`src/app/api/subscription/cancel/route.ts:26-35`). But the button that calls it is rendered **only inside the Stripe-entitlement branch** (`src/app/mira/account/page.tsx:172,192`) — so a Dodo customer cannot see it.

**24. Request a refund — WORKING.**
Recorded durably, operator emailed, payment provider never called. Cancelling is the customer's right; refunding is a human decision (`src/app/api/subscription/refund-request/route.ts:9-27`).

**25. WhatsApp — NOT BUILT.**
Sold on Studio, shown as "Coming soon" in the builder. The provisioning gateway is real code with per-tenant isolated sessions and a branded pairing page, but no purchase reaches it, and headless WhatsApp violates WhatsApp's terms (`engine:apps/engine/whatsapp-gateway.mjs:1-13`).

---

## 3. Channels

| Channel | Status | Reality |
|---|---|---|
| **Web** | REAL | vualet.com + mira.vualet.com — marketing, plans, checkout, account, demo |
| **Telegram** | REAL | The only channel a paying customer actually reaches: text, voice in, OCR, eight commands |
| **WhatsApp** | SCAFFOLD | Gateway code exists; unreachable from any purchase; ToS problem |
| **Email** | REAL | Transactional only — sign-in links, operator refund notices |
| **Admin console** | REAL | Separate operator surface: own auth, MFA, RBAC, audit trail |

---

## 4. Things that look like features and are not

These matter more than the gaps, because each one is currently *selling* something the code cannot deliver.

**Voice replies by tier — DEAD.**
The ratio table (0.2 free → 0.6 Studio) is the cost lever the pricing model is built on. `shouldVoice()` compares `floor(n × r) > floor((n-1) × r)` (`engine:apps/engine/src/router.mjs:26`), but `replyN` is reset to 0 on every inbound message (`engine:apps/engine/telegram-bot.mjs:370,412,767`), so `n` is always 1 and the test is always false for any ratio below 1.0. The tier difference is decorative.

**Style imitation — REAL, running live, and working against the intention.**
It runs on every reply (`engine:apps/engine/src/mira.mjs:182`). It can truncate an answer to **30 characters** for a customer whose own messages are short, or wrap it in *"Sure, … right?"* (`engine:apps/engine/src/style-generator.mjs:99,156`). The consent gate that is supposed to guard it returns `auto_send: true` for tenants who never enrolled (`engine:apps/engine/src/impersonation.mjs:66-74`). "Never talks down" and programmed sarcasm cannot both be true.

**LAP grounding — SCAFFOLD, with one harmful live branch.**
Grounding rows are never injected into the prompt and three of the four firewall checks cannot alter output. The one branch that does fire tells a customer *"I don't have anything about that in your record, so as far as I know it didn't happen"* — on every first-person question, because the knowledge base is structurally empty (`engine:apps/engine/src/lap-tier-router.mjs:71,83`).

**The tool-calling engine — SCAFFOLD.**
A complete multi-round tool loop with four registered capabilities, and **zero production callers** (`engine:apps/engine/src/tools.mjs:24`). This is the machinery "she does the work for you" needs, sitting unwired.

**The credit meter called "ledger" — REAL, but misnamed.**
It stores money, not the customer's information, and trims to the last 1000 events (`engine:packages/state/src/ledger.mjs:8-28,56`). The word "ledger" in the product promise means something this file is not.

**Behaviour facts — DEAD.**
Opens a local SQLite file while the whole system is Postgres, its table appears in no migration, and its schema initialiser is imported but never called (`engine:apps/engine/src/behavior.mjs:6-8`, `engine:apps/engine/src/mira.mjs:12`).

---

## 5. Open gates — what must be true before the next move

**1. Migration 005 (`tenant_deks`) has never run in production.**
Content-at-rest encryption is **not live**. Production `mira_state` predates it; the table is simply absent. *(ledger gotcha #136; `engine:packages/state/migrations/005_content_encryption.sql:16`)*

**2. Shadow ledger writes must not be enabled before 005 is applied.**
`tenant_facts.statement` is specified as ciphertext and the hash covers the **stored bytes**. Plaintext written now could never be re-encrypted without breaking the chain irrecoverably. This is a one-way door. *(ledger gotcha #137; `engine:packages/state/migrations/009_tenant_ledger.sql:99-100`)*

**3. The first production restart applies SIX migrations, not two.**
002, 005, 006, 007, 008 and 009. All six were proved together on a snapshot, so the tested path is the real one — but the deploy plan's wording understates the blast radius and must be corrected before sign-off. *(ledger gotcha #136)*

**4. The engine on production is not the engine in main.**
Production runs roughly 2026-07-14 code; main is at `411ab1e` and has never been deployed. The box holds a built image with no git checkout, so the deployed commit is not recoverable from the machine — a deploy must record its commit SHA into the ledger at deploy time. *(canonical ledger, state [ballerina])*

**5. Sign-in entitlement reads Stripe; production charges Dodo.**
`entitlementForEmail` queries Stripe only (`src/lib/entitlement.ts:1,22-26`). A Dodo-paying customer who signs in sees **"No active plan"** — and because the billing, cancel and refund controls all live inside that same branch (`src/app/mira/account/page.tsx:172`), the working cancel route is not reachable from the UI for exactly the customers who paid. The route is fine. The surface hides it.

**6. Discount codes are visible but always refused.**
The validator prices against Stripe while the charge goes through Dodo, and `/api/checkout` never forwards the code. A customer once entered a 100%-off code, was quoted $0, and was charged full price. The kill switch is off by default and should stay off until checkout applies the discount end to end. *(`src/app/api/promo/validate/route.ts:22-38`)*

**7. The 14-day trial is promised but not sent.**
Unverified either way from this repo. *(`src/lib/dodo.ts:100-116`)*

**8. No build can complete.**
The executor lives in a directory that does not exist. Either vendor the pipeline into the repo, or replace it with the tool-calling loop already written. *(`engine:apps/control-plane/src/veridian.mjs:5,11`)*

**9. The LAP closed-world negative must be off until a populated ledger exists.**
Right now it contradicts the customer's own memory using an empty knowledge base as its evidence.

**10. No real card has been run end to end.**
Pay → welcome → Telegram bind → webhook activation is proven by tests, not by a customer. *(canonical ledger, state [mira-suite])*

---

## 6. The data model

**Web — the bridge between a purchase and a chat**

- **`ConnectRecord`** (`src/lib/store.ts:127-140`) — token, plan, email, status (`pending`/`bound`/`active`/`cancelled`), customerId, subscriptionId, telegramId, persona, role, assistantName. This single record is the whole seam between the website and the bot.
- **Storage tiers** (`src/lib/store.ts:18-22,58-67`) — Upstash REST, else a durable JSON file with atomic temp+rename, else in-process memory with a loud production warning. Live payments are gated on durability.
- **Email → customer index** (`src/lib/store.ts:145,177-185`) — without it there is no email-to-subscription path at all, which is what once left customers unable to cancel.
- **JSONL capture files** — waitlist, contact, refund requests. Append-only, outside the deploy tree, no external dependency.
- **Admin audit chain** (`src/lib/audit-chain.mjs`) — append-only with chain verification; no route anywhere edits or deletes a row.

**Engine — Postgres, nine migrations**

| Migration | Tables / columns | In production? |
|---|---|---|
| 001 | `tenants`, `jobs`, `messages`, `tenant_style_profiles`, `pilot_mode`, `pilot_approvals` | Yes |
| 002–004 | `kb_json`, `tokens_used_period`, `period_start`, `ocr_used_period`, `ocr_premium_used_period` | Columns yes; `tenant_kb` table no |
| **005** | **`tenant_deks`** — per-tenant wrapped encryption key | **No — gate 1** |
| 006 / 007 | `common_facts`, `album_seeds` | No; neither is populated |
| 008 | `identities`, `channel_identities`, `orgs`, `memberships`, `consents`, `invitations` | No |
| 009 | `tenant_facts`, `tenant_ledger_heads`, `tenant_ledger_checkpoints` | No — **this is the real context ledger** |

Note what is missing rather than what is there: `jobs` covers **builds only**. There is no task or commitment table anywhere — nothing that could answer *"what did you do for me last week?"*

---

## 7. The one-paragraph summary

Mira today is a **well-built payment, identity and safety layer wrapped around a chat assistant that remembers you for twenty turns**. The money path is live and careful. Auth is server-side and anti-IDOR throughout. Safety fires before anything else. OCR genuinely does work for the customer, and it is the only place a tier unlocks a capability rather than a quota. What is *not* built is the pair of promises the product is named for: she does not yet implement tasks (the executor is a missing directory; the tool loop is unwired), and she does not yet keep a context ledger (the hash-chained tables are written but hard-gated behind an encryption migration that has never run). Three live behaviours — the closed-world negative, sarcastic styling, and 30-character truncation — actively contradict "stands beside you like a brother, never talks down." Those are the cheapest, highest-value things on this map to remove.
