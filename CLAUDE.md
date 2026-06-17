# CLAUDE.md — vualet-web

Authoritative guidance for **developers and AI agents** working in this repo.
When this file and the older `README.md` / `docs/*` disagree, **this file and the
code win** — the legacy docs describe a stack that was never built (see below).

---

## 1. What this is

`vualet-web` is the Next.js 16 (App Router, React 19, Tailwind v4, TypeScript)
web frontend for the **Vualet / Mira** business. One codebase, shared design
system, serving two domains:

- **vualet.com** — the general / corporate site (company info, brand, general
  pages). Same CSS and design tokens as the storefront.
- **mira.vualet.com** — the **Mira product suite storefront**: a front page that
  presents the suite, with individual SaaS apps sold under **paths**
  (e.g. `mira.vualet.com/veridian`, `mira.vualet.com/<app>`).

Both are served with the shared design system (`src/app/globals.css` `@theme`
tokens + the squircle logo system in `src/components/logo.tsx`). Self-hosted on
**Hetzner** behind **Caddy** (auto-HTTPS) with **Cloudflare** in front.

> **mira.vualet.com is the SUITE STOREFRONT** (decided). The legacy in-repo
> `/mira` personal-assistant product is being moved to its own slug
> (e.g. `/mira-assistant`); do not assume `mira.vualet.com` == that one product.

---

## 2. Ground truth (actual stack — not the legacy docs)

| Concern | Reality (in code) | Legacy docs wrongly say |
|---|---|---|
| Payments | **Dodo Payments** (Merchant of Record) + Standard Webhooks | Paddle |
| Auth | **NOT YET IMPLEMENTED** — admin is an insecure client stub | Clerk |
| Storage | **Upstash Redis KV** (`src/lib/store.ts`), in-memory dev fallback | Supabase Postgres |
| Hosting | Self-hosted **Hetzner + Caddy + Cloudflare** | Vercel (`next.config.ts` comment is stale) |

Files referenced by the old README (`Dockerfile`, `deploy/`, `.github/workflows/`)
**do not exist yet** — add them as part of the deploy work, don't assume them.

---

## 3. Architecture rules

- **Product catalog is the single source of truth:** `src/lib/products.ts`.
  Nav and footer must **derive** product lists from it — do not hard-code product
  lists in multiple files (they have already drifted).
- **External SaaS apps** (e.g. Veridian — a FastAPI/Docker app) are **not** rebuilt
  in Next.js. They are reverse-proxied at the **edge (Caddy)** under their path:
  `mira.vualet.com/veridian/*` → the Veridian container. The external app runs
  with `root_path=/veridian` so its assets/links stay under the prefix.
  **Do NOT** proxy a full external app through Next.js `rewrites` — it breaks
  WebSockets and couples the storefront's uptime to the app.
- Represent an external app in `products.ts` with `kind: "external"` +
  `externalUrl` so its card launches the app instead of `/signup`.
- **Design system:** use the `@theme` tokens in `globals.css` and the squircle
  logo system. Do not introduce new fonts (IBM Plex Sans display + Inter body).
- **Secrets:** environment variables only. Never commit `.env*`. Keep the
  `.gitignore` / `.dockerignore` exclusions intact.

---

## 4. Security must-knows (do not regress)

- The Dodo **webhook signature IS verified against the raw body** — keep it that
  way; never trust an unverified payload.
- `/admin` currently has **no server-side auth** (client-side `localStorage` gate
  only — the files say so). Add server-side auth (signed httpOnly session checked
  in middleware / a server component) **before** wiring any real data.
- `/api/portal` and `/api/connect` must derive the customer from a **trusted
  session**, never from client input (current IDOR).
- Add rate limiting to public endpoints (`/api/waitlist`, `/api/support`).

---

## 5. Git workflow (MANDATORY for humans and AI)

Two long-lived, **protected** branches:

- **`main`** — production / what is deployed. Protected. No direct pushes.
- **`develop`** — integration branch holding all reviewed, good code. Protected.
  No direct pushes.

**Nobody — human or AI — pushes directly to `main` or `develop`.**

To do any work:

1. Branch off **`develop`**:
   ```bash
   git checkout develop && git pull
   git checkout -b <type>/<short-desc>     # type = feature | fix | chore | docs | refactor
   ```
2. Commit using **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`).
3. Before opening a PR, these must pass: `npm run lint` and `npm run build`.
   Never commit secrets.
4. Push your branch and open a **PR into `develop`** (not `main`). Get it reviewed.
   **Squash-merge.**
5. Release: `develop → main` via PR.

**Enforcement:**

- **GitHub branch protection** on `main` and `develop` is the authoritative lock:
  PR required, force-push and deletion blocked, applies to admins too.
- A local **`pre-push` hook** (`.githooks/pre-push`) also rejects direct pushes to
  `main` / `develop`. Enable it once after cloning:
  ```bash
  git config core.hooksPath .githooks
  ```
  A local hook can be bypassed (`git push --no-verify`) — which is exactly why the
  **server-side branch protection is the real guard**. Do not rely on the hook alone.

**AI agents (Claude):** same rules. Never push to `main`/`develop`; always branch
off `develop`; run `lint` + `build` before proposing a PR; keep this file and the
docs in sync with code changes. End commits with the Claude co-author trailer.

---

## 6. Google Play rules / observations (for the mobile apps)

SaaS apps in the suite are also shipped as Android apps. Keep these in mind:

- **Wrap web apps as a TWA (Trusted Web Activity), not a bare WebView.** Bare
  WebView wrappers risk rejection under Play's *Minimum Functionality* / spam
  policy. TWA is the supported path for web-backed apps.
- **Digital Asset Links:** each Android app is verified against its origin via
  `https://mira.vualet.com/.well-known/assetlinks.json`. Because the suite is
  path-based (one origin), a **single** `assetlinks.json` can hold multiple
  statements — add each app's `package_name` + its **SHA-256 signing-cert
  fingerprint**.
- **Play Billing (important):** if you sell digital subscriptions **inside** the
  Android app, Google generally requires **Google Play Billing** (service fee),
  and sending users to Dodo / web checkout from inside the app can violate policy.
  Safer pattern: keep paid conversion on the **web** (subscribe on vualet.com /
  mira.vualet.com) and keep the app focused on *using* the service. If you must
  sell in-app, integrate Play Billing. Re-check current policy (and EU/DMA
  external-offer exceptions) before submitting.
- **Target API level:** target the level Google currently mandates (usually within
  ~1 year of the latest Android release). Verify the exact requirement at submission.
- **Listing requirements:** a public **privacy-policy URL**, the **Data safety**
  form, and justification for any **sensitive permissions**. Veridian is
  telephony/dispatch — restricted permissions (CALL_LOG, SMS, phone) are heavily
  gated; declare + justify, or avoid them.
- **HTTPS** with a valid cert is required (Let's Encrypt via Caddy is fine).

---

## 7. Commands

```bash
npm run dev     # local dev at http://localhost:3000
npm run lint    # eslint (must pass before PR)
npm run build   # production build (must pass before PR)
```
