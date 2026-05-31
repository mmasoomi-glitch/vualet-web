# MIRA — handoff for the vualet-web team

Last updated: 2026-05-31, by the Mira sprint.
Audience: anyone working on `vualet-web` who needs to know what already
exists, what claims it makes on shared resources, and where the two
codebases are likely to collide.

This document is **descriptive, not prescriptive** — it tells you what
*is*, not what *should be*. Decisions about converging the stacks are at
the bottom.

---

## 1 · TL;DR

**Mira** is a SaaS product family by Vualet, sold by the month.
The first shipping product is **Mira Modem Attendance v3.1** — a
presence-first attendance tool that watches an office Wi-Fi via a small
LAN agent. Future siblings: **Mira WhatsApp Assistant** (v0.1 design).

Live at **https://mira.vualet.com** today. Code lives in a **separate
repository** from `vualet-web`:

| Repo | Role |
|---|---|
| `mmasoomi-glitch/vualet-web` (this repo) | Marketing storefront + future Vualet-wide auth/billing |
| **`mmasoomi-glitch/Mira-Modem-Attendance`** | Mira platform — backend, web UI, LAN agent |

Mira does **not** import anything from vualet-web. vualet-web does not
import anything from Mira. The two share **one Hetzner VPS, one DNS
parent (vualet.com), and one Cloudflare account**.

---

## 2 · What Mira actually is, in one paragraph

A multi-tenant FastAPI cloud (Python 3.12) that:

- signs people in with **magic-link emails** (no passwords),
- auto-starts a **7-day trial subscription** for every new tenant,
- exposes a **Mira product family** (registry seeded on boot: Modem
  Attendance live · WhatsApp Assistant coming-soon),
- bridges to a small **LAN agent** (MIT-licensed, `pip install mira-agent`)
  running on the customer's office machine over a **WebSocket**,
- the agent drives the customer's router (Huawei H155 today; TP-Link +
  Asus in development) so router passwords never reach the cloud.

The Mira backend is **not** the same as the AFAQ commerce backend that
already runs on the VPS, and the Mira **frontend** is a plain HTML/JS
site served by the FastAPI process itself (no Next.js, no build step).

---

## 3 · What URLs / ports / subdomains Mira already claims

### Subdomain
- **`mira.vualet.com`** — A-record at Bluehost → `89.167.49.209`.
- Holds a Let's Encrypt cert (`/etc/letsencrypt/live/mira.vualet.com/`)
  set to auto-renew. Cert obtained 2026-05-31, expires 2026-08-29.
- **Cloudflare is NOT in front of this hostname today** — Bluehost DNS
  resolves directly to the VPS. If vualet-web migrates the parent zone
  to Cloudflare, mira.vualet.com must keep its A record (or move into
  Cloudflare alongside).

### Paths served at mira.vualet.com
| Path | What |
|---|---|
| `/` | Mira family hub (lists products) |
| `/products/modem-attendance` | Modem Attendance product landing |
| `/signin` | Magic-link sign-in |
| `/app` | Multi-product workspace picker |
| `/app/modem-attendance` | Modem Attendance dashboard |
| `/app/billing` | Subscription / trial status + Stripe Checkout |
| `/api/healthz` | Liveness |
| `/api/auth/*` | start, verify, logout |
| `/api/me` | Current user + workspaces |
| `/api/products`, `/api/products/mine` | Product registry + entitlement view |
| `/api/billing/*` | status, checkout, portal, webhook |
| `/api/agent/*` | pairing-code, pair, WebSocket bridge |
| `/api/workspaces/{id}/{agents,devices}` | Per-workspace LAN data |
| `/brand/*`, `/static/*` | Mira brand assets + PWA manifest |

### Server-side ports on the VPS
| Port | Owner | Notes |
|---|---|---|
| 80 / 443 | **nginx** | Serves `afaq24.store` + `mira.vualet.com`; vualet-web wants Caddy here — see §8 |
| 3000 | AFAQ commerce **Next.js** | Already taken. vualet-web's README also wants 3000 — see §8 |
| 8001 | afaq-backend-api docker (FastAPI) | AFAQ commerce |
| 8090 | **Mira FastAPI** (systemd `mira-cloud.service`) | Bound 127.0.0.1 only |
| 5433 | afaq-backend-db (Postgres 16) | Mira opened a `mira` database here |
| 6380 | afaq-backend-redis | Not used by Mira |
| 3210 | Veridian Node service | Not Mira |
| 22 | sshd | shared |

---

## 4 · Code layout (separate repo)

```
mira-modem-attendance/
├── services/api/                FastAPI cloud
│   ├── app/
│   │   ├── main.py              Bootstrap, lifespan, page routes
│   │   ├── config.py            pydantic-settings (reads .env)
│   │   ├── db.py                SQLAlchemy async engine
│   │   ├── models.py            Tenant · User · Membership · MagicLink ·
│   │   │                        Router · Agent · Device · Event ·
│   │   │                        Product · Subscription · AuditLog
│   │   ├── auth/                Magic-link signup/login, session cookies
│   │   ├── billing/             Stripe Checkout + Portal + webhook +
│   │   │                        entitlement (trial-vs-locked gate)
│   │   ├── drivers/             RouterDriver Protocol + brand modules
│   │   └── routers/             agent, me, products, workspace
│   └── pyproject.toml
├── apps/agent/                  LAN companion (MIT)
│   └── mira_agent/{cli, pairing, runner, commands, drivers/}
├── apps/web/public/             Plain HTML + Mira CSS (no build step)
│   ├── landing.html             /
│   ├── products/{slug}.html     /products/{slug}
│   ├── signin.html              /signin
│   ├── app.html                 /app  (multi-product picker)
│   ├── app/{slug}.html          /app/{slug}
│   └── app/billing.html         /app/billing
├── packages/brand/              Mira logos, CSS, brand kit
├── scripts/deploy.sh            Idempotent VPS installer
├── infra/{nginx,systemd}/       Reference configs
├── CLAUDE.md                    AI-pair playbook (read-this-first)
├── CONTRIBUTING.md · SECURITY.md · CODE_OF_CONDUCT.md
└── .github/{CODEOWNERS, ISSUE_TEMPLATE, PR template, workflows/ci.yml}
```

On the VPS the same tree lives at **`/opt/mira-cloud/`**.

---

## 5 · Environment variables Mira expects

These live in `/opt/mira-cloud/services/api/.env` on the VPS (chmod 600).
Defaults and sources noted.

```env
# App
APP_NAME=Mira Modem Attendance
APP_ENV=production
PUBLIC_URL=https://mira.vualet.com
SECRET_KEY=<32+ hex; rotates → invalidates all sessions>

# Database — Postgres on the existing afaq container
DATABASE_URL=postgresql+asyncpg://<user>:<pass>@127.0.0.1:5433/mira
DATABASE_ECHO=false

# Email (magic-link delivery)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<gmail address>
SMTP_PASS=<gmail app password>           # not the real account password
EMAIL_FROM=Mira <noreply@mira.vualet.com>

# Stripe (test mode today — live keys to be added later)
STRIPE_SECRET_KEY=sk_test_…               # account-wide
STRIPE_PUBLISHABLE_KEY=                   # unused server-side; needed only if we add Stripe Elements
STRIPE_WEBHOOK_SECRET=whsec_…             # created via API; mapped to the endpoint
STRIPE_PRICE_MONTHLY=price_…              # $4.99/mo recurring; product "Mira Modem Attendance"

# Sessions
SESSION_TTL_SECONDS=2592000               # 30 days
COOKIE_SECURE=true                        # require HTTPS

# Agent ↔ cloud (Mira-issued, per-tenant)
# (no env entry — tokens live in the DB, hashed)
```

The Stripe resources were **created via the Stripe API on 2026-05-31**:

- product `prod_UcQyLftqZilCq0` ("Mira Modem Attendance")
- price   `price_1TdC6TGhlK4bMZEvl7ZwptbM` ($4.99/mo USD)
- webhook `we_1TdC6VGhlK4bMZEvo8X9rU15` → `https://mira.vualet.com/api/billing/webhook`,
  listening on subscription + invoice + checkout-session events.

---

## 6 · DNS / TLS facts (as of 2026-05-31)

| Hostname | NS | Resolves to | TLS |
|---|---|---|---|
| `vualet.com` | Bluehost (`ns{1,2}.bluehost.com`) | (not yet pointing at VPS) | none yet |
| `mira.vualet.com` | Bluehost | `89.167.49.209` directly | LE cert in nginx |
| `afaq24.store` | Bluehost | `89.167.49.209` | LE cert in nginx |

The vualet-web README assumes vualet.com sits behind **Cloudflare**.
Today the parent zone is still on Bluehost; until the NS records are
moved, putting Cloudflare in front of *vualet.com* will require
mirroring the `mira` A-record on Cloudflare or repointing it. Either is
fine, just plan it explicitly.

---

## 7 · What's done vs half-done

### Done
- Landing + sign-in + dashboard + per-product landings render with the
  Mira brand (rose / lavender / aether gradient, Fraunces + Inter,
  breathing aura).
- Magic-link signup + login via Gmail SMTP.
- Multi-tenant DB schema (tenants, users, memberships, products,
  subscriptions, agents, devices, events, audit_log).
- Product family scaffolding: registry seeded on boot, `/api/products`
  + `/api/products/mine` return entitlement-aware listings.
- Stripe: product + price + webhook created via API; Checkout returns a
  real Stripe URL; webhook persists subscription updates and verifies
  signatures.
- 7-day trial **auto-creates** on user signup; `get_entitlement()`
  downgrades expired trials to `locked`; product endpoints gated by
  `require_entitlement()` (HTTP 402 when missing).
- Customer billing page at `/app/billing` with countdown, Stripe test
  card hint, and Stripe-Portal access.
- LAN agent skeleton (MIT) with pairing flow, WebSocket runner, command
  allowlist, router auto-detect, Huawei H155 driver fully ported.
- GitHub repo created (private), CI workflow live, governance docs in
  place (`CLAUDE.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
  CODEOWNERS, PR + issue templates).
- VPS deploy script (`scripts/deploy.sh`) creates the DB, sets up
  systemd unit, writes the nginx vhost, runs certbot.

### Half-done / known gaps
- **`/api/auth/verify` is throwing 500 on first signup** as of the last
  push. Stack trace points to a stale `pyotp.random_hex(3)` call that
  was replaced with `secrets.token_hex(3)` but Python 3.14 on the VPS
  appears to be running a cached bytecode of the previous version. Fix
  is small: a clean restart that clears `__pycache__` under the venv
  fully. Not pushed because the convo pivoted to writing this doc.
- **Stripe live keys** — not set. The `_test_` keys work end-to-end with
  test card `4242 4242 4242 4242`. Live cutover is a single env swap.
- **2FA TOTP** — column reserved on `users`, no UI to enrol yet.
- **Postgres row-level-security** policies aren't created. Today's
  isolation is app-level (`tenant_id` everywhere).
- **Alembic migrations** — none. Tables auto-create from
  `Base.metadata.create_all` on boot. Fine for MVP, must replace before
  the schema starts evolving.
- **Multi-router** — Huawei works; TP-Link Archer + Asus Merlin are
  stub modules with implementation notes in the docstrings.
- **Native Windows / Android apps** — only the PWA manifest exists.
- **Stress test** — not run yet. Plan: 30 fake agents from a workstation
  for a 10-minute connection-correctness sweep. No effect on this VPS.

---

## 8 · Conflicts with vualet-web (the important section)

These are the places where the two codebases want the same physical or
logical resource. Each one needs a deliberate decision *before*
vualet-web ships, or one of them will silently lose.

### 8.1 Port 3000 collision
- vualet-web README: "self-hosted … behind Caddy 2", server runs on
  `next start -p 3000`.
- VPS today: **`127.0.0.1:3000`** is taken by `afaq-backend` Next.js
  (the existing AFAQ commerce front-end behind nginx).
- vualet-web has **two real options**:
  - run on a different host port (e.g. `:3010`) and let the proxy hide it, or
  - displace the AFAQ commerce service onto another port.
- Mira does NOT use 3000 — Mira binds 8090.

### 8.2 Front proxy collision (nginx vs Caddy)
- The VPS uses **nginx** today (`/etc/nginx/sites-enabled/`).
  `afaq24.store` and `mira.vualet.com` both depend on its server blocks.
- vualet-web README wants **Caddy 2 in Docker Compose** as the front.
- Only one process can bind `:80` + `:443`. If Caddy comes up:
  - nginx must stop and become a back-end on, say, `:8443`, with Caddy
    forwarding to it — **or**
  - the mira.vualet.com + afaq24.store vhosts must move *into* the Caddy
    config and nginx must be decommissioned.
- This is an explicit migration, not a side-effect of `docker compose up`.

### 8.3 Stripe vs Paddle
- vualet-web README plans **Paddle Billing (MoR)**.
- Mira already has live Stripe test resources (product, price, webhook)
  and a working Checkout + Portal flow.
- These don't share a database row — they're independent ways to charge
  the customer. But every Mira tenant carries a `stripe_customer_id`,
  not a `paddle_customer_id`. If Vualet-as-a-company picks Paddle, Mira
  needs a parallel flow (or a migration of existing test subs).

### 8.4 Magic link (Mira) vs Clerk (vualet-web)
- Mira has its own auth: `MagicLink` + `User` + signed session cookies.
- vualet-web plans **Clerk**.
- If vualet-web becomes the single sign-in for the whole Vualet account
  → Mira must accept a Clerk session and stop running its own magic-link
  flow. The current Mira code does not depend on Clerk in any way.

### 8.5 Postgres (afaq container) vs Supabase
- Mira's `mira` database lives **inside the existing afaq-backend
  Postgres container** on `:5433`, talking to it via `postgresql+asyncpg`.
- vualet-web plans **Supabase** for the whole company.
- These are independent today; nothing breaks. But "one Vualet, one
  database" implies a future migration of Mira's tables into Supabase
  (or pinning Mira to the local container forever as a separate
  product-side store).

### 8.6 Email (Gmail SMTP) vs Resend / Loops
- Mira sends magic-link mail via **`smtp.gmail.com` + an app password**
  on the production account.
- vualet-web plans **Resend (transactional) + Loops (lifecycle)**.
- This is the cheapest one to converge: change Mira's `SMTP_HOST`
  to Resend's SMTP gateway (or swap `aiosmtplib` for the Resend API)
  and that's it.

### 8.7 Brand vs marketing copy
- Mira's brand kit lives at `packages/brand/` inside its own repo and is
  imported by Mira's HTML directly from `/brand/*` on the cloud server.
- vualet-web has its own `docs/BRAND.md`. The two should not diverge.
  Recommendation: one canonical brand source (probably `vualet-web`),
  and Mira's `packages/brand/` becomes a synced copy.

### 8.8 DNS
- `mira.vualet.com` resolves directly via Bluehost today.
- vualet-web README assumes Cloudflare in front of vualet.com.
- When vualet.com moves to Cloudflare nameservers, **the `mira` A-record
  has to be re-created at Cloudflare** or `mira.vualet.com` goes dark.

---

## 9 · Decisions to make (open questions)

In rough order of urgency:

1. **Front-proxy direction.** nginx stays, or migrate to Caddy 2?
   This blocks vualet-web shipping its `deploy/` stack on this VPS.
2. **Auth direction.** Does Vualet-the-company adopt Clerk for all
   products → Mira deprecates its magic-link? Or do products keep their
   own auth and only the marketing site uses Clerk?
3. **Billing direction.** Paddle (MoR) for everything, or Stripe stays
   for Mira because it's already wired? Mixing both is possible but
   doubles the reporting surface.
4. **Database direction.** Mira on local Postgres vs. Supabase. The
   sooner this is decided the smaller the migration.
5. **One Vualet account** vs **one account per product**? This drives
   most of the above.

None of these are blocked by code — they're choices.

---

## 10 · Operational facts you'll want to know

- Service: `systemctl status mira-cloud` on the VPS.
- Logs: `/opt/mira-cloud/logs/mira.log` and `mira.err.log`.
- Self-heal: `router-watchdog.timer` (used by the older `rdash` service)
  is **not** wired for `mira-cloud`. Mira relies on systemd's
  `Restart=always`. Worth adding a similar 60-second HTTP probe.
- Restart flow if the schema changes:
  1. `ssh root@89.167.49.209`
  2. `cd /opt/mira-cloud && git pull` (after we add a deploy key) **or**
     re-run the tar+scp from a workstation.
  3. `systemctl restart mira-cloud`
- Postgres for Mira:
  `psql -h 127.0.0.1 -p 5433 -U <user> -d mira` from the VPS.
- Stripe dashboard for Vualet (test mode):
  https://dashboard.stripe.com/test/products + /webhooks + /customers.
- The Mira repo: `git@github.com:mmasoomi-glitch/Mira-Modem-Attendance.git`
  (private). PAT for push lives DPAPI-encrypted on Dr. Masoomi's PC at
  `D:\router-automation\.github_pat.dpapi`.

---

## 11 · What lives in the OTHER (older) office tool

The Mira repository **must not** be confused with the older office
router dashboard that is *also* running on the same VPS at
`/opt/router-dash/`, served at `afaq24.store/rdash`. That older tool
(working name "rdash") is the live system Dr. Masoomi uses today for
the real office router. It will be retired once the equivalent Mira
flows are stable.

If you see a service called `router-dash.service` or a folder under
`/opt/router-dash/`, it's rdash, not Mira.

---

*— end of MIRA.md —*
