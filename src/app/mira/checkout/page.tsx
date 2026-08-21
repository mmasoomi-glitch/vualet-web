"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Stepper } from "../_components/Stepper";
import { tierById, TIERS } from "../_components/tiers";
import { DEFAULT_CALLING_CODE, normalisePhone, phoneErrorText } from "@/lib/phone";
import WhatsAppDisclosure, {
  EMPTY_WHATSAPP_CONSENT,
  whatsAppConsentComplete,
  type WhatsAppConsent,
} from "@/app/mira/_components/WhatsAppDisclosure";

type AppliedPromo = {
  code: string;
  subtotal: number;
  discount: number;
  total: number;
  currency: string;
  label: string;
};

function fmtMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

const card: React.CSSProperties = {
  background: "var(--mira-canvas)",
  border: "1px solid var(--mira-fog)",
  borderRadius: "var(--mira-radius-lg)",
  boxShadow: "var(--mira-shadow-sm)",
  padding: 24,
};
// The ONE place a WhatsApp number is collected, the release-gate-C1 disclosure
// is shown, the three required consents are taken, and /api/begin is called.
// It is also step 1 of <Stepper/> (Sign up -> Choose plan -> Payment).
const CONNECT_STEP = "/mira/start";

// Signup channel. WhatsApp-first, and deliberately NOT a picker: Telegram is no
// longer offered to new customers (decisions#340), so this is a constant the
// paid branch states rather than a choice the customer is asked to make.
const SIGNUP_CHANNEL = "whatsapp" as const;

const input: React.CSSProperties = {
  width: "100%",
  padding: "13px 15px",
  fontSize: 15,
  borderRadius: "var(--mira-radius-md)",
  border: "1px solid var(--mira-fog)",
  background: "var(--mira-cream)",
  color: "var(--mira-ink)",
  outline: "none",
};

function Checkout() {
  const router = useRouter();
  const params = useSearchParams();
  const plan = tierById(params.get("plan")) ?? TIERS.find((t) => t.id === "assistant")!;
  const isTrial = plan.id === "free";
  const [paying, setPaying] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  // -- Binding her AT THE POINT OF PURCHASE ---------------------------------
  // A paying customer used to supply no number, no channel and no consent
  // anywhere in this flow: they paid, and there was then nothing to connect
  // them with. The free branch can delegate that to the sign-up step because
  // nothing is being bought; a paid branch cannot. Checkout IS the moment the
  // C1 consent has to exist, because one line below this page redirects to the
  // payment provider and never comes back.
  const [phone, setPhone] = useState("");
  // The error appears once they have actually left the field, not while they
  // are still half-way through typing their own number.
  const [phoneTouched, setPhoneTouched] = useState(false);
  // Every box starts UNCHECKED. Consent is given, never defaulted.
  const [consent, setConsent] = useState<WhatsAppConsent>(EMPTY_WHATSAPP_CONSENT);
  const [consentAttempted, setConsentAttempted] = useState(false);

  // The single source of truth for "is this number usable" - the same vendored
  // normaliser the engine and /mira/start use, so a number typed here and a
  // number shared in chat converge on exactly one identity. Not re-derived.
  //
  // No `defaultCallingCode` is passed: the option would only repeat what the
  // library already defaults to, and normalisePhone now defaults it from the
  // exported DEFAULT_CALLING_CODE. Passing it anyway would recreate, at the
  // call site, exactly the second copy this change exists to remove. The
  // constant is still imported because the hint text below has to NAME the
  // code it will add, and that text must never be able to promise a different
  // country from the one the normaliser applies.
  const phoneResult = useMemo(() => normalisePhone(phone), [phone]);
  const phoneE164 = phoneResult.ok ? phoneResult.e164 : null;
  const phoneError = !phoneResult.ok && phoneTouched ? phoneErrorText(phoneResult.reason) : null;
  // The consent RULE lives in WhatsAppDisclosure (specs#160) and is not restated
  // here - this only asks it whether the three required boxes are ticked.
  const consentComplete = whatsAppConsentComplete(consent);

  // Promotion code: validated server-side before it's applied.
  const [promoInput, setPromoInput] = useState("");
  const [promoPending, setPromoPending] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [applied, setApplied] = useState<AppliedPromo | null>(null);

  async function applyPromo() {
    const code = promoInput.trim();
    if (!code || promoPending) return; // repeated clicks are safe
    setPromoPending(true);
    setPromoError(null);
    try {
      const res = await fetch("/api/promo/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, plan: plan.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.valid) {
        setApplied({
          code: data.code,
          subtotal: data.subtotal,
          discount: data.discount,
          total: data.total,
          currency: data.currency,
          label: data.label,
        });
        setPromoError(null);
      } else {
        setApplied(null);
        setPromoError(data.reason || "That code isn't valid.");
      }
    } catch {
      // Network fail — keep the original total, don't wipe an existing discount.
      setPromoError("Couldn't reach us to check that code. Try again.");
    } finally {
      setPromoPending(false);
    }
  }

  function removePromo() {
    setApplied(null);
    setPromoError(null);
    setPromoInput("");
  }

  function readSetup(): Record<string, unknown> {
    try {
      return JSON.parse(localStorage.getItem("mira_setup") || "{}");
    } catch {
      return {}; // setup is optional — persona just won't be carried
    }
  }

  // ── The free plan HANDS OFF; it does not connect ──────────────────────────
  // This used to POST /api/begin with { plan, email, setup } and no phone. Under
  // the current contract that is a 400 (`invalid_phone`) on every single call:
  // /api/begin defaults `channel` to "whatsapp" and REQUIRES a number it can
  // normalise to E.164 (src/app/api/begin/route.ts). The old code then read
  // `data.token` without checking `res.ok`, so the customer got the flat
  // "Couldn't start your free plan" with the server's real reason discarded.
  //
  // The fix is deliberately NOT "add a phone field here too". Binding a WhatsApp
  // number is gated by release gate C1 (decisions#340): the customer must be
  // shown _components/WhatsAppDisclosure.tsx and tick the three REQUIRED
  // consents, and /mira/start sends that `consent` object alongside the number
  // so a record exists of what they were told and agreed to. Consent is
  // deliberately NOT persisted to localStorage, so this page cannot prove it was
  // ever given — `mira_setup` can hold a number that was typed and then
  // abandoned before the notice was read, because the wizard writes the
  // normalised number there as it is typed. Posting from here would bind a real
  // number without provable consent; re-rendering the notice here would create a
  // SECOND C1 surface that can drift from the first.
  //
  // So one place collects the number, shows the notice and calls /api/begin, and
  // this is the hand-off to it. It is also the product's own order: a trial
  // customer standing on Payment with no number simply has not done step 1 yet.
  // Nothing here claims a WhatsApp connection: the only page allowed to say she
  // is connected is the one holding a server-issued link.
  function startTrial() {
    router.push(CONNECT_STEP);
  }

  async function payWithProvider() {
    // -- GATE C1 (decisions#340) - the authoritative check -------------------
    // It lives HERE, in the function that actually charges, and not in the
    // button's `disabled` prop. A disabled button is a hint that can be
    // bypassed by a stray Enter key, a re-render or a future caller; this is
    // the gate. Nothing is charged, and no number leaves the browser, until
    // the number normalises AND the three required consents are given. Both
    // branches surface the reason on screen rather than failing silently.
    if (!phoneResult.ok) {
      setPhoneTouched(true);
      return;
    }
    if (!consentComplete) {
      setConsentAttempted(true);
      return;
    }

    // Real charge: create a hosted-checkout session with the payment provider
    // (Dodo Payments) and hand off to it.
    const setup = readSetup();
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: plan.id,
          email: email || undefined,
          persona: typeof setup.persona === "string" ? setup.persona : undefined,
          promoCode: applied?.code,
          // Binding parameters, at the TOP LEVEL - the same shape /mira/start
          // already sends to /api/begin, so there is one contract across both
          // entry points rather than two. `phone` is the NORMALISED E.164 form
          // only: the raw string is never sent, so "+971 50 123 4567" and
          // "0501234567" cannot become two identities. `consent` travels with
          // it so the record of what the customer was told, and agreed to,
          // exists server-side and not only in this component's memory - a
          // gate that lives only in the browser is a gate anyone walks around.
          channel: SIGNUP_CHANNEL,
          phone: phoneResult.e164,
          consent,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      // The server re-checks both of these. If it refuses, put the customer back
      // on the field responsible as well as showing the server's own words -
      // these two codes are honoured if present, and any other message still
      // falls through to the generic line below.
      if (data.error === "invalid_phone") setPhoneTouched(true);
      if (data.error === "consent_required") setConsentAttempted(true);
      setError(data.message || "Couldn't start checkout. Try again.");
    } catch {
      setError("Something went wrong. Try again.");
    }
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPaying(true);
    if (isTrial) {
      // Navigation is in flight — deliberately leave the button disabled rather
      // than re-enabling it for a second push at the same destination.
      startTrial();
      return;
    }
    await payWithProvider();
    setPaying(false);
  }

  return (
    <main id="mira-main" style={{ maxWidth: 920, margin: "0 auto", padding: "48px 24px 80px" }}>
      <Stepper current={3} />
      <header style={{ textAlign: "center", marginBottom: 28 }}>
        <h1 className="display" style={{ fontSize: "clamp(28px,4.5vw,40px)", margin: "0 0 6px" }}>
          Almost <span className="grad">hers</span>
        </h1>
        <p style={{ color: "var(--mira-graphite)", fontSize: 15.5, margin: 0 }}>
          {isTrial
            ? "Review your plan — no card needed. Next you'll connect her to your WhatsApp."
            : `14-day free trial, then ${plan.price}${plan.per ?? "/mo"} — no charge for 14 days. Cancel anytime.`}
        </p>
      </header>

      <div className="mira-2col">
        {/* Order summary */}
        <section style={card}>
          <p style={{ fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--mira-rose-ink)", fontWeight: 600, margin: 0 }}>
            Your plan
          </p>
          <p className="display" style={{ fontSize: 30, fontWeight: 400, margin: "8px 0 0", display: "flex", alignItems: "baseline", gap: 6 }}>
            {plan.name}
            <span style={{ fontSize: 16, color: "var(--mira-slate)" }}>{plan.price}{plan.per}</span>
          </p>
          <p style={{ fontSize: 13, color: "var(--mira-slate)", margin: "2px 0 0" }}>{plan.sub}</p>
          <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 0", fontSize: 14, color: "var(--mira-graphite)" }}>
            {plan.items.map((it) => (
              <li key={it} style={{ padding: "3px 0" }}>✓ {it}</li>
            ))}
          </ul>
          <div style={{ borderTop: "1px solid var(--mira-fog)", margin: "16px 0 0", paddingTop: 14, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 14, color: "var(--mira-graphite)" }}>Due today</span>
            <span className="display" style={{ fontSize: 22 }}>$0</span>
          </div>
          {!isTrial && (
            <p style={{ fontSize: 12.5, color: "var(--mira-slate)", margin: "6px 0 0", textAlign: "right" }}>
              then {plan.price}{plan.per} after your 14-day free trial
            </p>
          )}
          <Link href="/mira/plans" style={{ fontSize: 13, color: "var(--mira-rose-ink)", display: "inline-block", marginTop: 12 }}>
            ← Change plan
          </Link>
        </section>

        {/* Free plan: hand off to the sign-up step, which collects the WhatsApp
            number and the consents. Paid plans: email capture + handoff to the
            provider's hosted checkout. */}
        <form onSubmit={pay} style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--mira-slate)", marginBottom: 14 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--mira-success)" }} />
            {isTrial ? "No card needed to start" : "Secure checkout"}
          </div>
          {/* Email is asked for ONLY on the paid path, which is the only path that
              still consumes it (/api/checkout requires it to create the customer).
              Since the free plan now hands off to the sign-up step, an email typed
              here would be silently discarded — so it is not asked for. */}
          {!isTrial && (
            <>
              <label style={{ display: "block", fontSize: 13, color: "var(--mira-graphite)", marginBottom: 6 }}>Email</label>
              <input
                style={input}
                type="email"
                inputMode="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </>
          )}
          {error && (
            <p role="alert" style={{ fontSize: 13, color: "var(--mira-rose-ink)", margin: "12px 0 0" }}>
              {error}
            </p>
          )}

          {!isTrial && (
            <div style={{ marginTop: 18 }}>
              <label style={{ display: "block", fontSize: 13, color: "var(--mira-graphite)", marginBottom: 6 }}>
                Promotion or discount code
              </label>
              {!applied ? (
                <>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      style={{ ...input, flex: 1 }}
                      type="text"
                      inputMode="text"
                      autoCapitalize="characters"
                      autoComplete="off"
                      placeholder="e.g. MIRA-PRO-30"
                      value={promoInput}
                      onChange={(e) => setPromoInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          applyPromo();
                        }
                      }}
                      disabled={promoPending}
                      aria-label="Promotion or discount code"
                    />
                    <button
                      type="button"
                      onClick={applyPromo}
                      disabled={promoPending || promoInput.trim() === ""}
                      style={{
                        padding: "0 18px",
                        fontSize: 14,
                        fontWeight: 600,
                        borderRadius: "var(--mira-radius-md)",
                        border: "1px solid var(--mira-rose-deep)",
                        background: "transparent",
                        color: "var(--mira-rose-ink)",
                        cursor: promoPending || promoInput.trim() === "" ? "not-allowed" : "pointer",
                        opacity: promoPending || promoInput.trim() === "" ? 0.55 : 1,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {promoPending ? "Checking…" : "Apply"}
                    </button>
                  </div>
                  {promoError && (
                    <p role="alert" style={{ fontSize: 12.5, color: "var(--mira-rose-ink)", margin: "8px 0 0" }}>
                      {promoError}
                    </p>
                  )}
                </>
              ) : (
                <div
                  style={{
                    border: "1px solid var(--mira-fog)",
                    borderRadius: "var(--mira-radius-md)",
                    background: "var(--mira-cream)",
                    padding: "14px 16px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--mira-success)", fontWeight: 600 }}>
                      Code applied
                    </span>
                    <button
                      type="button"
                      onClick={removePromo}
                      style={{
                        fontSize: 12.5,
                        background: "none",
                        border: "none",
                        color: "var(--mira-slate)",
                        textDecoration: "underline",
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      Remove
                    </button>
                  </div>
                  <dl style={{ margin: 0, fontSize: 13.5, color: "var(--mira-graphite)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                      <dt>Subtotal</dt>
                      <dd style={{ margin: 0 }}>{fmtMoney(applied.subtotal, applied.currency)}{plan.per}</dd>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                      <dt>Promotion code</dt>
                      <dd style={{ margin: 0, fontWeight: 600 }}>{applied.code}</dd>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", color: "var(--mira-success)" }}>
                      <dt>Discount{applied.label ? ` (${applied.label})` : ""}</dt>
                      <dd style={{ margin: 0 }}>−{fmtMoney(applied.discount, applied.currency)}</dd>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "8px 0 0",
                        marginTop: 6,
                        borderTop: "1px solid var(--mira-fog)",
                        fontWeight: 700,
                        color: "var(--mira-ink)",
                        fontSize: 15,
                      }}
                    >
                      <dt>Final total</dt>
                      <dd style={{ margin: 0 }}>{fmtMoney(applied.total, applied.currency)}{plan.per}</dd>
                    </div>
                  </dl>
                  <p style={{ fontSize: 12, color: "var(--mira-slate)", margin: "8px 0 0" }}>
                    Applied after your 14-day free trial. No charge today.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* -- Connect her to WhatsApp - collected here, at the purchase ---
              GATE C1 (decisions#340): the risk copy is on screen BEFORE the
              number field, not after it and not behind a link. The wording is
              IMPORTED, never restated - WhatsAppDisclosure is the single
              approved C1 surface (specs#160), so this page renders that
              component instead of paraphrasing it. It sits directly above the
              pay button, so the last thing read before paying is what
              connecting a number risks. */}
          {!isTrial && (
            <div style={{ marginTop: 22, paddingTop: 22, borderTop: "1px solid var(--mira-fog)" }}>
              <WhatsAppDisclosure value={consent} onChange={setConsent} />

              <div style={{ marginTop: 24 }}>
                <label
                  htmlFor="wa-number"
                  style={{ display: "block", fontSize: 13, color: "var(--mira-graphite)", marginBottom: 6 }}
                >
                  Your WhatsApp number
                </label>
                <input
                  id="wa-number"
                  style={{
                    ...input,
                    border: `1px solid ${phoneError ? "var(--mira-rose)" : "var(--mira-fog)"}`,
                  }}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+971 50 123 4567"
                  maxLength={24}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onBlur={() => setPhoneTouched(true)}
                  aria-invalid={phoneError ? true : undefined}
                  aria-describedby={phoneError ? "wa-number-error" : "wa-number-hint"}
                />
                {phoneError ? (
                  <p
                    id="wa-number-error"
                    role="alert"
                    style={{ fontSize: 13, color: "var(--mira-rose-ink)", margin: "10px 0 0", lineHeight: 1.5 }}
                  >
                    {phoneError}
                  </p>
                ) : (
                  <p
                    id="wa-number-hint"
                    style={{ fontSize: 12.5, color: "var(--mira-slate)", margin: "10px 0 0", lineHeight: 1.5 }}
                  >
                    {phoneE164
                      ? `We'll connect her to ${phoneE164}.`
                      : `A local number is fine — we'll add +${DEFAULT_CALLING_CODE} for you. For anywhere else, start with + and your country code.`}
                  </p>
                )}
                {consentAttempted && !consentComplete && (
                  <p
                    role="alert"
                    style={{ fontSize: 13, color: "var(--mira-rose-ink)", margin: "12px 0 0", lineHeight: 1.5 }}
                  >
                    Please tick the three required boxes above. We can&apos;t connect a number until
                    you&apos;ve confirmed you understand what WhatsApp can do to it.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* The button is deliberately NOT disabled on validation grounds. A
              dead button that says nothing is how someone ends up handing over
              a number without ever reading the risk - pressing it refuses out
              loud instead, and the refusal is the gate inside payWithProvider. */}
          <button
            type="submit"
            className="btn-mira"
            disabled={paying}
            style={{ width: "100%", marginTop: 20, justifyContent: "center", fontSize: 15.5, padding: "15px", opacity: paying ? 0.7 : 1, cursor: paying ? "wait" : "pointer" }}
          >
            {paying
              ? isTrial
                ? "Taking you there…"
                : "Confirming…"
              : isTrial
                ? "Continue — connect WhatsApp →"
                : "Start free trial & meet Mira →"}
          </button>
          <p style={{ textAlign: "center", fontSize: 12, color: "var(--mira-slate)", margin: "12px 0 0" }}>
            {isTrial
              ? "No card required — cancel anytime. On the next step you'll enter your WhatsApp number and read the connection notice; nothing is connected until you agree to it."
              : `14-day free trial, then ${plan.price}${plan.per ?? "/mo"} — no charge for 14 days. You'll confirm your card on our payment provider's secure checkout. Cancel anytime.`}
          </p>
        </form>
      </div>
    </main>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<main style={{ padding: "80px 24px", textAlign: "center", color: "var(--mira-slate)" }}>Loading…</main>}>
      <Checkout />
    </Suspense>
  );
}
