# RELEASE DOSSIER — mira.vualet.com preflight-worldclass-release

**Date:** 2026-07-17
**Product:** Mira — commercial AI-assistant storefront (a Vualet product)
**Standard applied:** ISO/IEC 25010 · WCAG 2.2 AA · OWASP ASVS L1/L2 · NIST SSDF
**Reviewer of record:** the jury (3 OpenRouter jurors + frontier judge), verdict #33

---

## Commit / version
- **Deployed HEAD:** `46ad8a0` — *a11y+brand: WCAG 2.2 AA fixes for mira.vualet.com*
- `e63c946` — *sec: constant-time admin compare, poweredByHeader off + security headers, input validation*
- `95cd047` — *fix(brand): suppress Vualet corporate chrome on the mira.* host (kills double-nav)* (predecessor, already live)
- Live marker on box: `/opt/mira-web/DEPLOYED_COMMIT` = `46ad8a0a59b27387b1f6fc752ac2cc5b56e22f98`

## Scope
Take the already-live `mira.vualet.com` (Hetzner VPS `89.167.49.209`, nginx → node standalone `127.0.0.1:3021`, Cloudflare DNS in front) through the owner's preflight standard: fix the audited security + accessibility defects, run the changes past the jury, deploy, and verify end-to-end. **No Vercel** — Cloudflare + VPS per owner override.

## Changed files (12)
| File | Change |
|---|---|
| `src/middleware.ts` | Constant-time `timingSafeEqual` for the `/admin` HMAC (was `===` short-circuit) |
| `next.config.ts` | `poweredByHeader:false` + defense-in-depth security headers (no CSP by design) |
| `src/app/api/waitlist/route.ts` | Email regex + field length caps before store write |
| `src/app/api/begin/route.ts` | Input length caps |
| `src/app/mira/mira-theme.css` | CTA gradient + soft-btn text darkened to ≥4.5:1 (worst 5.21:1); reduced-motion aura; `:focus-visible` rings |
| `src/app/mira/_components/MiraNav.tsx` | Real 320px reflow (CSS classes + `@media(max-width:420px)`) |
| `src/app/mira/page.tsx` | Byline contrast → 8:1; `min-width:0` overflow safety net |
| `src/app/mira/plans/page.tsx` | Grid overflow safety net |
| `src/app/legal/_components/legal-page.tsx` | Removed internal "template, have counsel review" banner |
| `src/app/legal/layout.tsx` | Host-gated `MiraNav` on legal pages (mira.* host had no nav before) |
| `src/app/legal/legal.module.css` | Muted-token contrast fix; dead `.banner` rule removed |
| `src/app/not-found.tsx` (new) | Branded 404 |

## Tests run
- `npx tsc --noEmit` — **clean** (both fix agents, before + after).
- `npm run build` — **exit 0**, all routes compiled.
- **320px reflow** — verified numerically via Chrome DevTools Protocol `Emulation.setDeviceMetricsOverride` (the `--headless --window-size=320` path silently floors at ~500px and was discarded): `scrollWidth == clientWidth == 320` on `/mira`, `/mira/plans`, `/legal/terms`.
- **Contrast** — relative-luminance computed: CTA gradient worst point 5.21:1, soft-btn 12.43:1, bylines 8.07:1, all ≥ 4.5:1.
- **Jury review** — verdict **#33 `FIX_ITEMS_FIRST`** (0.883, majority + judge_ratified). Frontier judge cleared the code (timingSafeEqual edge-compatible, headers non-conflicting, 420px Account-hide a valid responsive pattern) and isolated one real item: the legal-banner removal → routed to the owner/payments gate below.

## Runtime proof (post-deploy, through the public path)
- Routes: `/` 200 · `/legal/terms` 200 · `/legal/privacy` 200 · `/mira/plans` 200 · `/mira/account` 200 · `/vpn` 200 · `/mira-att/` 200 · unknown path → **404 branded**.
- Response headers on `/`: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin` present; **`X-Powered-By` absent**.
- Served CSS chunk carries the darkened gradient (`#B54A45`), `prefers-reduced-motion` block, `max-width:420px` reflow, `:focus-visible` — confirms the a11y build shipped (not stale cache).
- Legal page renders the Mira nav (host-gated) and **no template banner**.

## Security review (OWASP ASVS L1/L2)
- `/admin` gated server-side in middleware; constant-time signature compare (no timing oracle).
- Input validation on `waitlist` + `begin` (regex + length caps).
- No `X-Powered-By` leak; HSTS/nosniff/X-Frame/Referrer set at both app and nginx.
- `/api/` rate-limited at nginx (`limit_req zone=miraapi`); app runs **non-root** (`User=mira-web`).
- `MIRA_TOKEN_SECRET`/`MIRA_BIND_SECRET` on box in `0600 runtime.conf`, owned by `mira-web`; connect-token secret hard-fails in prod if unset.
- **Not covered / owner:** no CSP yet (deliberate — needs report-only rollout + its own audit); Cloudflare proxy (orange-cloud) not yet enabled so origin IP is still exposed.

## Accessibility review (WCAG 2.2 AA)
Contrast (1.4.3) ✔ · reflow to 320px (1.4.10) ✔ · reduced motion (2.2.2) ✔ · visible focus (2.4.7) ✔ · branded error page ✔ · consistent nav across legal + mira ✔.

## Migration / config changes
- Swap-deploy: bundle staged in `/opt/mira-web-new`, `runtime.conf` copied forward (secrets preserved), atomic `mv` swap, `systemctl restart mira-web`. Old tree kept at `/opt/mira-web-old`.
- nginx unchanged this release (exact-match `location = /` → `:3021/mira`, security headers, rate-limit zone all already in place from the prior hardening pass).

## Rollback
1. **App:** `mv /opt/mira-web /opt/mira-web-bad && mv /opt/mira-web-old /opt/mira-web && systemctl restart mira-web` (old tree still present).
2. **Bundle backup:** `/opt/mira-web.bak-46ad8a0.tgz` (4.6 MB).
3. **Brand-level:** old `primaion-web` container still on `:3020`; flip nginx `/`→`:3020` to revert the whole storefront.

## Known limitations
- **Duplicate security headers** — HSTS/nosniff/X-Frame emitted by both the app and nginx (two HSTS values). Jury-cleared as harmless (no conflicting directives; browser honors first). Cosmetic; dedupe to nginx-only in a later pass.
- Residual `#F8A5A0` in the decorative ambient aura (no text overlays it; reduced-motion gated) — not a contrast surface.
- No CSP yet.

## Owner holds (must clear before taking money)
1. **⛔ BLOCKING (jury #33): counsel must review the legal pages** (`/legal/terms`, `/legal/privacy`, `/legal/refund`, `/legal/ai-disclosure`) — currently unreviewed template text. Selling on it is real legal exposure. **Gate: do not install Dodo keys / enable payments until counsel signs off.** Recorded as an open requirement in the ledger.
2. **Dodo Payments keys + Upstash KV creds** — via radioactive-file handoff → into `/opt/mira-web/runtime.conf` → restart. Until then `/api/checkout` + durable connect tokens are inert.
3. **Cloudflare orange-cloud proxy** for `mira.vualet.com` + firewall origin to Cloudflare ranges (owner toggle).

## Post-deploy smoke test (re-runnable)
```
for u in / /legal/terms /mira/plans /mira/account /vpn /mira-att/; do
  curl -s -o /dev/null -w "%{http_code}  $u\n" https://mira.vualet.com$u; done
curl -sI https://mira.vualet.com/ | grep -iE "strict-transport|x-powered-by"
```

## Support notes
- Service: `systemctl status|restart mira-web` (WorkingDirectory `/opt/mira-web`, `User=mira-web`, `EnvironmentFile=runtime.conf`).
- Logs: `journalctl -u mira-web -f`.
- Rollback + backups: see above; do not delete `/opt/mira-web-old` or `mira-web.bak-46ad8a0.tgz` until the release is soaked.

---

## FINAL VERDICT
- **READY FOR LOCAL:** ✅
- **READY FOR STAGING:** ✅
- **READY FOR PRODUCTION:** ✅ *deployed and verified live at `https://mira.vualet.com` (commit 46ad8a0). The site is up, secure, accessible, and no payment path is open.*
- **WORLD-CLASS CANDIDATE:** ⚠️ once the three owner holds clear (counsel-reviewed legal, payment keys, Cloudflare proxy) + CSP + header dedupe.
- **BLOCKERS (to take money, not to run):** counsel legal review (jury #33); Dodo/Upstash keys; Cloudflare proxy.
- **UNTESTED AREAS:** live checkout → Dodo hosted page (keys not installed); durable connect tokens under Upstash (creds not installed).
- **NEXT SAFE ACTION:** owner delivers Dodo + Upstash creds (radioactive file) and confirms counsel review; then install → restart → verify checkout reaches Dodo. Enable Cloudflare orange-cloud + origin firewall.
