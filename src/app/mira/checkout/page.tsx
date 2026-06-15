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
  const [paying, setPaying] = useState(false);

  function pay(e: React.FormEvent) {
    e.preventDefault();
    setPaying(true);
    // DEMO: no real charge. Real Dodo processing gets wired to this submit later.
    setTimeout(() => router.push("/mira/welcome"), 650);
  }

  return (
    <main style={{ maxWidth: 920, margin: "0 auto", padding: "48px 24px 80px" }}>
      <Stepper current={3} />
      <header style={{ textAlign: "center", marginBottom: 28 }}>
        <h1 className="display" style={{ fontSize: "clamp(28px,4.5vw,40px)", margin: "0 0 6px" }}>
          Almost <span className="grad">hers</span>
        </h1>
        <p style={{ color: "var(--mira-graphite)", fontSize: 15.5, margin: 0 }}>
          Review your plan and add a card. Cancel anytime.
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

        {/* Card form (demo) */}
        <form onSubmit={pay} style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--mira-slate)", marginBottom: 14 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--mira-success)" }} />
            Secure checkout · demo mode — no card is charged yet
          </div>
          <label style={{ display: "block", fontSize: 13, color: "var(--mira-graphite)", marginBottom: 6 }}>Card number</label>
          <input style={input} inputMode="numeric" placeholder="4242 4242 4242 4242" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
            <div>
              <label style={{ display: "block", fontSize: 13, color: "var(--mira-graphite)", marginBottom: 6 }}>Expiry</label>
              <input style={input} placeholder="MM / YY" />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 13, color: "var(--mira-graphite)", marginBottom: 6 }}>CVC</label>
              <input style={input} placeholder="123" />
            </div>
          </div>
          <label style={{ display: "block", fontSize: 13, color: "var(--mira-graphite)", margin: "14px 0 6px" }}>Name on card</label>
          <input style={input} placeholder="Maya Al Naseem" />
          <button
            type="submit"
            className="btn-mira"
            disabled={paying}
            style={{ width: "100%", marginTop: 20, justifyContent: "center", fontSize: 15.5, padding: "15px", opacity: paying ? 0.7 : 1, cursor: paying ? "wait" : "pointer" }}
          >
            {paying ? "Confirming…" : `Pay ${plan.price === "Free" ? "$0" : plan.price} & meet Mira →`}
          </button>
          <p style={{ textAlign: "center", fontSize: 12, color: "var(--mira-slate)", margin: "12px 0 0" }}>
            Payment processing is added next — this button completes onboarding for now.
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
