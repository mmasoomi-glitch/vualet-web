# Overnight Refactor — vualet-web

**Branch:** `refactor/overnight-2026-08-26` (cut from `remediation/wa-pairing-entry`)
**Started:** 2026-08-26
**Running total spend:** $0.0000

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
| 1 | `src/lib/plan-core.mjs` (30) | TODO | | | |
| 2 | `src/lib/promo.ts` (42) | TODO | | | |
| 3 | `src/lib/email.ts` (47) | TODO | | | |
| 4 | `src/lib/magic-link.ts` (61) | TODO | | | |
| 5 | `src/lib/entitlement.ts` (66) | TODO | | | |
| 6 | `src/lib/connect-token.ts` (67) | TODO | | | |
| 7 | `src/lib/session.ts` (75) | TODO | | | |
| 8 | `src/lib/signup-phone-hash.ts` (82) | TODO | | | |
| 9 | `src/lib/admin-totp.ts` (88) | TODO | | | |
| 10 | `src/lib/stripe.ts` (90) | TODO | | | |
| 11 | `src/lib/admin-roles.ts` (93) | TODO | | | |
| 12 | `src/lib/admin-privacy-contract.ts` (96) | TODO | | | |
| 13 | `src/lib/admin-crypto.ts` (101) | TODO | | | |
| 14 | `src/lib/pairing.ts` (106) | TODO | | | |
| 15 | `src/lib/phone.ts` (110) | TODO | | | |
| 16 | `src/lib/admin-guard.ts` (121) | TODO | | | |
| 17 | `src/lib/audit-chain.mjs` (126) | TODO | | | |
| 18 | `src/lib/products.ts` (130) | TODO | | | |
| 19 | `src/lib/promo-core.mjs` (152) | TODO | | | |
| 20 | `src/lib/admin-audit.ts` (162) | TODO | | | |
| 21 | `src/lib/veridian-kb.ts` (167) | TODO | | | |
| 22 | `src/lib/admin-session.ts` (173) | TODO | | | |
| 23 | `src/lib/whatsapp-claim.ts` (195) | TODO | | | |
| 24 | `src/lib/entitlement-core.mjs` (197) | TODO | | | |
| 25 | `src/lib/admin-accounts.ts` (209) | TODO | | | |
| 26 | `src/lib/consent.ts` (218) | TODO | | | |
| 27 | `src/lib/admin-stub.ts` (234) | TODO | | | |
| 28 | `src/lib/webhook-core.mjs` (235) | TODO | | | |
| 29 | `src/lib/client-address.ts` (291) | TODO | | | |
| 30 | `src/lib/veridian-memory.ts` (299) | TODO | | | |
| 31 | `src/lib/support-core.mjs` (338) | TODO | | | |
| 32 | `src/lib/seo.ts` (354) | TODO | | | |
| 33 | `src/lib/engine-push.ts` (357) | TODO | | | |

### Tier 2 — larger isolated modules

| # | Unit | Status | Commit | USD | Notes |
|---|---|---|---|---|---|
| 34 | `src/lib/store.ts` (514) | TODO | | | |
| 35 | `src/lib/pair-gateway.ts` (545) | TODO | | | |
| 36 | `src/lib/dodo.ts` (706) | TODO | | | |
| 37 | `src/lib/dodo-webhook-core.mjs` (1010) — split if needed | TODO | | | |
| 38 | `src/lib/system-knowledge.mjs` (1400) — split if needed | TODO | | | |
| 39 | `src/lib/reconcile-core.mjs` (1498) — split if needed | TODO | | | |

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
| 55 | `src/app/admin/team/page.tsx` (337) + `admin-login` (218) | TODO | | | |

---

## Run log

*(appended per unit)*

- **2026-08-26** — Phase 0 complete. `code-author` MCP confirmed connected. Baseline
  captured: tsc 0, build green, 865/865 tests. Branch `refactor/overnight-2026-08-26`
  created. Checklist above generated from a full file survey (137 source files).
