# Release Dossier: Vualet / Mira

**Repository:** `vualet-web`
**Branch:** `fix/pursue-web-2026-09-06` (pushed to `origin`)
**Released commit:** `7ca8a72`
**Post-release commits on branch:** `4dbd789` (consent checkbox target size) is committed and **not yet deployed** at the time of writing.

**Identity:** One Next.js App Router codebase serving two hosts: `vualet.com` (corporate) and `mira.vualet.com` (the Mira sub-brand, selling three paid subscription tiers through Dodo Payments).

**Production:** `/opt/mira-web` on host `89.167.49.209`, systemd unit `mira-web`, Node 20, Next standalone on `127.0.0.1:3021` behind nginx and Cloudflare.

---

## Scope — what changed

1. **Support widget refund claim removed.** The widget on every public corporate page had a `POST /api/support` route answering any refund message with *"I've logged your request, and you'll see it back on your original payment method within 5-10 business days"* — a route with no database, no mail transport, and no payment call. Nothing was logged, no refund was initiated, no email was sent. It is now a signpost that claims nothing and names only real destinations.

2. **`npm test` existed for the first time.** 31 test files were on disk; only 19 were reachable by any script. Twelve were reachable by none, including the accessibility, support, tenancy-adversarial and payment-lifecycle suites. All are now reachable and passing.

3. **Marketing copy aligned to legal wording.** `/legal/terms` says Mira is *"designed not to fabricate"*; marketing asserted it as fact in eight places, including a stat rendering the figure `"0"` over `"invented facts, ever"`.

4. **New route `/mira/live`.** An honest preview of a feature that does not exist. Zero performance numbers on the page.

5. **Two `/mira/store` buttons** labelled "Notify me" that had no handler and no endpoint.

6. **Accessibility fixes:** contrast on a stamp component; Label in Name on the chat launcher; focus-visible rings restored on six inputs including the three on the payment form; a heading-order skip on `/products`; a contrast variant for the house indigo.

7. **Dependencies:** `qs` 6.15.3 → 6.16.0 and `browserslist` 4.28.2 → 4.28.9.

---

## Changed files

`git diff --stat dbe8ebd..7ca8a72` — **38 files changed, 432 insertions, 84 deletions** (excluding docs).

Added:
- `scripts/support-promises-test.mjs`
- `src/app/mira/live/page.tsx`

Modified, by area:
- **Support path:** `src/app/api/support/route.ts`, `src/components/cs-bot.tsx`
- **Copy/compliance:** `src/app/mira/page.tsx`, `src/app/mira/_components/WhatsAppStandin.tsx`, `src/app/mira/store/page.tsx`
- **Accessibility:** `src/app/mira/mira-theme.css`, `src/app/mira/_components/MiraBot.tsx`, `src/app/globals.css`, `src/app/products/page.tsx`, `src/app/mira/checkout/page.tsx`, `src/app/mira/start/page.tsx`, `src/app/contact/page.tsx`, `src/app/mira/vpn/_components/Connect.tsx`
- **Indigo contrast token, applied across the corporate surface:** `about`, `admin`, `admin-invite`, `admin-login`, `admin/team`, `blog`, `blog/[slug]`, `changelog`, `contact-sales`, `pricing`, `products`, `products/[slug]`, `security`, `security/journalists`, `signup`, plus `src/components/{footer,nav,site-chrome,admin/*}`
- **SEO:** `src/lib/seo.ts`
- **Dependencies:** `package.json`, `package-lock.json`

---

## Tests run

| Command | Result |
|---|---|
| `npm test` | 898 tests, 898 pass, 0 fail |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | exit 0 |
| `npm audit` | 0 vulnerabilities |

The suite includes counterfactual tests that check out OLD revisions with `git show` and require the same security assertions to FAIL against them — so a passing suite is evidence the tests still detect the defects they were written for.

A property-based guard, `scripts/support-promises-test.mjs`, asserts no support reply on any of 11 inputs may claim a completed or automatic action, or name a path the app does not serve. Proven by counterfactual: restore the old route and the guard exits 1; against the new one it exits 0.

> **Trap for anyone running this suite on the build pod:** it FAILS there, and those failures are not real. The counterfactual tests extract old revisions with `git show 4ed719e / f889ee5 / 1ade97d`; the pod's clone has no such history. A pod job had already begun "fixing" them, which would have meant weakening working security tests.

---

## Runtime proof (measured against the LIVE hosts)

**Public routes:** `mira.vualet.com` — 10 public routes returned 200. `vualet.com` — 200. `www` — 301.

**Payment path gating:**
- `POST /api/portal` → 401
- `POST /api/checkout` → 400 on an empty body
- `GET /api/connect` → 400 without a token
- `GET /mira/checkout` → 200

**The defect itself, before and after, captured by curl against the public host:**

Before:
> I've logged your request, and you'll see it back on your original payment method within 5–10 business days.

After:
> I can't process a refund myself. Sign in and use the Request a refund button at /mira/account — a person reviews every request.

---

## Security review

**Headers live on both hosts:**
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- A scoped `Permissions-Policy`
- `Cross-Origin-Opener-Policy: same-origin`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`, injected by Cloudflare (deliberately not duplicated at the origin)

**THE CSP IS REPORT-ONLY AND ENFORCES NOTHING.** This is the single most important line in this section, and it predates this release rather than being caused by it. A judge ruled against switching it to enforcing here, because there is zero visibility into what would break on the checkout page, and Next's App Router emits inline hydration scripts that `script-src 'self'` blocks without a nonce — so enforcing blind could break hydration on every page, not just analytics. The agreed path: add a report endpoint, collect 48–72 hours of real violations including a full checkout walkthrough, then enforce.

**Source scan:** No raw secrets in tracked source (regex sweep for private-key and API-key shapes returned nothing).

**Suite coverage:** tenant isolation (`tenancy-adversarial`), rate limiting (`revenue-begin-ratelimit`), and an anti-IDOR portal test.

**NOT MEASURED:** penetration testing, dependency provenance / supply-chain review, and authenticated-session testing against the live host.

---

## Accessibility review

**Lighthouse against the LIVE site:**

| Route | Score |
|---|---|
| `mira.vualet.com/mira` | 100 (desktop and mobile) |
| `/mira/live` | 100 |
| `/mira/plans` | 100 |
| `/mira/checkout` | 100 |
| `vualet.com` | 100 |
| `vualet.com/pricing` | 100 |
| `vualet.com/products` | 100 (98 before the heading fix) |
| `vualet.com/about`, `/security` | 100 |

**Keyboard:** no positive `tabIndex` anywhere; focus order begins at the skip link; every control on `/mira`, `/mira/start` and `/mira/checkout` shows a focus indicator. Focus-ring contrast meets 1.4.11 on every surface it lands on — 4.03 cream, 4.28 canvas, 3.75 frost, 4.47 white — against a 3:1 bar.

**Accessible names:** all 84 interactive controls have accessible names, verified by an independent element-by-element sweep rather than by a passing suite. This matters because a previous suite in this repo reported 3/3 passing while seven controls had none.

**Mobile at a 320px emulated viewport:** no horizontal overflow on `/mira` or `/mira/checkout`; nothing renders wider than the viewport.

**Reduced motion:** honoured — `globals.css` carries a `prefers-reduced-motion` block.

**Target size (2.5.8):** the two consent checkboxes on the payment page rendered 20×20 and are raised to 24×24 in `4dbd789`, which is **committed and not yet deployed**. Lighthouse does not check 2.5.8, which is why this survived four clean audits.

**NOT MEASURED:** screen-reader testing with an actual screen reader; cross-browser testing beyond Chrome; dark mode (the corporate stylesheet has some `prefers-color-scheme` rules, the Mira theme has none).

---

## Migration plan

**There are no database migrations in this release.** The in-tree data files (`web-store.json`, `mira-state.db`) are carried forward by the deploy process via rsync; no schema change was required.

---

## Performance

Traced against the live hosts.

| Route | LCP | CLS | TTFB |
|---|---|---|---|
| `mira.vualet.com/mira` | 433 ms | 0.00 | 213 ms |
| `vualet.com` | 305 ms | 0.00 | 198 ms |

Every Lighthouse insight reported estimated savings of **FCP 0 ms and LCP 0 ms** — there is no measurable time to reclaim. The only flagged waste is 24.9 kB of legacy JavaScript with zero time impact, and 10.5 kB of that is Cloudflare's own injected analytics beacon.

---

## Config changes

**Dependency updates only:** `qs` 6.15.3 → 6.16.0, `browserslist` 4.28.2 → 4.28.9. Because the dependency tree changed, that one deploy required a real `npm ci` on the host rather than the usual copy-and-rebuild.

No nginx, Cloudflare, systemd or environment-variable changes were made in this release.

---

## Rollback

**One command:** `/opt/mira-web-ROLLBACK.sh`. It stops the service, rsyncs in-tree data forward, renames the previous tree back, restarts, and probes. The previous tree is retained on disk.

Deploys are a directory swap; **eight** were performed on the day of release, each causing about **six seconds** of downtime.

**Caveat that must not be lost:** `/opt/mira-web/data` is IN-TREE (`web-store.json`, `mira-state.db`), so a rollback also reverts data written since the deploy. `/opt/mira-web-data` (waitlist, veridian-mem) sits outside the tree and is unaffected.

---

## Deploy method, and its trap

Deploys copy the LIVE tree with `cp -a`, extract `git archive HEAD` over the copy, build **on the host** with Node 20, boot the artifact on `127.0.0.1:3005` as a transient systemd unit and probe it **before** any swap, then stop → rsync → rename → start.

> **`/opt/mira-web/server.js` is generated build output and does NOT exist in the repository.** A from-scratch clone-and-build produces no entrypoint and the service will not start. Never rebuild from a bare clone. The copy that was running had been generated on Windows — its embedded config carried `C:\vualet-web` paths — which is why builds now happen on the host.

---

## Known limitations

- **CSP is report-only.** Enforcement deferred pending real violation data.
- **Cloudflare injects an analytics beacon** that the report-only policy notes but does not block. Disabling it is a Cloudflare dashboard action and is cosmetic.
- **Six LOW/MEDIUM copy findings** are brand taste rather than compliance and were deliberately left.
- **The contrast variant `--color-vualet-indigo-ink` `#4F52D6`** was introduced rather than changing the house indigo `#6366F1`, which is annotated "unchanged" in the theme. Open to brand veto; it is one token.

---

## Owner holds

None blocked this release. Two standing items are the owner's alone: whether to disable Cloudflare Web Analytics, and whether to accept or re-tune the indigo contrast variant.

---

## Post-deploy smoke test

1. Ten public routes on `mira.vualet.com` — expect 200 on each.
2. `vualet.com` — expect 200; `www` — expect 301.
3. Payment-path probes: `POST /api/portal` → 401; `POST /api/checkout` (empty body) → 400; `GET /api/connect` (no token) → 400; `GET /mira/checkout` → 200.
4. `POST /api/support` with a refund message — assert the reply contains neither `"business days"` nor `"I've logged"`.

---

## Support notes

- Deploys are a directory swap on `/opt/mira-web`; rollback is `/opt/mira-web-ROLLBACK.sh`.
- The transient verification unit boots on `127.0.0.1:3005` before any swap.
- `/opt/mira-web-data` holds waitlist and veridian-mem data and is **not** affected by rollback.
- `npm ls` and `npm audit` report the lockfile, not the installed tree. To know what is actually running, read `node_modules/<pkg>/package.json`.

---

## Verdict

| Label | Verdict |
|---|---|
| **READY FOR LOCAL:** | Yes — 898/898 tests, build 0, tsc 0, npm audit clean. |
| **READY FOR STAGING:** | Yes — no migrations, no config changes beyond two dependency bumps. |
| **READY FOR PRODUCTION:** | Yes — already deployed at `7ca8a72`; runtime probes pass and the defect is verified fixed against the public host. |
| **WORLD-CLASS CANDIDATE:** | **No.** The CSP enforces nothing, and no screen-reader or cross-browser testing has been done. It becomes one when the CSP is enforced on the strength of real violation data, a screen reader has actually been driven through the checkout, and the site has been verified outside Chrome. |
| **BLOCKERS:** | **None for this release.** Nothing shipped here made anything worse, and every gate passed. The CSP gap is a standing limitation that predates it. |
| **UNTESTED AREAS:** | Screen-reader testing; cross-browser beyond Chrome; dark mode on the Mira theme; penetration testing; dependency provenance; authenticated-session testing against the live host. |
| **NEXT SAFE ACTION:** | Deploy `4dbd789` (checkbox target size), then land the CSP report endpoint and collect 48–72 hours of real violations including a full checkout walkthrough before enforcing. |
