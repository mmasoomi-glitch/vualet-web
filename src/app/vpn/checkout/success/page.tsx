import Link from "next/link";

export default function VpnSuccessPage() {
  return (
    <div style={{ background: "var(--mira-cream)", color: "var(--mira-ink)", minHeight: "100vh" }}>
      <section style={{ maxWidth: 520, margin: "0 auto", padding: "120px 24px 48px", textAlign: "center" }}>
        <div className="mira-aura" aria-hidden style={{ width: 92, height: 92, margin: "0 auto 24px", borderRadius: "50%", background: "var(--mira-grad-aura)", filter: "blur(20px)", opacity: 0.6 }} />
        <h1 className="display" style={{ fontSize: "clamp(28px,4vw,40px)", lineHeight: 1.15, margin: "0 0 14px" }}>Almost done.</h1>
        <p style={{ fontSize: 16, color: "var(--mira-graphite)", lineHeight: 1.6, marginBottom: 28 }}>We're confirming your payment — this takes a minute or two for crypto, a few minutes for cards. Your activation code arrives in your inbox the moment we see the funds.</p>
        <Link className="btn-mira" href="/vpn/get">Download Mira VPN →</Link>
        <p style={{ marginTop: 30, fontSize: 13, color: "var(--mira-slate)", lineHeight: 1.5 }}>
          Didn't get the email within an hour? Check spam, or Telegram Vualet support. Your payment may still be confirming on-chain.
        </p>
      </section>
    </div>
  );
}
