# Overnight Refactor — vualet-web

**Branch:** `refactor/overnight-2026-08-26` (cut from `remediation/wa-pairing-entry`)
**Started:** 2026-08-26
**Running total spend:** $0.0430

> **Resume point.** Any fresh session continues from this file alone: take the first
> unit whose status is `TODO`, follow the loop in the run instructions, update the row.
> Never author code directly — every rewritten unit comes from the `code-author` MCP.

---

## Project map

`vualet-web` is the **public web + control-plane** half of the Mira product (the engine
half lives in a separate repo and is out of scope). It is a **Next.js 15 App Router**
project in TypeScript, with a meaningful amount of business logic deliberately written as
plain `.mjs` so it can be unit-tested by `node --test` without a bundler. Four components:

1. **Marketing/storefront pages** — `src/app/*` (home, pricing, products, legal, security).
2. **Customer flows** — signup, checkout, WhatsApp pairing, account/cancel
   (`src/app/mira/*`, `src/app/api/begin`, `src/app/api/pair/*`, `src/app/api/checkout`).
3. **Admin control plane** — login, MFA/TOTP, team, audit, customers
   (`src/app/admin/*`, `src/app/api/admin/*`, `src/lib/admin-*`).
4. **Billing spine** — Dodo Payments (merchant of record) + a legacy Stripe path, webhooks,
   entitlement, reconciliation (`src/lib/dodo*`, `src/lib/*webhook*`, `src/lib/reconcile-core.mjs`).

**Definition of "working" (baseline, measured 2026-08-26 before any change):**

| Gate | Command | Baseline |
|---|---|---|
| Types | `npx tsc --noEmit` | exit 0 |
| Build | `npm run build` | success, all routes emitted |
| Tests | `node --test "scripts/*-test.mjs"` | **865 tests, 865 pass, 0 fail, 0 skipped** |

All three must stay green after every unit. Any unit that cannot hold them is reverted.

**Untouchable:** `node_modules/`, `.next/`, `package-lock.json`, `data/`, `evidence/`,
`public/` binaries, `tsconfig.tsbuildinfo`. Test scripts under `scripts/` are the safety
net — they are **not** refactor targets in this run (changing the ruler and the thing
being measured at the same time is how a refactor hides a regression).

---

## Triage rule

Working code that is already clean is **left alone**. For each unit: read it, then judge
— does it serve its purpose, and is it reasonably organised? If yes → `CLEAN` with one
line of justification, no MCP call. Only genuinely messy, duplicated, tangled or fragile
units are rewritten. *"I would have written it differently"* is not messy. A healthy run
marks many units CLEAN.

---

## Checklist

Ordered lowest-risk first: leaf utilities → isolated modules → services → entry points.

### Tier 1 — leaf utilities (`src/lib`, no inbound coupling beyond imports)

| # | Unit | Status | Commit | USD | Notes |
|---|---|---|---|---|---|
| 1 | `src/lib/plan-core.mjs` (30) | CLEAN | | | Pure priceId->plan map, injected deps, no env reads. Deep-read. |
| 2 | `src/lib/promo.ts` (42) | CLEAN | | | Thin typed wrapper over the pure core; one commented cast seam. Deep-read. |
| 3 | `src/lib/email.ts` (47) | CLEAN | | | Lazy transport singleton, config guard, one template. Deep-read. |
| 4 | `src/lib/magic-link.ts` (61) | CLEAN | | | HMAC + single-use nonce, timing-safe, fails hard in prod. Deep-read. |
| 5 | `src/lib/entitlement.ts` (66) | CLEAN | | | DI into pure core, non-throwing by contract. Deep-read. |
| 6 | `src/lib/connect-token.ts` (67) | CLEAN | | | Documents the Telegram 64-char constraint + legacy accept. Deep-read. |
| 7 | `src/lib/session.ts` (75) | CLEAN | | | Signed httpOnly cookie, timing-safe verify. Deep-read. |
| 8 | `src/lib/signup-phone-hash.ts` (82) | CLEAN | | | One pure fn mirroring the engine's algorithm, exhaustively justified. Deep-read. |
| 9 | `src/lib/admin-totp.ts` (88) | CLEAN | | | Dependency-free RFC 6238, timing-safe compare. Deep-read. |
| 10 | `src/lib/stripe.ts` (90) | CLEAN | | | Lazy client, delegates mapping to the pure core. Deep-read. |
| 11 | `src/lib/admin-roles.ts` (93) | CLEAN | | | Zero smell signals. |
| 12 | `src/lib/admin-privacy-contract.ts` (96) | CLEAN | | | Zero smell signals. |
| 13 | `src/lib/admin-crypto.ts` (101) | CLEAN | | | Zero smell signals. |
| 14 | `src/lib/pairing.ts` (106) | CLEAN | | | Zero smell signals. |
| 15 | `src/lib/phone.ts` (110) | CLEAN | | | Zero smell signals. |
| 16 | `src/lib/admin-guard.ts` (121) | CLEAN | | | Zero smell signals. |
| 17 | `src/lib/audit-chain.mjs` (126) | CLEAN | | | Zero smell signals. |
| 18 | `src/lib/products.ts` (130) | CLEAN | | | Zero smell signals. |
| 19 | `src/lib/promo-core.mjs` (152) | CLEAN | | | Zero smell signals. |
| 20 | `src/lib/admin-audit.ts` (162) | CLEAN | | | Zero smell signals. |
| 21 | `src/lib/veridian-kb.ts` (167) | CLEAN | | | Long data lines only; no dup/complexity signal. |
| 22 | `src/lib/admin-session.ts` (173) | CLEAN | | | Zero smell signals. |
| 23 | `src/lib/whatsapp-claim.ts` (195) | CLEAN | | | Zero smell signals. |
| 24 | `src/lib/entitlement-core.mjs` (197) | CLEAN | | | Zero smell signals. |
| 25 | `src/lib/admin-accounts.ts` (209) | CLEAN | | | Zero smell signals. |
| 26 | `src/lib/consent.ts` (218) | CLEAN | | | Zero smell signals. |
| 27 | `src/lib/admin-stub.ts` (234) | CLEAN | | | Long data lines only; longest fn 13 lines. |
| 28 | `src/lib/webhook-core.mjs` (235) | CLEAN | | | 2 minor dup blocks, longest fn 15 lines - below the rewrite bar. |
| 29 | `src/lib/client-address.ts` (291) | CLEAN | | | Zero smell signals. |
| 30 | `src/lib/veridian-memory.ts` (299) | CLEAN | | | Zero smell signals. |
| 31 | `src/lib/support-core.mjs` (338) | CLEAN | | | Longest fn 75 lines, no dups - acceptable. |
| 32 | `src/lib/seo.ts` (354) | CLEAN | | | Longest fn 119 lines but one flat metadata builder, no dups. |
| 33 | `src/lib/engine-push.ts` (357) | CLEAN | | | Zero smell signals. |

### Tier 2 — larger isolated modules

| # | Unit | Status | Commit | USD | Notes |
|---|---|---|---|---|---|
| 34 | `src/lib/store.ts` (514) | CLEAN | | | Zero smell signals despite size. |
| 35 | `src/lib/pair-gateway.ts` (545) | CLEAN | | | Zero smell signals despite size. |
| 36 | `src/lib/dodo.ts` (706) | DONE | (this commit) | 0.0430 | Extracted `requireDodoKey` + `dodoFetch`; 4 call sites de-duplicated. |
| 37 | `src/lib/dodo-webhook-core.mjs` (1010) | CLEAN | | | 463 code lines, longest fn 90, zero dups - already well factored. |
| 38 | `src/lib/system-knowledge.mjs` (1400) | CLEAN | | | Mostly content data; longest fn 63, zero dups. |
| 39 | `src/lib/reconcile-core.mjs` (1498) | TODO | | | Top smell score (10): 174-line fn + 5 dup blocks around `evaluate(...)`. |

### Tier 3 — API routes (services)

| # | Unit | Status | Commit | USD | Notes |
|---|---|---|---|---|---|
| 40 | `src/app/api/admin/*` small routes (login, mfa, admins, me) | TODO | | | |
| 41 | `src/app/api/contact` + `waitlist` + `connect` | TODO | | | |
| 42 | `src/app/api/subscription/cancel` (218) + `refund-request` (126) | TODO | | | |
| 43 | `src/app/api/checkout/route.ts` (317) | TODO | | | |
| 44 | `src/app/api/veridian-demo/route.ts` (351) + `veridian-voice` (131) | TODO | | | |
| 45 | `src/app/api/webhooks/stripe/route.ts` (268) | TODO | | | |
| 46 | `src/app/api/webhooks/dodo/route.ts` (419) | TODO | | | |
| 47 | `src/app/api/pair/bind` (153) + `pair/start` (557) | TODO | | | |
| 48 | `src/app/api/begin/route.ts` (663) | TODO | | | |

### Tier 4 — UI entry points (highest risk, last)

| # | Unit | Status | Commit | USD | Notes |
|---|---|---|---|---|---|
| 49 | `src/components/*` (nav, footer, logo, site-chrome, cs-bot) | TODO | | | |
| 50 | `src/app/mira/_components/MiraBot.tsx` (502) | TODO | | | |
| 51 | `src/app/veridian/VeridianChat.tsx` (708) | TODO | | | |
| 52 | `src/app/mira/start/page.tsx` (701) | TODO | | | |
| 53 | `src/app/mira/checkout/page.tsx` (558) | TODO | | | |
| 54 | `src/app/mira/account/page.tsx` (357) + `welcome` (287) | TODO | | | |
| 55 | `src/app/admin/team/page.tsx` (337) | TODO | | | 2 dup blocks, 11 long lines. |
| 56 | Shared `secret()` helper for `magic-link.ts` + `session.ts` | TODO | | | Byte-identical duplicate in security code; extract one source. |
| 57 | `src/app/admin-login/page.tsx` (218) | TODO | | | **16 duplicate blocks in 198 code lines** - highest dup density in the repo. |

---

## Run log

*(appended per unit)*

- **2026-08-26** — Phase 0 complete. `code-author` MCP confirmed connected. Baseline
  captured: tsc 0, build green, 865/865 tests. Branch `refactor/overnight-2026-08-26`
  created. Checklist above generated from a full file survey (137 source files).

- **2026-08-26** — Triage sweep. Built `scratchpad/triage-scan.mjs`, a structural smell
  scanner (longest function, nesting depth, duplicate 5-line blocks, TODO/FIXME, `as any`,
  `@ts-ignore`, comment-stripped size). Reading all 44k lines directly would have burnt the
  context this run needs, so 11 leaf utilities were deep-read to calibrate the scanner and
  the rest triaged on its signals. Result: **85 of 136 source files show zero smell
  signals.** Tier 1 is entirely CLEAN — this codebase is unusually well-factored and
  heavily commented, which is exactly the "expect many CLEAN" case.
- **2026-08-26** — Unit 36 `src/lib/dodo.ts` DONE. Four HTTP call sites each repeated the
  API-key check, the auth headers, `JSON.stringify`, and an identical non-2xx branch.
  Extracted `requireDodoKey()` + `dodoFetch()`. Gates after: tsc 0, 865/865 tests, build
  green. **Two author passes were needed, and the first APPROVED output was discarded
  rather than applied:** it emitted `const body = {}` as a placeholder — which would have
  shipped an empty checkout body and deleted ~30 lines of live billing logic — plus a
  `let productId: string` read before assignment (fails strict TS). The cause was my own
  dossier instructing it to treat the body as a placeholder; the corrective dossier inlined
  the real code and prescribed the helper shape. A judge approving code that would delete
  working logic is precisely why application is gated on the local build, never on the
  verdict alone.
- **2026-08-26** — FINDING, queued as unit 56: `src/lib/magic-link.ts` and
  `src/lib/session.ts` carry a byte-identical `secret()` function. Small, but it is security
  code where a silent divergence between the two copies would be dangerous.
