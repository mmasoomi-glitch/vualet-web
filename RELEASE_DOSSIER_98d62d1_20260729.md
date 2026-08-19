# RELEASE DOSSIER — mira.vualet.com (vualet-web) — preflight 2026-07-29

**Preflight world-class release audit** — evidence-gated, read-only.
*(Does not supersede the historical `RELEASE_DOSSIER.md` for 46ad8a0 dated 2026-07-17; this covers branch `remediate/code-wash` @ 98d62d1.)*

| Field | Value |
|---|---|
| Repo / dir | `C:\vualet-web` |
| Branch | `remediate/code-wash` |
| Commit | `98d62d1946846155dc4d81a449ea29691197eb61` (VERIFIED, unchanged by this audit) |
| Pushed? | **NO** — no upstream configured |
| Audit date | 2026-07-29 |
| Toolchain | Node v25.9.0, npm 11.12.1, Next 16.2.6, React 19.2.4, Stripe 17, TypeScript 5 |
| Standard | ISO 25010 / WCAG 2.2 AA / OWASP ASVS L1-L2 / NIST SSDF |

---

## Scope

Pre-launch code-wash of the Mira/Vualet Next.js site: brand recolor + WCAG a11y + report-only CSP
(98d62d1), Telegram-legal connect tokens (19130db), fail-safe PAYMENTS_LIVE gate (245b3b9),
entitlement/tier/$0-checkout fixes (jury #67/#68), server-validated promo box. Deploy stays owner-held.

## Tests run — 32/32 PASS (VERIFIED, `npm run test:*`)

| Suite | Result |
|---|---|
| test:privacy | 4/4 — metadata allowlist has zero content fields; no admin route imports content store |
| test:audit | 6/6 — WORM append-only log; chain-break on UPDATE/DELETE detected; no mutation API |
| test:promo | 10/10 — expired/empty coupon rejected pre-Stripe; pure discount math |
| test:tier | 5/5 — price→plan round-trips; unknown price → null (never a guessed plan) |
| test:zero | 7/7 — $0 checkout activates from metadata.plan; idempotent on duplicate event.id |

## Build & typecheck — PASS (VERIFIED)

- `npx tsc --noEmit` → **exit 0** (clean). *Closes prior ledger blocker "compile UNKNOWN" (state#25).*
- `npx next build` → **exit 0**. Standalone output; 40+ routes compiled incl `/mira/*`,
  `/api/checkout`, `/api/webhooks/stripe`, `/api/connect`, legal pages, `/robots.txt`.

## Security review

| Check | Result |
|---|---|
| Secret scan (tracked) | **PASS** — only `sk_live_xxx` placeholder in a test; no real keys |
| `runtime.conf` / `.env` tracked? | **PASS** — untracked; `.env*` gitignored; only `.env.example` tracked |
| Security headers (next.config.ts) | **PASS** — HSTS preload, nosniff, X-Frame DENY, Referrer-Policy, Permissions-Policy (mic=self for voice), COOP same-origin |
| CSP | **REPORT-ONLY** by design (jury #83); `style-src` keeps `'unsafe-inline'` until inline-style refactor |
| Payments gate | **PASS (fail-safe)** — `paymentsConfigured()` = `STRIPE_SECRET_KEY` AND `PAYMENTS_LIVE==="1"`; else `not_configured`/503 |
| Connect-token auth | **PARTIAL** — sensitive claim is POST-body + `x-mira-bind-secret`, single-use HMAC, foreign→409. GET welcome link still carries token in URL but returns display-only (no persona). See L1. |
| Admin routes | `requireAdmin()` per route + middleware; `MIRA_TOKEN_SECRET` hard-fails in prod |
| Live prod headers (curl) | 200; HSTS + nosniff + X-Frame + Referrer present (now behind `Server: cloudflare`) |

### Dependency audit — 6 HIGH (`npm audit`)
- `postcss <=8.5.17` (XSS, path traversal via sourceMappingURL) — transitive
- `sharp <0.35.0` (libvips CVEs) — transitive
- Fix requires `next@16.2.12` (minor bump, outside stated 16.2.6). **Owner disposition needed.**

## UI / a11y
- Mira "Notary" indigo/amber recolor + WCAG contrast fixes (98d62d1); MiraBot dialog focus-trap/aria-modal/Esc (jury #85).
- **Not browser-re-verified this session** — no axe/screen-reader/responsive drive. Needs owner Stripe test keys + visual pass (jury #81).

## Lint — FAIL (non-blocking): 7 errors, 10 warnings (`npx eslint .`)
| Rule | Count |
|---|---|
| @next/next/no-img-element | 8 |
| react-hooks/set-state-in-effect | 4 |
| @typescript-eslint/no-unused-vars | 2 |
| react-hooks/immutability | 2 |
| react/no-unescaped-entities | 1 |

Concentrated in `src/app/mira/page.tsx` (7 of 17). One hit is in untracked `.preview/` scratch. None block compile/runtime.

## Config / rollback
- `runtime.conf` (28 keys) on-box at `/opt/mira-web/runtime.conf`, preserved across swap deploys.
- Rollback: `/opt/mira-web-prev` + `/opt/backups/mira-web-KNOWNGOOD-*.tgz`.
- **GAP:** live `/opt/mira-web` is NOT git and has NO `DEPLOYED_COMMIT` marker (only `BUILD_ID uEsZLMn6qBbPzSMVygrvL`). The 2026-07-17 dossier's `DEPLOYED_COMMIT=46ad8a0` marker is GONE — a later deploy overwrote the tree without re-stamping. Deployed commit not recoverable from box. Any deploy MUST stamp its SHA to box + ledger.

## Known limitations
- **L1** — welcome-link connect token in URL query (history/referrer). Mitigated: HMAC-signed, single-use, display-only GET.
- **L2** — CSP report-only, not enforcing (by design).
- **L3** — 6 high transitive dep vulns pending Next minor bump.

## Owner holds
1. Production DEPLOY authorization (+ jury deploy sign-off).
2. Stripe **test** keys for behavioral/visual verification (jury #81).
3. Dependency-bump disposition (next@16.2.12).

## Post-deploy smoke test (defined)
`curl`: `/`, `/mira/plans`, `/legal/*`, `/mira/account` = 200; `POST /api/checkout` = `not_configured`/503 while `PAYMENTS_LIVE`≠1; headers present; branded 404; then record `DEPLOYED_COMMIT` on box + ledger.

---

## FINAL VERDICT

```
READY FOR LOCAL:        YES — build+typecheck exit 0, 32/32 tests pass, secrets clean
READY FOR STAGING:      YES (conditional) — needs owner Stripe test keys for behavioral/visual pass
READY FOR PRODUCTION:   NO — open: deploy auth, dep-vuln disposition, browser a11y verify,
                        branch unpushed, no DEPLOYED_COMMIT stamping on the box
WORLD-CLASS CANDIDATE:  APPROACHING — clear once L1-L3 + lint + a11y browser proof + dep bump close
BLOCKERS (production):  (1) owner deploy authorization  (2) 6 high dep vulns undisposed
                        (3) branch not pushed  (4) no commit-SHA stamping on /opt/mira-web
UNTESTED AREAS:         browser a11y (axe/screen-reader), responsive 320px/tablet/desktop, dark/light,
                        live Stripe test-mode checkout, runtime drive of connect/claim flow
NEXT SAFE ACTION:       push branch; fix the 7 lint errors (mira/page.tsx cluster); get owner Stripe
                        test keys → drive behavioral+visual pass on local staging. Deploy owner-attended.
```

*Read-only from C:\vualet-web. HEAD 98d62d1 unchanged. Evidence: `scratchpad/preflight/{tests,tsc,build,lint,audit}.txt`.*
