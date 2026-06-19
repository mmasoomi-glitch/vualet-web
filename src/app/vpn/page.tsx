import Link from "next/link";

const card: React.CSSProperties = {
  background: "var(--mira-canvas)",
  border: "1px solid var(--mira-fog)",
  borderRadius: "var(--mira-radius-lg)",
  boxShadow: "var(--mira-shadow-sm)",
};

const TIERS = [
  {
    name: "Free", price: "$0", sub: "everyday messaging", href: "/vpn/get",
    items: ["500 kbps · ad-supported", "2-hour sessions", "1 device", "No sign-up needed"],
  },
  {
    name: "Mira VPN", price: "$9.99", sub: "per month · smooth video", href: "/vpn/checkout", featured: true,
    items: ["5 Mbps per device", "Smart server selection", "Up to 3 devices", "No ads · banking Pause"],
  },
];

export default function VpnPage() {
  return (
    <div style={{ background: "var(--mira-cream)", color: "var(--mira-ink)" }}>
      <section style={{ position: "relative", overflow: "hidden", textAlign: "center" }}>
        <div className="mira-aura" aria-hidden style={{ position: "absolute", inset: "-8% 0 auto 0", height: 520, margin: "auto", zIndex: 0, background: "var(--mira-grad-aura)", filter: "blur(80px)", opacity: 0.35 }} />
        <div style={{ position: "relative", zIndex: 1, maxWidth: 1080, margin: "0 auto", padding: "84px 24px 48px" }}>
          <img src="/mira/mira-wordmark-color.svg" alt="Mira" style={{ height: 32, marginBottom: 20 }} />
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--mira-graphite)", background: "var(--mira-frost)", borderRadius: 999, padding: "7px 14px" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--mira-rose)" }} /> Free forever · No credit card · Crypto or card payment
          </div>
          <h1 className="display" style={{ fontSize: "clamp(40px,7vw,72px)", lineHeight: 1.05, margin: "22px auto 0", maxWidth: "16ch" }}>
            Your private connection.<br /><span className="grad">Mira picks the server.</span>
          </h1>
          <p style={{ fontSize: "clamp(17px,2.2vw,21px)", color: "var(--mira-graphite)", maxWidth: 600, margin: "22px auto 0", lineHeight: 1.6 }}>
            An always-on privacy layer. Mira measures latency to nearby servers and connects you to the fastest one — no list, no country picker, no guesswork.
          </p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", marginTop: 34, flexWrap: "wrap" }}>
            <Link className="btn-mira" href="/vpn/get">Get the app — free →</Link>
            <Link className="btn-mira-soft" href="#tiers">See plans</Link>
          </div>
          <p style={{ marginTop: 16, fontSize: 13, color: "var(--mira-slate)" }}>Android available · iOS in TestFlight · Cancel any time</p>
        </div>
      </section>

      <section id="tiers" style={{ borderTop: "1px solid var(--mira-fog)" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "72px 24px" }}>
          <h2 className="display" style={{ fontSize: "clamp(28px,4vw,40px)", margin: "0 0 12px", textAlign: "center" }}>One free, one paid. Both private.</h2>
          <p style={{ fontSize: 15, color: "var(--mira-graphite)", textAlign: "center", maxWidth: 560, margin: "0 auto 36px" }}>Start free, forever, same encryption, same servers. Upgrade only when you need full speed.</p>
          <div className="mira-2col">
            {TIERS.map((t) => (
              <div key={t.name} style={{ ...card, padding: 32, borderColor: t.featured ? "var(--mira-rose)" : "var(--mira-fog)", boxShadow: t.featured ? "var(--mira-shadow-md)" : "var(--mira-shadow-sm)", position: "relative" }}>
                {t.featured && <span style={{ position: "absolute", top: -12, right: 18, background: "var(--mira-rose)", color: "white", fontSize: 12, padding: "4px 12px", borderRadius: 999, fontWeight: 500 }}>Recommended</span>}
                <p className="display" style={{ fontSize: 22, fontWeight: 400, margin: 0 }}>{t.name}</p>
                <p style={{ fontSize: 13, color: "var(--mira-slate)", marginTop: 4 }}>{t.sub}</p>
                <p className="display" style={{ fontSize: 44, fontWeight: 300, margin: "18px 0 22px" }}>{t.price}{t.featured && <span style={{ fontSize: 16, color: "var(--mira-slate)" }}> /mo</span>}</p>
                <ul style={{ listStyle: "none", padding: 0, margin: "0 0 24px", fontSize: 14 }}>
                  {t.items.map((item) => <li key={item} style={{ padding: "6px 0", color: "var(--mira-graphite)" }}>· {item}</li>)}
                </ul>
                <Link className={t.featured ? "btn-mira" : "btn-mira-soft"} href={t.href}>{t.featured ? "Subscribe now" : "Download"}</Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ borderTop: "1px solid var(--mira-fog)", background: "var(--mira-canvas)" }}>
        <div style={{ maxWidth: 880, margin: "0 auto", padding: "56px 24px", textAlign: "center" }}>
          <p className="display" style={{ fontSize: "clamp(22px,3vw,32px)", fontWeight: 400, margin: "0 0 14px" }}>Banking apps that block VPNs? Mira pauses for them.</p>
          <p style={{ fontSize: 15, color: "var(--mira-graphite)", lineHeight: 1.6, margin: "0 auto", maxWidth: 600 }}>One toggle pauses Mira so your bank can verify your device. Per-app Direct list keeps your banking apps outside the tunnel while everything else stays protected.</p>
        </div>
      </section>

      <footer style={{ borderTop: "1px solid var(--mira-fog)", padding: "32px 24px", textAlign: "center", fontSize: 13, color: "var(--mira-slate)" }}>
        Mira VPN · powered by <strong>Vualet</strong> · <a href="https://vualet.com" style={{ color: "var(--mira-rose-deep)" }}>vualet.com</a>
      </footer>
    </div>
  );
}
