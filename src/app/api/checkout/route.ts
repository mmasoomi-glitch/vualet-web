import { NextResponse } from "next/server";
import { createDodoCheckout, dodoConfigured, isPaidPlan, normalizeBillingCountry } from "@/lib/dodo";
import { putConnect, type ConnectRecord } from "@/lib/store";
import { mintConnectToken } from "@/lib/connect-token";
import { validatePromo, type PromoOk } from "@/lib/promo";
import { normalisePhone, phoneErrorText } from "@/lib/phone";
import { CHANNELS, DEFAULT_SIGNUP_CHANNEL, type Channel } from "@/lib/pairing";
import {
  readConsent,
  CONSENT_MESSAGE,
  CONSENT_INVALID_MESSAGE,
  type StoredConsent,
} from "@/lib/consent";

// Creates a Dodo Payments subscription checkout for a Mira plan and returns its url.
// Merchant-of-Record provider (replaced Stripe). Carries a connect_token so the
// purchase binds to the customer's chat after payment (see /api/webhooks/dodo).
// Body: { plan, email, name?, persona?, country?, promoCode?,
//         channel?, phone?, consent? }
// When a valid 100%-off promotion code is supplied, the Dodo checkout is skipped
// entirely and the connect record is activated directly (no charge, no payment link).
//
// ── BINDING AT THE POINT OF PURCHASE (gotchas#256, decisions#340, specs#160) ──
// This route used to take plan/email/name/persona/country/promoCode and NOTHING
// ELSE. A customer could therefore pay in full and end up with a record that
// carried no number, no channel and no proof of consent — nothing that could
// ever be bound to WhatsApp. The free trial (/api/begin) collected all three;
// the paid path, which is the revenue path, collected none of them. That is the
// worst ordering there is, and it was ruled release-blocking.
//
// So the same three binding parameters are now collected HERE, at the moment
// money moves, and they follow /api/begin's shapes rather than inventing new
// ones: `channel` from @/lib/pairing (unknown value refused, never coerced),
// `phone` normalised by @/lib/phone and stored ONLY as E.164, and `consent`
// validated SERVER-SIDE against the required scopes of specs#160.
//
// ORDERING IS THE WHOLE POINT: every one of these checks runs BEFORE the promo
// lookup and BEFORE createDodoCheckout, so a refusal costs the customer nothing
// and reaches no provider. A browser that gates on the same rules is welcome;
// it is not a substitute, because a browser is not where the charge is made.
export const runtime = "nodejs";

// ── Gate C1 consent (specs#160) ──────────────────────────────
// Three scopes are REQUIRED before a WhatsApp number may be bound; the
// observation number is OPTIONAL and defaults to false. The rule itself is NOT
// restated here: it lives once in @/lib/consent, which the disclosure component
// the customer ticks and /api/begin import from too. Three copies of a consent
// rule is three chances for the boxes a customer ticks to stop matching the
// boxes this route insists on, and that drift would be silent.
//
// This route uses CONSENT_MESSAGE, which says "before we take payment". The
// module also exports CONSENT_MESSAGE_NO_PAYMENT for the trial path, where that
// wording would be a lie. They are deliberately two strings; do not unify them.

// Input-validation guard (OWASP ASVS 5.1), not a business rule: a phone field
// is a short field and a client must not be able to hand us a megabyte of it.
const CAP_PHONE = 200;

export async function POST(req: Request) {
  let body: {
    plan?: string; email?: string; name?: string; persona?: string;
    country?: string; promoCode?: string;
    channel?: string; phone?: string; consent?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { plan, email, name, persona, country, promoCode, channel: channelRaw, phone, consent: consentRaw } = body;
  if (!isPaidPlan(plan)) {
    return NextResponse.json(
      { error: "Unknown plan. Pick companion, assistant, or studio." },
      { status: 400 },
    );
  }

  // A paid order MUST carry a real customer email. Without one, dodo.ts falls
  // back to a shared hardcoded identity ("guest@vualet.com"), which collapses
  // every paying customer into one fake record — unidentifiable, unable to sign
  // in, and impossible to resolve entitlement for. /mira/checkout marks the
  // field required, but a browser-side attribute is not a guard: this is the
  // server-side one. Fail closed. (Defect B, jury #101.)
  const cleanEmail = typeof email === "string" ? email.trim() : "";
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(cleanEmail) || cleanEmail.length > 200) {
    return NextResponse.json(
      { error: "email_required", message: "Enter your email address to continue." },
      { status: 400 },
    );
  }

  // ── Channel ─────────────────────────────────────────────────────────────
  // Absent means WhatsApp (decisions#340: signup is WhatsApp-first, and a paid
  // signup is still a signup). An unrecognised value is a client bug and is
  // refused rather than silently coerced — a customer who has just PAID must
  // never be quietly put on a channel they did not choose.
  if (channelRaw !== undefined && !CHANNELS.includes(channelRaw as Channel)) {
    return NextResponse.json(
      { error: "invalid_channel", message: "Choose WhatsApp or Telegram." },
      { status: 400 },
    );
  }
  const channel: Channel = (channelRaw as Channel | undefined) ?? DEFAULT_SIGNUP_CHANNEL;

  // ── Phone ───────────────────────────────────────────────────────────────
  // REQUIRED for WhatsApp — it is the address the purchase gets bound to, and a
  // paid record without one is precisely the unbindable record that blocked the
  // release. Optional for Telegram (which pairs on a Telegram id), but whenever
  // a number IS supplied it must normalise. Only the normalised E.164 is stored,
  // never the raw input, so "+971 50 123 4567" and "0501234567" cannot become
  // two paying identities.
  if (typeof phone === "string" && phone.length > CAP_PHONE) {
    return NextResponse.json(
      { error: "invalid_phone", reason: "length", message: phoneErrorText("length") },
      { status: 400 },
    );
  }
  //
  // No defaultCallingCode is passed: the one definition of the default country
  // lives in @/lib/phone (DEFAULT_CALLING_CODE) and normalisePhone already
  // applies it. Repeating it here would be a copy that could silently drift
  // from the lib — and from /api/begin, which for the same reason does not pass
  // one either. A paid number and a trial number must normalise identically.
  const phoneGiven = typeof phone === "string" && phone.trim().length > 0;
  let e164: string | undefined;
  if (channel === "whatsapp" || phoneGiven) {
    const result = normalisePhone(phone);
    if (!result.ok) {
      return NextResponse.json(
        { error: "invalid_phone", reason: result.reason, message: phoneErrorText(result.reason) },
        { status: 400 },
      );
    }
    e164 = result.e164;
  }

  // ── Consent (release gate C1) ───────────────────────────────────────────
  // Required for WhatsApp only: specs#160 is a WhatsApp disclosure, and demanding
  // WhatsApp ban-risk consent from a Telegram customer would be theatre. On the
  // Telegram channel `consent` is not applicable and is neither required nor
  // recorded. On WhatsApp it is checked here, server-side, because the browser
  // is not where the charge is made.
  let consent: StoredConsent | undefined;
  if (channel === "whatsapp") {
    const checked = readConsent(consentRaw);
    if (!checked.ok) {
      return NextResponse.json(
        {
          error: checked.error,
          missing: checked.missing,
          message:
            checked.error === "consent_invalid" ? CONSENT_INVALID_MESSAGE : CONSENT_MESSAGE,
        },
        { status: 400 },
      );
    }
    consent = checked.consent;
  }

  // ── Promotion code ──────────────────────────────────────────────────────
  // Defect A (jury #120): the checkout form sends promoCode in the body, but
  // this route never read it — the customer was told $0 and then charged full
  // price. Now: if a 100%-off code is validated server-side, we skip the Dodo
  // checkout entirely and activate the connect record directly (no charge).
  // Partial discounts are rejected because Dodo has no native promo-code API;
  // the customer is routed to contact us for manual application.
  const promoCodeNorm = typeof promoCode === "string" ? promoCode.trim() : "";
  if (promoCodeNorm) {
    // Only available when the kill-switch is lifted (PROMO_CODES_ENABLED=1) and
    // Stripe is configured (the promo system validates against Stripe).
    if (process.env.PROMO_CODES_ENABLED !== "1") {
      return NextResponse.json(
        {
          error: "promo_unavailable",
          message: "Discount codes are temporarily unavailable. Contact us and we'll apply it manually.",
        },
        { status: 503 },
      );
    }

    let promoResult: PromoOk | { valid: false; reason: string };
    try {
      promoResult = await validatePromo(promoCodeNorm, plan);
    } catch (err) {
      console.error("[checkout] promo validation failed:", err);
      return NextResponse.json(
        { error: "promo_error", message: "Couldn't verify that code. Try again." },
        { status: 502 },
      );
    }

    if (!promoResult.valid) {
      return NextResponse.json(
        { error: "invalid_promo", message: promoResult.reason },
        { status: 400 },
      );
    }

    // 100%-off: activate directly. The customer never visits a payment page.
    if (promoResult.total === 0) {
      const token = mintConnectToken();
      const record: ConnectRecord = {
        token,
        plan,
        email: cleanEmail,
        status: "active", // no payment needed — already "paid" by the code
        persona,
        // A comped customer is still a customer who has to be connected: the
        // binding parameters are recorded here exactly as on the charged path.
        phone: e164,
        channel,
        consent,
        createdAt: new Date().toISOString(),
      };
      try {
        await putConnect(record);
        return NextResponse.json({
          url: null, // no checkout URL — the frontend redirects to welcome
          zeroCharge: true,
          token,
          plan,
          message: "Code applied — your plan is active.",
        });
      } catch (err) {
        console.error("[checkout] zero-charge connect failed:", err);
        return NextResponse.json(
          { error: "checkout_failed", message: "Couldn't activate your plan. Try again." },
          { status: 502 },
        );
      }
    }

    // Partial discount: Dodo has no native promo-code API, so we cannot apply
    // a non-100% discount to the charge. Be honest rather than silent.
    return NextResponse.json(
      {
        error: "partial_discount_unsupported",
        message:
          `This code gives you ${promoResult.label} off, but partial discounts aren't available through checkout yet. Contact us and we'll apply it manually.`,
      },
      { status: 409 },
    );
  }

  if (!dodoConfigured(plan)) {
    // Fail-safe: pre-keys / product-ids-unset → don't 500 the funnel; the UI
    // shows "coming soon". Money path opens only when DODO_API_KEY + the plan's
    // DODO_PRODUCT_* id exist AND DODO_PAYMENTS_LIVE=1.
    return NextResponse.json(
      { error: "not_configured", message: "Payments aren't switched on yet." },
      { status: 503 },
    );
  }

  // ── Billing country / tax jurisdiction ──────────────────────────────────
  // Dodo is the MERCHANT OF RECORD: it computes the VAT/sales tax from
  // billing.country, so this field is an input to the amount the customer pays.
  // normalizeBillingCountry refuses anything that is not a real ISO-3166-1
  // alpha-2 code, and it REFUSES rather than coercing — silently rewriting a
  // customer's jurisdiction to our own default would charge them UAE VAT on an
  // order they told us was somewhere else.
  //
  // Validated HERE, ahead of the connect token, for two reasons the judge named
  // when reviewing the validator: (1) a bad country is the caller's mistake, so
  // it must answer 400 with a usable reason, not the catch-all 502
  // "checkout_failed" that a provider outage answers — that conflates "you sent
  // something wrong" with "we are broken"; (2) failing before mintConnectToken
  // means a refused request leaves NO pending connect record behind, so a
  // rejected order cannot litter the store with rows the webhook can never
  // match. An ABSENT country is untouched and still takes the historical
  // default, which is the path every order from the checkout page takes today.
  let billingCountry: string;
  try {
    billingCountry = normalizeBillingCountry(country);
  } catch {
    return NextResponse.json(
      {
        error: "invalid_country",
        message: "That billing country isn't a recognised country code.",
      },
      { status: 400 },
    );
  }

  // Token that ties this purchase to the customer's chat after payment. The
  // number, the channel and the consent ride along on the same record, so the
  // webhook that marks this order paid is marking a record that can actually be
  // bound — and one that can prove what the customer was shown before they paid.
  const token = mintConnectToken();
  const record: ConnectRecord = {
    token,
    plan,
    email: cleanEmail,
    status: "pending",
    persona,
    phone: e164,
    channel,
    consent,
    createdAt: new Date().toISOString(),
  };

  try {
    await putConnect(record);
    // billingCountry, not the raw `country`: already validated and normalised
    // above, so createDodoCheckout's own call to normalizeBillingCountry is a
    // no-op on it rather than a second, later chance to throw into the 502.
    const { url } = await createDodoCheckout({ plan, email: cleanEmail, name, connectToken: token, country: billingCountry });
    return NextResponse.json({ url });
  } catch (err) {
    console.error("[checkout] dodo failed:", err);
    return NextResponse.json(
      { error: "checkout_failed", message: "Couldn't start checkout. Try again." },
      { status: 502 },
    );
  }
}
