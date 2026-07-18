"use client";

import Link from "next/link";
import { useState } from "react";
import { TIERS } from "../_components/tiers";

// Live selling state: paid tiers start a 14-day free trial via Stripe Checkout
// (card collected, not charged for 14 days). The free tier stays a no-card start.
export default function MiraPlans() {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(planId: string) {
    setError(null);
    setLoading(planId);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setError(data.message || "Couldn't start checkout. Please try again.");
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setLoading(null);
  }

  return (
    <main
      className="mira-plans-pad"
      style={{ maxWidth: 1080, width: "100%", minWidth: 0, boxSizing: "border-box", margin: "0 auto", padding: "48px 24px 80px" }}
    >
      <header style={{ textAlign: "center", marginBottom: 28 }}>
        <span
          style={{
            display: "inline-block",
            fontSize: 11.5,
            fontWeight: 600,
            letterSpacing: ".14em",
            textTransform: "uppercase",
            color: "var(--mira-rose-deep)",
            background: "var(--mira-rose-light)",
            border: "1px solid var(--mira-rose-light)",
            borderRadius: 999,
            padding: "4px 14px",
            marginBottom: 14,
          }}
        >
          14-day free trial
        </span>
        <h1 className="display" style={{ fontSize: "clamp(30px,5vw,48px)", margin: "0 0 8px" }}>
          Choose how far <span className="grad">she goes</span>
        </h1>
        <p style={{ color: "var(--mira-graphite)", fontSize: 16, maxWidth: 540, margin: "0 auto" }}>
          Start your 14-day free trial — no charge for 14 days, cancel anytime. Every plan includes a
          million tokens free, every month.
        </p>
      </header>

      {error && (
        <p role="alert" style={{ textAlign: "center", fontSize: 13.5, color: "var(--mira-rose-deep)", margin: "0 0 20px" }}>
          {error}
        </p>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(min(220px,100%),1fr))",
          gap: 16,
          minWidth: 0,
        }}
      >
        {TIERS.map((t) => {
          const paid = t.id !== "free";
          const busy = loading === t.id;
          return (
            <div
              key={t.id}
              style={{
                textAlign: "left",
                background: "var(--mira-cream)",
                border: `1.5px solid ${t.featured ? "var(--mira-rose-light)" : "var(--mira-fog)"}`,
                borderRadius: "var(--mira-radius-lg)",
                padding: 24,
                position: "relative",
              }}
            >
              {t.featured && (
                <span
                  style={{
                    position: "absolute",
                    top: 16,
                    right: 16,
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#fff",
                    background: "var(--mira-grad-presence)",
                    borderRadius: 999,
                    padding: "3px 10px",
                  }}
                >
                  Most complete
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
              <div style={{ marginTop: 18 }}>
                {paid ? (
                  <button
                    type="button"
                    className="btn-mira"
                    onClick={() => choose(t.id)}
                    disabled={Boolean(loading)}
                    style={{ width: "100%", justifyContent: "center", display: "inline-flex", fontSize: 14, opacity: loading && !busy ? 0.6 : 1, cursor: busy ? "wait" : "pointer" }}
                  >
                    {busy ? "Starting…" : t.cta}
                  </button>
                ) : (
                  <Link
                    href="/mira/checkout?plan=free"
                    className="btn-mira-soft"
                    style={{ width: "100%", justifyContent: "center", display: "inline-flex", fontSize: 14, textDecoration: "none" }}
                  >
                    {t.cta}
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ textAlign: "center", fontSize: 13.5, color: "var(--mira-slate)", margin: "24px 0 0" }}>
        Start your 14-day free trial — no charge for 14 days, cancel anytime.
      </p>
    </main>
  );
}
