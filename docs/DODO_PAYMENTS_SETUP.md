# Dodo Payments — setup & go-live checklist

Dodo Payments (Merchant of Record) replaced Stripe as the money path for Mira.

## Code (done, on branch `remediate/code-wash`)
- `src/lib/dodo.ts` — REST client (fetch, no SDK dep), product-id map, fail-safe `dodoConfigured()` gate, `createDodoCheckout()`.
- `src/lib/dodo-webhook-core.mjs` — pure Standard-Webhooks verification (HMAC-SHA256) + tier activation (reuses the ConnectRecord contract).
- `src/app/api/checkout/route.ts` — now creates a **Dodo** subscription payment link, carrying the connect_token.
- `src/app/api/webhooks/dodo/route.ts` — verifies signature, dedupes on `webhook-id`, activates/cancels the tier.
- `scripts/dodo-webhook-test.mjs` — 7 tests (signature verify, tamper reject, replay guard, activation). `npm run test:dodo`.

## Runtime config — set these in `/opt/mira-web/runtime.conf` (server-only, NEVER in git)

| Env var | Value | Source |
|---|---|---|
| `DODO_API_KEY` | the Dodo secret API key | `C:\Users\Magic\Desktop\env\env.txt` line 421 (`DODOPAYMENTS_API`) |
| `DODO_MODE` | `test` or `live` | your call |
| `DODO_PAYMENTS_LIVE` | `1` to open the money path (fail-safe: off ⇒ "coming soon" 503) | your call |
| `DODO_PRODUCT_COMPANION` | Dodo product id for the $14.99 tier | **Dodo dashboard — MISSING** |
| `DODO_PRODUCT_ASSISTANT` | Dodo product id for the $39 tier | **Dodo dashboard — MISSING** |
| `DODO_PRODUCT_STUDIO` | Dodo product id for the $79 tier | **Dodo dashboard — MISSING** |
| `DODO_WEBHOOK_SECRET` | Standard-Webhooks signing secret (`whsec_…`) | **Dodo dashboard — MISSING** |

## What's still needed to actually take a payment (owner / Dodo dashboard)
1. **Approved Dodo merchant account** (submit the onboarding form; MoR review).
2. **Create 3 subscription products** in Dodo (Companion $14.99, Assistant $39, Studio $79 monthly) → copy their product ids into the 3 `DODO_PRODUCT_*` env vars. *(Or authorize me to create them via the API in test mode.)*
3. **Add a webhook endpoint** in Dodo → `https://mira.vualet.com/api/webhooks/dodo` → copy the signing secret into `DODO_WEBHOOK_SECRET`.
4. Set `DODO_PAYMENTS_LIVE=1`, restart `mira-web`, run a real test-mode purchase end-to-end (checkout → pay → welcome → Telegram bind).

## Status
IMPLEMENTED — UNTESTED end-to-end. Build+typecheck green, 7/7 unit tests. NO live Dodo call made yet
(no product ids / webhook secret). Deploy + first charge remain owner-attended.

## Notes / follow-ups
- Stripe code (`src/lib/stripe.ts`, `src/app/api/webhooks/stripe/route.ts`) left in place but no longer on the checkout path — remove once Dodo is proven live.
- Promo-code pre-apply (Stripe-specific) was dropped from checkout; Dodo discounts are a separate follow-up.
- `createDodoCheckout` uses `POST /subscriptions` with `payment_link:true` (Dodo's documented shape; they also offer newer Checkout Sessions — swap if preferred).
