"use client";

import { useState } from "react";

type PayMethod = "card" | "crypto";

export default function MiraVpnCheckoutPage() {
  const [method, setMethod] = useState<PayMethod>("card");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const endpoint =
        method === "card" ? "/api/vpn/checkout/card" : "/api/vpn/checkout/crypto";
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, plan: "mira-vpn-monthly" }),
      });
      if (!r.ok) throw new Error(await r.text());
      const { redirectUrl } = (await r.json()) as { redirectUrl: string };
      window.location.href = redirectUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  };

  return (
    <div style={{ background: "var(--mira-cream)", color: "var(--mira-ink)", minHeight: "100vh" }}>
      <section style={{ maxWidth: 560, margin: "0 auto", padding: "84px 24px 48px" }}>
        <img
          src="/mira/mira-wordmark-color.svg"
          alt="Mira"
          style={{ height: 30, marginBottom: 18, display: "block", margin: "0 auto 18px" }}
        />
        <h1
          className="display"
          style={{ fontSize: "clamp(28px,4vw,40px)", margin: "0 0 8px", textAlign: "center" }}
        >
          Mira VPN — $9/mo
        </h1>
        <p style={{ textAlign: "center", color: "var(--mira-graphite)", marginBottom: 32 }}>
          5 Mbps · no ads · up to 3 devices · cancel anytime
        </p>

        <form
          onSubmit={handleSubmit}
          style={{
            background: "var(--mira-canvas)",
            border: "1px solid var(--mira-fog)",
            borderRadius: "var(--mira-radius-lg)",
            padding: 28,
            boxShadow: "var(--mira-shadow-sm)",
          }}
        >
          <label
            style={{ display: "block", fontSize: 13, color: "var(--mira-graphite)", marginBottom: 6 }}
          >
            Where should we send your activation code?
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={{
              width: "100%",
              padding: "12px 14px",
              borderRadius: "var(--mira-radius-md)",
              border: "1px solid var(--mira-fog)",
              fontSize: 15,
              fontFamily: "var(--mira-font-ui)",
              background: "white",
              color: "var(--mira-ink)",
              marginBottom: 20,
            }}
          />

          <p style={{ fontSize: 13, color: "var(--mira-graphite)", marginBottom: 10 }}>
            Pay with
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 24 }}>
            <button
              type="button"
              onClick={() => setMethod("card")}
              style={{
                padding: "12px 16px",
                borderRadius: "var(--mira-radius-md)",
                border:
                  method === "card"
                    ? "2px solid var(--mira-rose)"
                    : "1px solid var(--mira-fog)",
                background: method === "card" ? "var(--mira-petal)" : "white",
                color: "var(--mira-ink)",
                fontWeight: 500,
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              Card (Dodo)
            </button>
            <button
              type="button"
              onClick={() => setMethod("crypto")}
              style={{
                padding: "12px 16px",
                borderRadius: "var(--mira-radius-md)",
                border:
                  method === "crypto"
                    ? "2px solid var(--mira-rose)"
                    : "1px solid var(--mira-fog)",
                background: method === "crypto" ? "var(--mira-petal)" : "white",
                color: "var(--mira-ink)",
                fontWeight: 500,
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              Crypto (USDT)
            </button>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-mira"
            style={{ width: "100%", border: "none", cursor: "pointer", opacity: loading ? 0.6 : 1 }}
          >
            {loading ? "Redirecting…" : `Continue to ${method === "card" ? "Dodo" : "NowPayments"} →`}
          </button>

          {error && (
            <p style={{ marginTop: 16, fontSize: 13, color: "var(--mira-error)" }}>{error}</p>
          )}
        </form>

        <p
          style={{
            fontSize: 12,
            color: "var(--mira-slate)",
            textAlign: "center",
            marginTop: 24,
            lineHeight: 1.5,
          }}
        >
          Card payments via Dodo Payments. Crypto via NowPayments — accepted on the Tron network
          as USDT-TRC20. Your activation code is e-mailed within a few minutes of confirmation.
        </p>
      </section>
    </div>
  );
}
