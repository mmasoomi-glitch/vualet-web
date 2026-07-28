"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Stepper } from "../_components/Stepper";
import { tierById, TIERS } from "../_components/tiers";

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

  // Promotion code: validated server-side against Stripe before it's applied.
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

  async function payTrial() {
    // No-card path: mint a connect token so the persona chosen on /mira/start
    // rides through to the Telegram bot.
    const setup = readSetup();
    try {
      const res = await fetch("/api/begin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: plan.id, email: email || undefined, setup }),
      });
      const data = (await res.json()) as { token?: string; botUrl?: string };
      if (data.token) {
        if (data.botUrl) localStorage.setItem("mira_bot_url", data.botUrl);
        router.push(`/mira/welcome?token=${data.token}`);
        return;
      }
      setError("Couldn't start your free plan. Try again.");
    } catch {
      setError("Something went wrong. Try again.");
    }
  }

  async function payWithStripe() {
    // Real charge: create a Stripe hosted-checkout session and hand off to it.
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
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
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
      await payTrial();
    } else {
      await payWithStripe();
    }
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
            ? "Review your plan — no card needed. Cancel anytime."
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

        {/* Email capture + handoff to Stripe's hosted checkout */}
        <form onSubmit={pay} style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--mira-slate)", marginBottom: 14 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--mira-success)" }} />
            {isTrial ? "No card needed to start" : "Secure checkout · powered by Stripe"}
          </div>
          <label style={{ display: "block", fontSize: 13, color: "var(--mira-graphite)", marginBottom: 6 }}>Email</label>
          <input
            style={input}
            type="email"
            inputMode="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required={!isTrial}
            autoComplete="email"
          />
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

          <button
            type="submit"
            className="btn-mira"
            disabled={paying}
            style={{ width: "100%", marginTop: 20, justifyContent: "center", fontSize: 15.5, padding: "15px", opacity: paying ? 0.7 : 1, cursor: paying ? "wait" : "pointer" }}
          >
            {paying
              ? "Confirming…"
              : isTrial
                ? "Start free & meet Mira →"
                : "Start free trial & meet Mira →"}
          </button>
          <p style={{ textAlign: "center", fontSize: 12, color: "var(--mira-slate)", margin: "12px 0 0" }}>
            {isTrial
              ? "No card required — cancel anytime."
              : `14-day free trial, then ${plan.price}${plan.per ?? "/mo"} — no charge for 14 days. You'll confirm your card on Stripe's secure checkout. Cancel anytime.`}
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
