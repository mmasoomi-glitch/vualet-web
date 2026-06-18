import Link from "next/link";

export default function MiraVpnCheckoutSuccessPage() {
  return (
    <div style={{ background: "var(--mira-cream)", color: "var(--mira-ink)", minHeight: "100vh" }}>
      <section style={{ maxWidth: 560, margin: "0 auto", padding: "120px 24px 48px", textAlign: "center" }}>
        <div
          className="mira-aura"
          aria-hidden
          style={{
            width: 92,
            height: 92,
            margin: "0 auto 24px",
            borderRadius: "50%",
            background: "var(--mira-grad-aura)",
            filter: "blur(20px)",
            opacity: 0.6,
          }}
        />
        <h1
          className="display"
          style={{ fontSize: "clamp(28px,4vw,40px)", lineHeight: 1.15, margin: "0 0 14px" }}
        >
          Almost done.
        </h1>
        <p style={{ fontSize: 16, color: "var(--mira-graphite)", lineHeight: 1.6, marginBottom: 28 }}>
          We're confirming your payment with the network — this usually takes a minute or two for
          cards, up to a few minutes for crypto. Your activation code lands in your inbox the moment
          we see the funds.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <Link className="btn-mira" href="/mira-vpn/get">
            Download Mira VPN →
          </Link>
          <Link className="btn-mira-soft" href="/mira-vpn">
            Back to overview
          </Link>
        </div>
        <p style={{ marginTop: 30, fontSize: 13, color: "var(--mira-slate)", lineHeight: 1.5 }}>
          Didn't get the email within an hour? It might be in spam, or your payment may still be
          confirming on-chain.{" "}
          <Link href="/api/support" style={{ color: "var(--mira-rose-deep)" }}>
            Tell us
          </Link>{" "}
          and we'll look it up.
        </p>
      </section>
    </div>
  );
}
