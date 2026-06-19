import Link from "next/link";

export default function VpnGetPage() {
  return (
    <div style={{ background: "var(--mira-cream)", color: "var(--mira-ink)", minHeight: "100vh" }}>
      <section style={{ maxWidth: 660, margin: "0 auto", padding: "84px 24px 48px", textAlign: "center" }}>
        <img src="/mira/mira-wordmark-color.svg" alt="Mira" style={{ height: 32, marginBottom: 20 }} />
        <h1 className="display" style={{ fontSize: "clamp(32px,5vw,52px)", lineHeight: 1.1, margin: "0 0 12px" }}>Get Mira VPN</h1>
        <p style={{ fontSize: 17, color: "var(--mira-graphite)", maxWidth: 500, margin: "0 auto 30px", lineHeight: 1.6 }}>Free tier works the moment you install — no sign-up. For full speed, subscribe below.</p>

        <div className="mira-2col" style={{ maxWidth: 600, margin: "0 auto" }}>
          <a className="btn-mira" href="https://play.google.com/store/apps/details?id=com.vualet.mira" target="_blank" rel="noopener noreferrer" style={{ display: "block", textAlign: "center" }}>Google Play (Android)</a>
          <a className="btn-mira-soft" href="/api/vpn/download?platform=android-sideload" style={{ display: "block", textAlign: "center" }}>Direct APK (sideload)</a>
        </div>

        <p style={{ fontSize: 13, color: "var(--mira-slate)", marginTop: 20 }}>iOS coming to TestFlight soon.</p>

        <div style={{ marginTop: 30, background: "var(--mira-canvas)", border: "2px solid var(--mira-lavender)", borderRadius: "var(--mira-radius-lg)", padding: 24, maxWidth: 500, margin: "30px auto 0" }}>
          <p className="display" style={{ fontSize: 20, fontWeight: 400, margin: "0 0 6px" }}>Windows</p>
          <p style={{ fontSize: 14, color: "var(--mira-graphite)", marginBottom: 14 }}>Graphical installer — pick a folder, click Install, done. No command line.</p>
          <a className="btn-mira" href="/vpn/setup.exe" style={{ display: "inline-block", textAlign: "center", fontSize: 14 }}>Download Setup →</a>
          <p style={{ fontSize: 11, color: "var(--mira-slate)", marginTop: 8 }}>71 MB · Windows 10/11 · Double-click to install</p>
        </div>

        <hr style={{ margin: "40px auto", border: "none", borderTop: "1px solid var(--mira-fog)", maxWidth: 200 }} />

        <div style={{ textAlign: "left", maxWidth: 500, margin: "0 auto" }}>
          <p className="display" style={{ fontSize: 20, fontWeight: 400, margin: "0 0 12px" }}>Sideload steps</p>
          <ol style={{ paddingLeft: 22, fontSize: 14, color: "var(--mira-graphite)", lineHeight: 1.7 }}>
            <li>Tap the Direct APK button above to download.</li>
            <li>Settings → Apps → Special access → <em>Install unknown apps</em> → allow your browser.</li>
            <li>Open the downloaded file and install.</li>
            <li>Open Mira, tap <strong>Connect</strong>, accept the one-time VPN consent dialog.</li>
            <li>For paid: enter the activation code from{" "}<Link href="/vpn/checkout" style={{ color: "var(--mira-rose-deep)" }}>checkout</Link>.</li>
          </ol>
        </div>
      </section>
    </div>
  );
}
