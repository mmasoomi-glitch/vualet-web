# Vualet — Cloud Workspace Brief

You are picking up `vualet-web` in a Claude Code Cloud workspace while the human's local Claude instance handles infrastructure (DNS migration off Bluehost, Hetzner deployment, secrets, Paddle account setup).

## Repo state

The repo is a Next.js 16 storefront for [Vualet](https://vualet.com) — a holding brand that sells multiple B2B SaaS products on subscription. The first product is **WhatsApp AI Agents**, with CRM, HR/People, Inbox, Quotes, and Performance products either coming soon or planned.

Brand and stack decisions are locked in `README.md` and `docs/BRAND.md`. **Do not redesign.** Build inside the existing system.

## Your job

In priority order:

1. **Convert the static product/pricing data into MDX or a small CMS.**
   - Right now `src/lib/products.ts` is a TypeScript array. Migrate to MDX files at `src/content/products/<slug>.mdx` so non-devs can edit. Use `contentlayer2` or `next-mdx-remote`. Keep the `Product` type stable; only the storage moves.
   - Add long-form `body` content per product (problem → solution → screenshots → testimonial → FAQ).

2. **Build the per-product page properly.** Currently `/products/[slug]` is a generic template. Build a richer template with:
   - A product-screenshot hero (left text, right device mock)
   - A 3-up "how it works" section
   - An integrations strip (logos of WhatsApp, HubSpot, Slack, etc.)
   - Pricing tier cards (Starter / Pro / Business) — pull tier data from the MDX frontmatter
   - A testimonial block (placeholder until customers land)
   - A FAQ accordion

3. **Wire Clerk for auth.**
   - Add `@clerk/nextjs`
   - Replace the placeholder `/login` and `/signup` pages with `<SignIn />` and `<SignUp />`
   - Create `(dashboard)/` route group with `app.vualet.com`-style layout
   - Protect dashboard with `clerkMiddleware`
   - Default sign-in redirect: `/dashboard`

4. **Wire Paddle Billing.**
   - Add `@paddle/paddle-js` and `@paddle/paddle-node-sdk`
   - Each product price tier maps to a Paddle Price ID (stub for now in `src/lib/paddle.ts`)
   - Implement `/api/checkout` that creates a transaction and redirects
   - Implement `/api/webhooks/paddle` that verifies signature and updates Supabase subscription rows
   - Test mode only — the human will swap to live keys after MoR account is approved

5. **Wire Supabase.**
   - Use `@supabase/ssr`
   - Two tables: `customers (clerk_user_id, paddle_customer_id, email)` and `subscriptions (id, customer_id, product_slug, plan, status, current_period_end)`
   - JWT integration between Clerk and Supabase RLS
   - Connection details come from `.env.local` — the human will provide

6. **Build the in-product mega-menu data-driven.**
   - Currently `productGroups` is hard-coded in `src/components/nav.tsx`. Derive it from the MDX-loaded products by `category`.

## Conventions

- Tailwind v4 CSS-first theme. All colors live as `--color-vualet-*` CSS variables in `src/app/globals.css`. **Don't add new colors.** Use what's there.
- Display font for headings/logo: `var(--font-display)` (IBM Plex Sans). Body: `var(--font-sans)` (Inter).
- Logo system: every sub-product gets its glyph letter in the same indigo squircle. See `src/components/logo.tsx`. Don't make per-product custom marks.
- All copy avoids "wallet" and "fintech" framing. Lean into the *valet* metaphor: software that does the work on your behalf. Tagline: "Software that runs your business for you."
- All currency display is USD by default. AED is added later via i18n.
- All forms POST to `/api/<route>` — the human will wire those routes to Resend for transactional and Loops for marketing.

## Boundaries — do not touch

- DNS, Cloudflare config, Bluehost migration → human is handling.
- The Hetzner server, the `deploy/` directory, `.github/workflows/deploy.yml`, the `Dockerfile` → human is handling.
- Paddle account creation, real Paddle Price IDs, GHCR tokens, SSH keys → human is handling.
- Brand identity, palette, fonts, logo system → locked. Don't iterate.
- Anything in `/opt/` on the production server → human only.

## Environment variables you'll need (placeholders to start)

```
NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=test_xxx
PADDLE_API_KEY=test_xxx
PADDLE_WEBHOOK_SECRET=whsec_xxx
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxx
CLERK_SECRET_KEY=sk_test_xxx
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx
SUPABASE_SERVICE_ROLE_KEY=eyJxxx
RESEND_API_KEY=re_xxx
LOOPS_API_KEY=xxx
```

The human will supply real values via GitHub Actions secrets and `.env.local`. Use the placeholders to make CI green.

## How to hand things back to the human

When you're done with a chunk, push to a branch named `cloud/<chunk-name>` and open a PR against `main`. The human reviews and merges.

If you hit something only the human can do (creating a Paddle product, generating a real Clerk key, granting access to something), pause and write a single comment in the PR description titled "Blocked on human" with exact steps.

## First task

Run `npm install && npm run dev`, open `http://localhost:3000`, click through every page, and write a 10-line audit of what looks broken or off-brand. Then start with chunk 1 (MDX migration).
