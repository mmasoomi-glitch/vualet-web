"use client";
import { useState } from "react";

export default function VpnCheckoutPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError(null);
    try {
      const r = await fetch("/api/vpn/checkout/crypto", {
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
      <section style={{ maxWidth: 520, margin: "0 auto", padding: "84px 24px 48px" }}>
        <img src="/mira/mira-wordmark-color.svg" alt="Mira" style={{ height: 30, display: "block", margin: "0 auto 16px" }} />
        <h1 className="display" style={{ fontSize: "clamp(28px,4vw,40px)", margin: "0 0 8px", textAlign: "center" }}>Mira VPN — $9.99/mo</h1>
        <p style={{ textAlign: "center", color: "var(--mira-graphite)", marginBottom: 28, fontSize: 14 }}>5 Mbps · no ads · up to 3 devices · cancel anytime · pay with crypto or card</p>

        <form onSubmit={handleSubmit} style={{ background: "var(--mira-canvas)", border: "1px solid var(--mira-fog)", borderRadius: "var(--mira-radius-lg)", padding: 28, boxShadow: "var(--mira-shadow-sm)" }}>
          <label style={{ display: "block", fontSize: 13, color: "var(--mira-graphite)", marginBottom: 6 }}>Where should we send your activation code?</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
            style={{ width: "100%", padding: "12px 14px", borderRadius: "var(--mira-radius-md)", border: "1px solid var(--mira-fog)", fontSize: 15, fontFamily: "var(--mira-font-ui)", background: "white", color: "var(--mira-ink)", marginBottom: 20 }} />
          <button type="submit" disabled={loading} className="btn-mira" style={{ width: "100%", border: "none", cursor: "pointer", opacity: loading ? 0.6 : 1 }}>
            {loading ? "Redirecting…" : "Pay with NowPayments →"}
          </button>
          {error && <p style={{ marginTop: 16, fontSize: 13, color: "var(--mira-error)" }}>{error}</p>}
        </form>
        <p style={{ fontSize: 12, color: "var(--mira-slate)", textAlign: "center", marginTop: 20, lineHeight: 1.5 }}>
          Powered by NowPayments — pay with USDT (TRC-20), BTC, ETH, and 200+ coins, or card. Activation code lands in your inbox within minutes of confirmation. Operated by Vualet.
        </p>
      </section>
    </div>
  );
}
