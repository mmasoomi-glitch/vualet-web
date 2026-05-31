# Vualet Brand Reference

The brand decisions are locked. This file exists so future contributors don't reopen settled questions.

## Name

**Vualet.** A coined word that sits between *valet* (servant, does work on your behalf), *wallet* (financial container — actively suppressed), and *violet* (visual cue for the palette).

**Lean into valet.** Suppress wallet/fintech. The tagline writes itself: software that handles the running of the business so the owner can run the business.

## Tagline

**Software that runs your business for you.**

Alt: "Hand it to Vualet." · "Your business, on autopilot."

## Palette (Vualet Indigo — locked)

| Token | Hex | Use |
|---|---|---|
| `--color-vualet-indigo` | `#5B5BF6` | Primary, CTAs, links on dark, brand mark |
| `--color-vualet-indigo-hover` | `#4848E3` | CTA hover |
| `--color-vualet-indigo-soft` | `#8B8BF8` | Soft indigo on dark surfaces |
| `--color-vualet-ink` | `#0F1117` | Marketing dark surface |
| `--color-vualet-ink-2` | `#161823` | Cards on dark |
| `--color-vualet-lime` | `#C7F25A` | "New" badges, highlight rows, single-use accent |
| `--color-vualet-text-dark` | `#E6E8EE` | Body on dark |
| `--color-vualet-text-light` | `#0B0D12` | Body on light |
| `--color-vualet-success` | `#22C55E` | |
| `--color-vualet-danger` | `#EF4444` | |

Light mode default. Dark mode auto-activates on system preference. No third palette.

## Typography

- **Display:** IBM Plex Sans (Google Fonts), 400/500/600/700. Used for headlines, the wordmark, and the glyph inside the logo squircle. Bilingual sibling: IBM Plex Sans Arabic for RTL pages.
- **Body:** Inter (Google Fonts, variable). Used for paragraphs, navigation, buttons, footers.
- Both loaded via `next/font/google` in `src/app/layout.tsx`. Don't add a third font.

## Logo system

Parent **V** in an iOS-style squircle (radius ≈ 28 % of size), filled `#5B5BF6`, white glyph.

Every sub-product uses **the same squircle** with **its own letter**:

| Product | Glyph |
|---|---|
| Vualet (parent) | V |
| CRM Automation | C |
| Employee Hub | H |
| WhatsApp AI Agents | W |
| Omnichannel Inbox | I |
| Quote-to-Cash | Q |
| Performance | P |

Implementation: `<Logo glyph="C" size={44} title="CRM Automation" />`. See `src/components/logo.tsx`.

**Do not** design bespoke marks per product. The system *is* the mark.

## Voice

- Quietly competent. Linear / Stripe / Plain register.
- Sentences are short. Verbs do the work.
- Never "revolutionary," "next-gen," "10x," or "AI-powered." The product does AI; the marketing doesn't shout about it.
- Arabic copy is a peer language, not a translation. Hire a copywriter; don't run Google Translate.

## Storefront IA

- **Home:** parent promise + product grid + Vualet One bundle + Built-in-Dubai trust strip.
- **Products page:** category buckets (Customer Conversations / Sales & CRM / HR & People), every product gets a tile.
- **Per-product page:** hero + how-it-works + integrations + tiers + FAQ.
- **Pricing:** per-product cards + Vualet One bundle + custom CTA.
- **Customers:** placeholder until first cohort lands.
- **Docs:** redirects to `docs.vualet.com` (Mintlify, future).

Mega-menu in nav is grouped by *use case*, not alphabetically.

## Reference brands

Closest neighbors in 2026 visual language: Linear, Supabase, Clerk, Plain. Aspirational positioning: Zoho One / Atlassian's multi-product structure with Linear's polish.
