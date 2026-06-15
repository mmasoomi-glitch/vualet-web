"use client";

import Link from "next/link";
import { useState } from "react";
import { TIERS } from "../_components/tiers";

export default function MiraPlans() {
  const [selected, setSelected] = useState<string>("assistant");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function startCheckout() {
    setNotice(null);
    if (selected === "trial") {
      window.location.href = "/mira/welcome";
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: selected }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url; // Dodo hosted checkout
        return;
      }
      setNotice(
        data.error === "not_configured"
          ? "Card payments switch on shortly — start the free trial meanwhile."
          : "Couldn't start checkout just now. Please try again.",
      );
    } catch {
      setNotice("Network hiccup — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 1080, margin: "0 auto", padding: "56px 24px 80px" }}>
      <header style={{ textAlign: "center", marginBottom: 36 }}>
        <h1 className="display" style={{ fontSize: "clamp(30px,5vw,48px)", margin: "0 0 8px" }}>
          Choose how far <span className="grad">she goes</span>
        </h1>
        <p style={{ color: "var(--mira-graphite)", fontSize: 16, maxWidth: 520, margin: "0 auto" }}>
          Start free for an hour. Upgrade only when she&apos;s already earned it.
        </p>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
          gap: 16,
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
          style={{ minWidth: 240, opacity: busy ? 0.7 : 1, cursor: busy ? "wait" : "pointer" }}
        >
          {busy
            ? "Opening secure checkout…"
            : selected === "trial"
              ? "Start free →"
              : `Continue with ${TIERS.find((t) => t.id === selected)?.name} →`}
        </button>
        {notice && (
          <p style={{ fontSize: 13.5, color: "var(--mira-rose-deep)", margin: "12px 0 0" }}>{notice}</p>
        )}
        <p style={{ fontSize: 13, color: "var(--mira-slate)", margin: "14px 0 0" }}>
          No card needed to start the trial · Secure checkout by Dodo · Cancel anytime
        </p>
        <p style={{ fontSize: 14, color: "var(--mira-graphite)", margin: "20px 0 0" }}>
          Haven&apos;t shaped her yet? <Link href="/mira/start" style={{ color: "var(--mira-rose-deep)" }}>Start here →</Link>
        </p>
      </div>
    </main>
  );
}
