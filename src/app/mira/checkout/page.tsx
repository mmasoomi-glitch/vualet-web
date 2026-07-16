"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Stepper } from "../_components/Stepper";
import { tierById, TIERS } from "../_components/tiers";

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
  const isTrial = plan.id === "trial";
  const [paying, setPaying] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

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
      setError("Couldn't start your trial. Try again.");
    } catch {
      setError("Something went wrong. Try again.");
    }
  }

  async function payWithDodo() {
    // Real charge: create a Dodo hosted-checkout session and hand off to it.
    const setup = readSetup();
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: plan.id,
          email: email || undefined,
          persona: typeof setup.persona === "string" ? setup.persona : undefined,
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
      await payWithDodo();
    }
    setPaying(false);
  }

  return (
    <main style={{ maxWidth: 920, margin: "0 auto", padding: "48px 24px 80px" }}>
      <Stepper current={3} />
      <header style={{ textAlign: "center", marginBottom: 28 }}>
        <h1 className="display" style={{ fontSize: "clamp(28px,4.5vw,40px)", margin: "0 0 6px" }}>
          Almost <span className="grad">hers</span>
        </h1>
        <p style={{ color: "var(--mira-graphite)", fontSize: 15.5, margin: 0 }}>
          {isTrial ? "Review your plan — no card needed. Cancel anytime." : "Review your plan and continue to secure checkout. Cancel anytime."}
        </p>
      </header>

      <div className="mira-2col">
        {/* Order summary */}
        <section style={card}>
          <p style={{ fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--mira-rose-deep)", fontWeight: 600, margin: 0 }}>
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
            <span className="display" style={{ fontSize: 22 }}>{plan.price === "Free" ? "$0" : plan.price}</span>
          </div>
          <Link href="/mira/plans" style={{ fontSize: 13, color: "var(--mira-rose-deep)", display: "inline-block", marginTop: 12 }}>
            ← Change plan
          </Link>
        </section>

        {/* Email capture + handoff to Dodo's hosted checkout */}
        <form onSubmit={pay} style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--mira-slate)", marginBottom: 14 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--mira-success)" }} />
            {isTrial ? "No card needed to start" : "Secure checkout · powered by Dodo Payments"}
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
            <p role="alert" style={{ fontSize: 13, color: "var(--mira-rose-deep)", margin: "12px 0 0" }}>
              {error}
            </p>
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
                : `Pay ${plan.price} & meet Mira →`}
          </button>
          <p style={{ textAlign: "center", fontSize: 12, color: "var(--mira-slate)", margin: "12px 0 0" }}>
            {isTrial
              ? "No card required — cancel anytime."
              : "You'll complete payment on Dodo's secure checkout page. Cancel anytime."}
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
