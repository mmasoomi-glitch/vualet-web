# Mira Assistant — Sales-Readiness Dossier

**Date:** 2026-08-27 · **Scope:** `vualet-web` (web + control plane) and the engine at
`23.88.59.31` (assistant runtime) · **Method:** read-only inspection of code, live hosts,
production logs, Postgres, Resend and the canonical ledger. No code was changed.

> Epistemics: **VERIFIED** = observed directly this session. **LEDGER** = hash-chained
> ledger row. Where the ledger disagreed with the live system, the live system wins and the
> discrepancy is stated.

---

## RE-VERIFICATION 2026-09-11 — TWO OF THE FOUR BLOCKERS BELOW ARE ALREADY FIXED

**Do not work from the blocker sections below without re-running the checks.** They were
accurate on 2026-08-27 and are now stale, exactly as this project's handover warns: *"ledger
rows go stale — verify a blocker still exists by running something before you work on it."*
Each line below was measured on 2026-09-11, not inferred.

| Blocker | Doc says | Measured 2026-09-11 |
|---|---|---|
| 1 — Dodo webhook | Investigated, sound | unchanged |
| 2 — Admin mock data | "UI REWIRE **PENDING**" | **DONE** |
| 3 — Billing portal | Done | unchanged |
| 4 — Multilingual crisis | "**THE SAFETY GAP REMAINS OPEN**" | **DONE** |

**Blocker 4 — crisis detection now fires 12 of 12, with zero false positives.** The section
below records it firing on 1 of 8 phrasings, English only. Run against the live `crisisCheck`
in `/opt/mira/apps/engine/src/safety.mjs` on host `mira`, every one of these now fires:
English (two forms), Arabic, Urdu native, Persian **both spaced and joined**, Hindi **both
anusvara `हूं` and chandrabindu `हूँ`**, Roman Urdu (two forms), Arabizi, Tagalog. The two
spelling-variant pairs are named explicitly because they are precisely what broke the earlier
attempt and got it reverted. Three near-miss safe phrases correctly stay silent, including
*"this app is killing me lol"*.

The fix that landed uses three separate patterns — `CRISIS_EN` (preserved byte-for-byte),
`CRISIS_NATIVE` (no ASCII `\b`, which cannot match Arabic or Devanagari at all) and
`CRISIS_ROMAN`. The English-only reply and hotline text remain deliberately untranslated:
that is owner work, because a wrong emergency number could get someone killed.

**Blocker 2 — the admin console reads live data.** All five admin pages resolve through
`src/lib/admin-data.ts`, which derives from `listSubscriptions()` in `src/lib/store.ts`,
which SCANs `mira:sub:*` in Upstash. It also declares every metric it cannot truthfully
source — MRR, credits used, today's spend and revenue — as *unavailable with a stated
reason*, rather than inventing a number.

**What is still genuinely missing — confirmed, not assumed:** self-serve **plan
change/upgrade**. `src/app/api/subscription/` contains only `cancel` and `refund-request`,
and `src/app/api/portal/route.ts` states self-serve billing management is unreachable since
the processor changed. Changing a customer's plan remains a support action. That is the one
item on this page that a build should start from.

---

## 1. What exists — real vs stub

| Area | State | Evidence |
|---|---|---|
| **Storefront / marketing** | **REAL, live.** 33 pages, all probed 200 on `mira.vualet.com` incl. `/pricing`, `/legal/{terms,privacy,refund}` | VERIFIED: HTTP probes |
| **Customer flows** | **REAL.** 31 API routes: signup wizard, checkout, pairing, account, cancel | VERIFIED: `src/app/api/*/route.ts` |
| **Assistant engine** | **REAL, running.** `mira-whatsapp` + `mira-bot` both `active`, 0 restarts | VERIFIED: `systemctl` on 23.88.59.31 |
| **Admin auth** | **REAL.** TOTP MFA (RFC 6238, dependency-free), AES-256-GCM secret storage, signed sessions, hash-chained audit, RBAC | VERIFIED: `src/lib/admin-{totp,crypto,session,roles,audit}.ts` |
| **Admin *data*** | **STUB — hard-coded fiction** | VERIFIED: `src/lib/admin-stub.ts:1-13` "Every export here is hard-coded fake data" |
| **Test suite** | **REAL.** 865 tests, 865 pass, 0 fail; `tsc --noEmit` 0; build green | VERIFIED this session |

**The one material stub.** `admin-stub.ts` feeds the *entire* ops dashboard: `admin/page.tsx`
(KPIs), `admin/billing`, `admin/customers`, `admin/health`, and the API route
`src/app/api/admin/customers/route.ts`. `getKpis()` returns literals —
`todaySpendUsd: 312.4`, `todayRevenueUsd: 884.0` (`admin-stub.ts:180-192`). The auth guard and
the privacy projection wrapping it are genuine; **the numbers are invented.** Anyone running
the business off that dashboard is reading fiction.

## 2. Multi-tenancy — real and enforced

**VERIFIED REAL at schema and crypto level.** 18 Postgres tables carry `tenant_id`
(`behavior_facts, jobs, messages, observation_consent, orgs, pilot_approvals, pilot_mode,
tenant_deks, tenant_facts, tenant_ledger_*, tenant_style_profiles, whatsapp_*`). Per-tenant
data-encryption keys (`tenant_deks`) with envelope encryption; `packages/state/test/crypto.test.mjs`
asserts *"tenant B's key cannot decrypt tenant A's blob"*. Cross-tenant assertions appear in 5
test files. On the web side, `/api/portal` resolves the subscription **from the verified session
email only** — the caller cannot pass a customer id (`src/app/api/portal/route.ts:23-45`), with a
dedicated IDOR test (`scripts/revenue-portal-idor-test.mjs`).

**Honest limit:** isolation is proven by unit tests and schema, **not by an adversarial live
test** — and it has never been exercised at scale, because only **2 tenants exist** (both
`trial`). LEDGER `requirements#94` clause 5 also records multi-tenancy as never adversarially proven.

## 3. Payments — Dodo is wired and live; Stripe is deliberately dead

**Dodo is the live money path.** Production env carries `DODO_MODE=live`,
`DODO_PAYMENTS_LIVE=1`, `DODO_API_KEY`, `DODO_WEBHOOK_SECRET` and all three product ids
(VERIFIED: live process env). Code path: `/api/checkout` → `createDodoCheckout()` → hosted
payment link; `/api/subscription/cancel` → `cancelDodoSubscription()`; `/api/webhooks/dodo`
verifies Standard-Webhooks signatures.

**Stripe is switched off on purpose, and two features died with it.** The production keys are
renamed `DISABLED_STRIPE_SECRET_KEY` / `DISABLED_STRIPE_WEBHOOK_SECRET` and `PAYMENTS_LIVE=0`
(VERIFIED). `paymentsConfigured()` is therefore **false**, which disables:

- **`/api/portal`** — the customer "manage billing" portal calls `stripe().billingPortal`
  (`portal/route.ts:19,63`). **A paying Dodo customer has no self-serve billing portal.**
- **`/api/promo/validate`** — promo codes validate against Stripe (`promo/validate/route.ts:39`).
  **The promo box on the checkout page cannot work.**

These fail *closed* with a clean "not configured" response rather than crashing — the code is
half-wired, not broken. But `/api/portal` still received 19 live POSTs.

**Has money moved? No — and this is the crux.**
- 9 `POST /api/checkout` (5×200, 3×400, 1×503) — checkout has been exercised.
- 8 `POST /api/webhooks/dodo` — **all 8 returned HTTP 400.** App log reasons:
  `missing_headers` (majority), `bad_signature`, `timestamp_out_of_tolerance`.
  Stripe's webhook was hit in the *same seconds* with "No stripe-signature header" — the
  signature of **unsigned scanner probes, not genuine Dodo deliveries.** The endpoint
  correctly rejected them; this is the security control working, not a fault.
- **No signed Dodo webhook has ever been observed to succeed.** LEDGER (earlier session,
  2026-08-24) records the endpoint as registered and the secret digest as matching
  (`64396d824e1c`), but that fix has **never been proven by a real delivery.**
- Web store: **1** subscription record `status=active, plan=companion`. Engine: **2 tenants,
  both `trial`.** So even that record never propagated into a paid tenant.

## 4. Customer front door — traced end to end

`mira.vualet.com` → homepage CTAs point to **`/mira/start`** (3×) and `/mira/plans` (VERIFIED
live HTML) → wizard `POST /api/begin` (mints a 44-char connect token) → `/mira/checkout` →
`POST /api/checkout` → Dodo hosted payment → returns to `/mira/welcome?token=` → `/api/connect`
→ WhatsApp pairing via `/api/pair/start` (302 to QR).

**Works:** every page is live; `/api/begin` shows 24×200 in production logs; rate limiting is
real (19×429); one binding completed end to end (`whatsapp_bindings: 1`).

**Breaks:** the chain has **never completed with a real payment.** 33 connect records exist —
**32 `pending`, 1 `bound`.** Nobody has gone signup → card → activation.

**Trap:** `/mira/signup` is a **waitlist** page (`POST /api/waitlist`, 8× "waitlist" in live
HTML), not a purchase path — and it is advertised in the sitemap. The live homepage does not
link it, so it is a stale side door rather than the main route.

## 5. Infrastructure

| Item | State |
|---|---|
| **Hosting** | `mira-web` active since 2026-08-24, **0 restarts**; nginx → `127.0.0.1:3021`. Engine on a second VPS, both services active. VERIFIED |
| **SSL** | Let's Encrypt `CN=mira.vualet.com`, valid to **28 Oct 2026**. VERIFIED |
| **Cloudflare** | **Done right.** 26 `set_real_ip_from` ranges + `real_ip_header CF-Connecting-IP`; `client-address.ts` trusts *only* `x-real-ip`, refuses socket fallback, and rejects any address inside a Cloudflare range as self-proof of misconfiguration. A ranges-freshness checker + test ship with it. VERIFIED |
| **Resend email** | **Working.** Sending domain `vualet.com` **verified**; "Your Mira sign-in link" **delivered** 2026-08-24. Only **5 emails ever sent** — consistent with ~zero customers. `send.vualet.com` sits `not_started` (unused, harmless). VERIFIED |
| **Store durability** | `MIRA_STORE_FILE=/var/lib/mira-web/web-store.json` — a **single-process JSON file**, not Upstash. Fine for today's volume; it is not a multi-instance store. VERIFIED |
| **Defects** | `mira.vualet.com` returns **two conflicting HSTS headers** (origin + Cloudflare). Cosmetic, but sloppy for a security review. |

## 6. Versioning

- Git repo with GitHub remote (`mmasoomi-glitch/vualet-web`). Suite green, history clean.
- **Zero tags. No releases.** `git tag` → empty.
- **14 unpushed commits** on `remediation/wa-pairing-entry` — including last night's entire refactor. A laptop failure loses it.
- Work is **not on `main`**; `main` exists alongside 8 branches.
- **`/opt/mira-web` in production is not a git repository** — you cannot map running code to a commit. VERIFIED

## 7. The loopholes — ranked, with effort

| # | Blocker | Why it blocks selling | Effort |
|---|---|---|---|
| 1 | **No proven paid activation.** No signed Dodo webhook has ever succeeded; the only "active" record never became a paid tenant | A customer could be charged and never activated. This is unknown, not known-broken — and unknown is unsellable | **Hours** — one real card purchase end to end, then refund |
| 2 | **No self-serve billing portal.** `/api/portal` is Stripe-only, Stripe is off | Paying customers cannot manage or cancel their own billing. Consumer-law and chargeback exposure | **1–2 days** — port to Dodo's portal or build a minimal one |
| 3 | **Admin dashboard shows invented numbers** (`todayRevenueUsd: 884.0`) | You cannot run, support or bill a business off fiction; a demo to an investor would be misrepresentation | **2–4 days** — wire `getCustomers/getKpis` to the real store + Dodo |
| 4 | **Sitemap advertises 16 URLs on `vualet.com`, which serves a different product (Primaion).** 11 of 12 probed apex paths 404, **including all four legal pages** | Payment providers and reviewers check legal pages at the advertised URL and find nothing | **Hours** — point the sitemap at the host that serves this build |
| 5 | **Promo codes dead** (Stripe-gated) while the checkout page still shows a promo box | Customer enters a code, nothing works | **Hours** — hide the box, or reimplement on Dodo |
| 6 | **Crisis detection is English-only** (LEDGER `state#100`) | Safety exposure in a WhatsApp-first market where Urdu/Hindi/Persian/Arabic are first languages | **2–3 days** |
| 7 | **`/mira/signup` waitlist page still advertised** in the sitemap | Splits the funnel; a customer who follows it never reaches checkout | **Under an hour** |
| 8 | **No tags, 14 unpushed commits, prod not a git checkout** | No rollback target, no provenance, single-point-of-loss | **Hours** |
| 9 | **Multi-tenancy never adversarially tested**; 2 tenants, both trial | Isolation is well-built and unit-tested but unproven under attack | **2–3 days** |
| 10 | **Single-file JSON store, single engine node** | Fine at zero customers; a scaling and durability cliff, not a launch blocker | **Days–weeks** |

## What is genuinely good

Not faint praise — this is materially above typical pre-launch state. The security engineering
is real: timing-safe comparisons, HMAC single-use magic links, per-tenant envelope encryption,
fail-closed secret handling that refuses to boot forgeable tokens in production, a deliberate
Cloudflare-range guard that detects its own misconfiguration, IDOR-resistant portal resolution,
and an 865-test suite that is green. The storefront, the wizard, pairing, the engine and email
all work. **The gap is not construction quality — it is that the money path has never been run
once with a real card, and the admin surface reports fiction.**

---

## VERDICT

**SELLABLE AFTER LISTED FIXES.**

**Work remaining: ~1–2 weeks to first safe paying customer.** The critical path is short —
blockers 1, 4, 5 and 7 are hours each, and blocker 1 needs one real card transaction to convert
the biggest unknown into a known. Blockers 2 and 3 (billing portal, real admin data) are the
genuine engineering, at roughly 3–6 days combined. Blocker 6 (multilingual crisis detection) is
a safety obligation that should not ship late in a WhatsApp-first market.

Selling *today* is not blocked by missing product — it is blocked by **one untested payment
webhook and an admin console that cannot tell you the truth about your own business.**

---

# Phase 2 - Remediation log (2026-08-27)

**Branch:** `remediation/sales-blockers-2026-08-27` (cut from `remediation/wa-pairing-entry`)
**MCP spend this run:** **$0.1046** (code-author; 9 calls, 4 discarded)
**Gates after every commit:** `tsc --noEmit` 0 - eslint 0 - **865 tests / 865 pass / 0 fail** - build green
**All code authored by the code-author MCP.** No code was hand-written.

## Blocker 1 - Dodo webhook: INVESTIGATED, no code change (deliberate)

**The webhook code is sound and was already proven.** `scripts/dodo-webhook-test.mjs:51`
loads the **real** `src/app/api/webhooks/dodo/route.ts` and POSTs genuinely HMAC-signed
Standard-Webhooks payloads at it, so the real signature check, switch, store and dependency
wiring are all exercised. **85 tests, 85 pass.** The DONE criterion - *"a scripted webhook test
flips subscription state correctly and idempotently"* - is met by tests that already existed:

- `activateDodo writes connect + subscription records via injected store`
- `activateDodo round trip: the PAID connect record is still bindable`
- `K: replayed events are no-ops - Dodo retries must not corrupt state`
- `stale timestamp is rejected (replay guard)`
- live log line: `already refunded; no status change (replay-safe)`

**Nothing was authored, on purpose** - writing code against a working billing spine to satisfy a
checkbox would risk the one part of this product that is demonstrably correct.

**What is actually broken is configuration, and it is worse than the dossier knew:**

| # | Finding | Impact | Owner or code |
|---|---|---|---|
| 1a | **`MIRA_BILLING_PUSH_SECRET` is unset on BOTH hosts** (verified from `/proc/<pid>/environ` on 89.167.49.209 and 23.88.59.31) | `pushDisabledReason()` returns non-null, so **every** entitlement push to the engine is a silent no-op. The SSH tunnel on `127.0.0.1:8790` is up and the engine genuinely serves `POST /internal/billing/entitlement` - only the shared secret is missing | **OWNER** |
| 1b | **The reconciliation sweep is not scheduled.** Timers present: `mira-monitor`, `mira-expiry`, `mira-backup`, `mira-backup-encrypt`. No reconcile timer, no crontab entry | The documented fallback ("access converges through the re-resolve and the reconciliation sweep") **does not run**. `scripts/dodo-reconcile.mjs` and its 1530-line test exist and pass; nothing invokes them | **OWNER / ops** |
| 1c | **A paid UPGRADE never reaches the engine.** `subscription.plan_changed` and `subscription.updated` map to `kind: "reprice"`; `engineEventForEffect()` returns `null` for anything that is not revoke/restore; the engine accepts **only** revoke and restore events (`src/entitlement.mjs:223-259`) - there is no tier-change event at all | A first purchase is fine (the engine picks the tier up at bind time from the connect record). A customer who **upgrades after binding keeps their old tier** until a sweep that does not run | **CODE - two-repo change, NOT attempted** |

Together 1a and 1c explain the exact production state the dossier observed: **one active web
subscription record but both engine tenants still `trial`**, with 1b removing the repair path.

## Blocker 2 - Admin mock data: DATA LAYER DONE, UI REWIRE PENDING

**`b83436b` - `listSubscriptions()` added to `src/lib/store.ts`.** The store had **no listing
primitive at all** (only `kvGet`/`kvSet`/`kvDel`) - that absence is the root reason the admin
console could never show anything but hard-coded data. Upstash uses a `SCAN` cursor loop, never
`KEYS` (which blocks the server); the file backend (what production runs) skips TTL-expired rows
so an expired record cannot appear in an admin list, and skips unparseable rows rather than
failing the listing. Capped at 500. Never throws. Verified: 2 valid records returned while an
expired row, an unparseable row and a non-subscription key were all correctly skipped;
`limit=1 -> 1`, `limit=0 -> 0`, `limit=99999 -> 2`.

**`2053b69` - `src/lib/admin-data.ts`.** Derives `getAdminCustomers()` and `getAdminKpis()` from
the live store. **The governing rule: a metric this app cannot truthfully source is DECLARED
UNAVAILABLE, never rendered as a number and never as 0.** Four are declared with reasons -
`mrrUsd` ("plan prices live in Dodo; this app has no authoritative price list"), `creditsUsed`
("usage is metered in the engine database, not reachable from the web app"), `todaySpendUsd`,
`todayRevenueUsd`. **Hardcoding a price table here would have recreated the exact defect being
removed.** Verified: 3 records -> total 3, active 1, trials 1, newest-first ordering and bound
flags correct. TypeScript also caught a wrong premise in my own dossier mid-unit (I claimed a
record status could be `"trialing"`; that union has no such member) - one corrective pass now
counts trials from the plan field, the only honest signal.

**Why the UI rewire is PENDING and not half-done.** `customers-table.tsx` and
`customer-drawer.tsx` render `creditsUsed`, `creditsIncluded`, `mrrUsd`, `name` and `country`,
and `ADMIN_CUSTOMER_METADATA_FIELDS` (the privacy allowlist) names the same fields. **The live
store holds none of them.** Rewiring only the data source would put real and invented numbers
side by side on one screen - strictly worse than either. Finishing it needs a deliberate decision
about how those columns render when the value genuinely does not exist. Estimated **1-2 days**,
and it is the next thing to do.

**Not started: Blocker 3 (Dodo billing portal), Blocker 4 (multilingual crisis detection),
Blocker 5 (small items).** Nothing was begun and abandoned; they are untouched.

## Sellable vs pending

| | Status |
|---|---|
| **SELLABLE NOW** | Storefront, signup wizard, checkout to Dodo hosted payment, WhatsApp pairing, magic-link email, the assistant engine, admin **authentication** (TOTP/MFA/audit/RBAC), tenant isolation at schema + crypto level |
| **PENDING - blocks a confident sale** | Proven paid activation (needs 1a + the real-card test below) - engine tier propagation on upgrade (1c) - admin console **data** (UI rewire) - customer billing portal (Stripe-only today, Stripe is off) - promo codes (same cause) - multilingual crisis detection |

---

# OWNER ACTIONS - only you can do these

### A. Provision the billing push secret — ✅ DONE 2026-08-27 ~20:15. Set by owner via one-line SSH block; value fingerprint 7bb0f6e20444 identical on BOTH hosts (web /opt/mira-web/runtime.conf + engine /etc/mira/mira-whatsapp.env), both services restarted and active. Entitlement pushes are live. (Historic instructions kept below for reference.)

`MIRA_BILLING_PUSH_SECRET` must be the **same value on both hosts**.
`docs/provision_shared_secrets.sh` already exists for exactly this. Set it on:

- web: `89.167.49.209`, in the `mira-web` service environment, then `systemctl restart mira-web`
- engine: `23.88.59.31`, in the `mira-whatsapp` service environment, then `systemctl restart mira-whatsapp`

Confirm without printing the value:

    P=$(systemctl show mira-web -p MainPID --value)
    tr '\0' '\n' < /proc/$P/environ | cut -d= -f1 | grep MIRA_BILLING_PUSH_SECRET

A match on both hosts means entitlement pushes stop being silent no-ops.

### B. Schedule the reconciliation sweep (unblocks 1b)

`npm run reconcile` (`scripts/dodo-reconcile.mjs`) is tested and passing but nothing runs it.
Add a systemd timer beside the existing `mira-expiry.timer`, hourly or daily. Without it there is
no repair path when a webhook is missed.

### C. THE ONE REAL-CARD TEST - the single most valuable thing you can do

This converts the biggest remaining unknown into a known. **Do A first**, or the tier will not
propagate and the test will look like a failure when it is only a missing secret.

1. **Watch the logs** in two terminals before you start:
   - web: `ssh root@89.167.49.209 'journalctl -u mira-web -f'`
   - engine: `ssh root@23.88.59.31 'journalctl -u mira-whatsapp -f'`
2. **Note the baseline** so you can prove the change:
   `ssh root@23.88.59.31 "sudo -u postgres psql -d mira -c 'SELECT id, tier, status FROM tenants;'"`
3. **Buy**: open `https://mira.vualet.com/mira/start`, complete the wizard with a real email,
   choose **Companion**, and pay with a real card at the Dodo page.
4. **Expect within ~30 seconds** in the web log: `[dodo-webhook]` with a **200**, not a 400.
   A 400 with `bad_signature` means `DODO_WEBHOOK_SECRET` does not match the Dodo dashboard.
5. **Pair**: follow the welcome page to the QR and scan it with WhatsApp.
6. **Prove the tier flipped** - re-run the query from step 2. The tenant must now read
   `tier=companion, status=active`, **not** `trial`. This is the assertion that matters.
7. **Send one message** to the assistant on WhatsApp and confirm a reply.
8. **Refund** from the Dodo dashboard. Expect a `refund.succeeded` webhook, then re-run step 2:
   the tenant must be revoked. This proves the revoke path - the one that protects you from
   paying for a customer who charged back.
9. **Report back**: the webhook status codes, and `tier`/`status` before and after.

If step 6 still shows `trial`, that is finding **1c** (tier propagation), not a payment failure -
the money side worked and the engine was simply never told.

### D. Email / Resend

**Already verified this session - no action needed unless it regresses.** The sending domain
`vualet.com` is **verified** in Resend and mail genuinely sends: *"Your Mira sign-in link"*
**delivered** 2026-08-24. Only 5 emails have ever been sent, consistent with near-zero customers.
`send.vualet.com` sits `not_started` and is unused - delete it or verify it; it does no harm.

### E. Credential rotation (flagged, your call)

Earlier sessions exposed a Resend key and a tunnel bearer token in transcripts. Rotating both is
prudent hygiene; neither is known to be abused.

### F. Storefront trust items (hours, but you may prefer to own them)

- The sitemap advertises 16 URLs on `vualet.com`, which serves **Primaion**, a different product.
  11 of 12 probed apex paths 404 **including all four legal pages**. The pages are fine on
  `mira.vualet.com` - the sitemap simply names the wrong host.
- `mira.vualet.com` returns **two conflicting HSTS headers** (origin + Cloudflare).
- `/mira/signup` is a **waitlist** page still advertised in the sitemap; the live homepage
  correctly points at `/mira/start` instead.

---

## Merge command

Reviewed and green, but **not merged** - that call is yours:

    git checkout remediation/wa-pairing-entry && git merge --no-ff remediation/sales-blockers-2026-08-27

---

## Phase 2 continued - blockers 3 and 4 (2026-08-27)

### Blocker 3 - billing portal: DONE (`c53d31c`)

**Mostly already built, and the audit under-reported that.** Viewing the plan works through
`/api/auth/me` (Dodo-first entitlement, including `trialEndsAt`), and **cancellation already ran
on Dodo** via `/api/subscription/cancel` -> `cancelDodoSubscription()`, resolved from the verified
session email (anti-IDOR). The one genuine defect was the **error message**.

`/api/portal` opens a *Stripe* portal; Stripe is permanently off in production, so it always 503s
with a body carrying **no `message`**. The account page therefore fell back to *"Couldn't open
billing. Please try again."* - inviting a paying customer to retry forever something that can
never succeed. There is **no Dodo portal wired or documented anywhere in this repo**, so this is a
permanent state, not an outage, and inventing a Dodo portal endpoint would have fabricated an API
that 404s in production.

The 503 now carries truthful, actionable copy naming what *does* work (view plan, cancel from the
account page; contact support for plan changes or card updates). It deliberately names **no
payment provider, env var or "configuration"** - a customer does not care what is behind the
product, and naming it leaks vendor detail into customer-facing text.

**Still genuinely missing:** self-serve **plan change/upgrade**. Today that is a support action.

### Blocker 4 - multilingual crisis detection: **SKIPPED (author-timeout). THE SAFETY GAP REMAINS OPEN.**

This is the highest-priority outstanding item and it is **not** fixed. What was proved:

**The crisis gate fires on 1 of 8 real phrasings - English only.** Measured against the live
`crisisCheck`:

| Fires | Silent |
|---|---|
| English *"i want to die"* | Arabic, Urdu, Persian, Hindi (native script), **Roman Urdu**, **Arabizi**, Tagalog |

Root cause: one English regex in `apps/engine/src/safety.mjs` using ``, an **ASCII** word
boundary that cannot match Arabic or Devanagari script at all. Romanised forms - which dominate
real WhatsApp input in this market - had no patterns whatsoever.

A working fix was authored and **passed a 14-case probe 14/14** (including three near-miss safe
phrases correctly staying silent), then **reverted**, because it broke `language-lock.test.mjs`
D3 - a *characterisation* test that asserts the defect exists and says *"update this test"* once
the gate starts firing. That test also exposed the fix as **too literal**: it uses different
spellings (Hindi `हूँ` vs `हूं`; Persian spaced `می خواهم` vs joined `میخواهم`), so Arabic and Urdu
began firing while Hindi and Persian still missed. Two corrective passes to broaden the patterns
into phrase *families* both timed out at the author's 120s ceiling, exhausting the retry, so the
engine was reverted rather than left with a red suite.

**Engine repo is green and unchanged: 589 tests / 587 pass / 0 fail.** The work is preserved at
`scratchpad/blocker4-crisis.patch` (35 lines) - do not re-derive it.

**To finish it:** apply that patch; broaden `CRISIS_NATIVE` to verb-phrase families tolerating
optional whitespace in Persian/Urdu compound verbs and the Hindi final-vowel variants, plus the
standalone suicide nouns (`انتحار`, `خودکشی`, `आत्महत्या`); then update the obsolete D3 test.

**OWNER ITEM, and I will not do it myself:** the hotline string is US/UK-centric (`988`,
`116 123`) for a market where those numbers do not work. `findahelpline.com` is the only globally
usable line in it. **Adding regional emergency numbers is owner work because I must not fabricate
an emergency number** - a wrong one could cost a life.

**Blocker 5 (small items) not started.**
