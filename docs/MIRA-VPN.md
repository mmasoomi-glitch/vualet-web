# Mira VPN — product spec

One of the products in the Mira suite. Lives at:

- **Page**: `mira.vualet.com/mira-vpn` (and `vualet.com/mira-vpn` while we're
  pre-rewrite)
- **Catalog entry**: `src/lib/products.ts` slug `mira-vpn`
- **App ID (Android)**: `com.vualet.mira`
- **App ID (iOS)**: TBD on Apple Developer enrollment

## Tiers

| | Free | Paid |
|---|---|---|
| Price | $0 | $9.99 / mo (catalog rounded to $9) |
| Speed | 500 kbps per source IP | 5 Mbps per source IP |
| Session | 2-hour reconnect | unlimited |
| Monthly cap | n/a (speed-capped) | 50 GB |
| Devices | 1 | 3 |
| Ads | yes (AdMob) | no |
| Server pick | nearest | smart routing |
| Banking-friendly Pause | yes | yes |

The free tier is real product, not a trial — enough for WhatsApp messaging
and light browsing. Paid kicks in when the user wants Instagram quality or
needs longer sessions.

## Billing paths

| Path | App | Why |
|---|---|---|
| **Google Play Billing** | Play Store APK only | Google requires it for in-app subscriptions; pass-through 30% cut |
| **Dodo Payments (card)** | Web / sideload APK | Already wired in this repo (`/api/checkout`, `/api/webhooks/dodo`). Reuse |
| **NowPayments (USDT-TRC20, BTC, etc.)** | Web / sideload APK | New — for regions where cards don't work. See `/api/webhooks/nowpayments` |

The web checkout at `/mira-vpn/checkout` offers both card (Dodo) and crypto
(NowPayments). The Play APK only links to Play Billing. The sideload APK
links to `/mira-vpn/checkout`.

## Auth + delivery

Successful payment (any path) issues a **permit** — the same HMAC scheme
used in the Uncle Z Calc project (see `calc-proxy/calc/app/.../Permit.kt`).
Permit is a 13-char base32 string, valid for 30 days. Delivered by email
or shown on the success page.

Permits are minted and validated by the **Mira VPN backend** (a separate
Hetzner box, provisioned outside this repo). This repo only:

1. Confirms payment via webhook
2. Calls the backend's `POST /internal/issue-permit` endpoint with an
   internal shared secret (`MIRA_INTERNAL_SHARED_SECRET`)
3. Emails the returned permit to the buyer

The backend handles UUID assignment, x-ui DB writes, and bandwidth-cap
enforcement.

## Environment variables

| Var | Where | Purpose |
|---|---|---|
| `NOWPAYMENTS_API_KEY` | Vercel / hosting env | Create invoices |
| `NOWPAYMENTS_IPN_SECRET` | Vercel / hosting env | Verify webhook signatures |
| `MIRA_VPN_BACKEND_URL` | Vercel / hosting env | Where to call for permit issuance |
| `MIRA_INTERNAL_SHARED_SECRET` | Both Vercel + Mira VPN backend | Authenticates the internal handoff |
| `DODO_*` | Existing | Already in repo for card path |

## Files added in this PR

- `src/lib/products.ts` — `mira-vpn` catalog entry (one block append)
- `src/app/mira-vpn/layout.tsx` — Mira-themed layout (Fraunces, mira-theme.css)
- `src/app/mira-vpn/page.tsx` — landing + tiers + banking-pause callout
- `src/app/mira-vpn/get/page.tsx` — download page (Play link + sideload link)
- `src/app/mira-vpn/checkout/page.tsx` — card-or-crypto picker form
- `src/app/mira-vpn/checkout/success/page.tsx` — post-payment "code is on its way" page
- `src/app/api/vpn/checkout/card/route.ts` — Dodo Payments checkout creator
- `src/app/api/vpn/checkout/crypto/route.ts` — NowPayments invoice creator
- `src/app/api/webhooks/nowpayments/route.ts` — NowPayments IPN receiver

## Files explicitly NOT touched

- `CLAUDE.md` — owned by `chore/governance-and-claude-md` session; do not edit until that merges
- `CONTRIBUTING.md` — same
- `docs/BRAND.md`, `docs/CLOUD_AGENT_BRIEF.md`, `docs/CUTOVER.md`, `docs/MIRA.md`, `docs/USER_TODO.md`, `.githooks/*` — same
- Any file under `src/app/mira/*` — that's the existing personal-assistant product, separate work stream
- `src/app/api/checkout/route.ts` — already exists, we delegate to it

## Future-state K8s scaling

A Kubernetes-based autoscale proposal exists for when Mira VPN reaches
~5,000 concurrent users. Saved at `docs/FUTURE-K8S-SCALING.md` (separate
doc, not in this PR). Not for now — the current Hetzner CCX23 → AX42
ladder handles 1,000+ active users at ~€54/mo without K8s.
