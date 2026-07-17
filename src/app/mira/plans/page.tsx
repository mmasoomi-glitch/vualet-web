"use client";

import Link from "next/link";
import { useState } from "react";
import { TIERS } from "../_components/tiers";
import { Stepper } from "../_components/Stepper";

export default function MiraPlans() {
  const [selected, setSelected] = useState<string>("assistant");
  const [busy, setBusy] = useState(false);

  async function startCheckout() {
    // Free needs no card → mint a connect token and go straight to welcome.
    // Paid → the payment step.
    if (selected !== "free") {
      window.location.href = `/mira/checkout?plan=${selected}`;
      return;
    }
    setBusy(true);
    let setup: Record<string, unknown> = {};
    try {
      setup = JSON.parse(localStorage.getItem("mira_setup") || "{}");
    } catch {
      // no setup saved — she'll ask who to be in chat
    }
    try {
      const res = await fetch("/api/begin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "free", setup }),
      });
      const data = await res.json();
      if (res.ok && data?.token) {
        window.location.href = `/mira/welcome?token=${encodeURIComponent(data.token)}`;
        return;
      }
    } catch {
      // fall through to tokenless welcome rather than dead-ending the funnel
    }
    setBusy(false);
    window.location.href = "/mira/welcome";
  }

  return (
    <main className="mira-plans-pad" style={{ maxWidth: 1080, width: "100%", minWidth: 0, boxSizing: "border-box", margin: "0 auto", padding: "48px 24px 80px" }}>
      <Stepper current={2} />
      <header style={{ textAlign: "center", marginBottom: 36 }}>
        <h1 className="display" style={{ fontSize: "clamp(30px,5vw,48px)", margin: "0 0 8px" }}>
          Choose how far <span className="grad">she goes</span>
        </h1>
        <p style={{ color: "var(--mira-graphite)", fontSize: 16, maxWidth: 520, margin: "0 auto" }}>
          Free every month — a million tokens on the house. Upgrade only when she&apos;s already earned it.
        </p>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(min(220px,100%),1fr))",
          gap: 16,
          minWidth: 0,
        }}
      >
        {TIERS.map((t) => {
          const isSel = selected === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelected(t.id)}
              style={{
                textAlign: "left",
                cursor: "pointer",
                background: "var(--mira-cream)",
                border: `1.5px solid ${isSel ? "var(--mira-rose)" : t.featured ? "var(--mira-rose-light)" : "var(--mira-fog)"}`,
                borderRadius: "var(--mira-radius-lg)",
                padding: 24,
                boxShadow: isSel ? "var(--mira-shadow-lg)" : t.featured ? "var(--mira-shadow-md)" : "none",
                transition: "border-color .2s, box-shadow .2s, transform .2s",
                transform: isSel ? "translateY(-2px)" : "none",
                position: "relative",
              }}
            >
              {t.featured && (
                <span style={{ position: "absolute", top: 16, right: 16, fontSize: 11, fontWeight: 600, color: "#fff", background: "var(--mira-grad-presence)", borderRadius: 999, padding: "3px 10px" }}>
                  Most loved
                </span>
              )}
              <p style={{ fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--mira-rose-deep)", fontWeight: 600, margin: 0 }}>{t.name}</p>
              <p className="display" style={{ fontSize: 34, fontWeight: 400, margin: "8px 0 0", display: "flex", alignItems: "baseline", gap: 4 }}>
                {t.price}
                {t.per && <span style={{ fontSize: 14, color: "var(--mira-slate)" }}>{t.per}</span>}
              </p>
              <p style={{ fontSize: 12, color: "var(--mira-slate)", margin: 0 }}>{t.sub}</p>
              <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 0", fontSize: 14, color: "var(--mira-graphite)" }}>
                {t.items.map((it) => (
                  <li key={it} style={{ padding: "3px 0" }}>✓ {it}</li>
                ))}
              </ul>
              <div
                aria-hidden
                style={{
                  marginTop: 18,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                  fontWeight: 500,
                  color: isSel ? "var(--mira-rose-deep)" : "var(--mira-slate)",
                }}
              >
                <span
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    border: `1.5px solid ${isSel ? "var(--mira-rose)" : "var(--mira-fog)"}`,
                    background: isSel ? "var(--mira-grad-presence)" : "transparent",
                    display: "grid",
                    placeItems: "center",
                    color: "#fff",
                    fontSize: 10,
                  }}
                >
                  {isSel ? "✓" : ""}
                </span>
                {isSel ? "Selected" : "Select"}
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ textAlign: "center", marginTop: 36 }}>
        <button
          type="button"
          className="btn-mira"
          onClick={startCheckout}
          disabled={busy}
          style={{ minWidth: 240, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.7 : 1 }}
        >
          {busy
            ? "Waking her up…"
            : selected === "free"
              ? "Start free →"
              : `Continue with ${TIERS.find((t) => t.id === selected)?.name} →`}
        </button>
        <p style={{ fontSize: 13, color: "var(--mira-slate)", margin: "14px 0 0" }}>
          No card needed to start free · Secure checkout by Stripe · Cancel anytime
        </p>
        <p style={{ fontSize: 14, color: "var(--mira-graphite)", margin: "20px 0 0" }}>
          Haven&apos;t shaped her yet? <Link href="/mira/start" style={{ color: "var(--mira-rose-deep)" }}>Start here →</Link>
        </p>
      </div>
    </main>
  );
}
