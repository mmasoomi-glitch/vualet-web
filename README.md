# vualet-web

Marketing storefront and subscription dashboard for [Vualet](https://vualet.com) — software that runs your business for you.

## Stack

- **Framework:** Next.js 16 (App Router, Turbopack) + React 19
- **Styling:** Tailwind v4 (CSS-first theme)
- **Type system:** TypeScript 5
- **Fonts:** IBM Plex Sans (display) + Inter (body) via `next/font/google`
- **Auth:** Clerk *(wiring in next phase)*
- **Billing:** Paddle Billing (Merchant of Record) *(wiring in next phase)*
- **DB:** Postgres via Supabase *(wiring in next phase)*
- **Email:** Resend transactional + Loops lifecycle *(wiring in next phase)*
- **Analytics:** PostHog (product) + Plausible (marketing) *(wiring in next phase)*
- **Docs:** Mintlify at `docs.vualet.com` *(wiring in next phase)*

## Hosting

Self-hosted on a Hetzner CPX32 (`afaq-commerce-01`, Helsinki, `89.167.49.209`) behind Caddy 2 in a Docker Compose stack. Cloudflare in front for DNS, free SSL, DDoS protection, and CDN.

## Local development

```bash
npm install
npm run dev
# http://localhost:3000
```

## Production build

```bash
npm run build
npm run start
```

## Container build

```bash
docker build -t vualet-web .
docker run --rm -p 3000:3000 vualet-web
```

## Deployment

`deploy/docker-compose.yml` runs the web container behind Caddy with auto-HTTPS for `vualet.com` and `www.vualet.com`. CI in `.github/workflows/deploy.yml` builds the image, pushes to GHCR, and pulls + restarts on the server on every push to `main`.

Required GitHub Actions secrets:

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | `89.167.49.209` |
| `DEPLOY_USER` | `root` (or a dedicated `deploy` user) |
| `DEPLOY_SSH_KEY` | Private key matching a public key in `~/.ssh/authorized_keys` on the server |
| `GHCR_USER` | `mmasoomi-glitch` |
| `GHCR_TOKEN` | A PAT with `read:packages` |

## Brand tokens

| Token | Value | Use |
|---|---|---|
| `--color-vualet-indigo` | `#5B5BF6` | Primary, CTAs, links |
| `--color-vualet-ink` | `#0F1117` | Dark surfaces |
| `--color-vualet-lime` | `#C7F25A` | Highlight, "new" badges |
| Display font | IBM Plex Sans | Headings, wordmark, logo glyphs |
| Body font | Inter | Everything else |

Logo system: parent **V** in iOS-style squircle, indigo fill, white glyph. Each sub-product reuses the same squircle with its own letter (C = CRM, H = Hub, W = WhatsApp, I = Inbox, Q = Quotes, P = Performance). See `src/components/logo.tsx`.

## Operated by

Afaq Alnaseem Trading LLC, Dubai, UAE · TRN 100475523500003
