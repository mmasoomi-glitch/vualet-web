import Link from "next/link";

export default function MiraVpnGetPage() {
  return (
    <div style={{ background: "var(--mira-cream)", color: "var(--mira-ink)", minHeight: "100vh" }}>
      <section style={{ maxWidth: 720, margin: "0 auto", padding: "84px 24px 48px", textAlign: "center" }}>
        <img src="/mira/mira-wordmark-color.svg" alt="Mira" style={{ height: 32, marginBottom: 20 }} />
        <h1 className="display" style={{ fontSize: "clamp(32px,5vw,52px)", lineHeight: 1.1, margin: "0 0 12px" }}>
          Get Mira VPN
        </h1>
        <p
          style={{
            fontSize: 17,
            color: "var(--mira-graphite)",
            lineHeight: 1.6,
            maxWidth: 520,
            margin: "0 auto 36px",
          }}
        >
          Free tier works from the moment you install — no card, no sign-up. Pick your platform.
        </p>

        <div className="mira-2col" style={{ maxWidth: 640, margin: "0 auto" }}>
          <a
            className="btn-mira"
            href="https://play.google.com/store/apps/details?id=com.vualet.mira"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "block", textAlign: "center" }}
          >
            Google Play (Android)
          </a>
          <a
            className="btn-mira-soft"
            href="/api/vpn/download?platform=android-sideload"
            style={{ display: "block", textAlign: "center" }}
          >
            Direct APK (sideload)
          </a>
        </div>

        <p style={{ fontSize: 13, color: "var(--mira-slate)", marginTop: 24 }}>
          iOS coming soon. Want notice when it lands?{" "}
          <Link href="/contact-sales" style={{ color: "var(--mira-rose-deep)" }}>
            Tell us
          </Link>
          .
        </p>

        <hr
          style={{
            margin: "48px auto",
            border: "none",
            borderTop: "1px solid var(--mira-fog)",
            maxWidth: 200,
          }}
        />

        <div style={{ textAlign: "left", maxWidth: 520, margin: "0 auto" }}>
          <p
            className="display"
            style={{ fontSize: 20, fontWeight: 400, margin: "0 0 12px", color: "var(--mira-ink)" }}
          >
            Sideload — quick steps
          </p>
          <ol style={{ paddingLeft: 22, fontSize: 14, color: "var(--mira-graphite)", lineHeight: 1.7 }}>
            <li>Tap the Direct APK button above to download.</li>
            <li>
              Settings → Apps → Special access → <em>Install unknown apps</em> → allow your browser.
            </li>
            <li>Open the downloaded file and install.</li>
            <li>Open Mira, tap <strong>Connect</strong>, accept the one-time VPN consent dialog.</li>
            <li>
              For paid tier: enter the activation code from{" "}
              <Link href="/mira-vpn/checkout" style={{ color: "var(--mira-rose-deep)" }}>
                checkout
              </Link>
              .
            </li>
          </ol>
        </div>
      </section>
    </div>
  );
}
