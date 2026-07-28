import Connect from "./_components/Connect";

export const metadata = {
  title: "Mira VPN — coming soon",
  description:
    "Fast, private access that just works. Mira VPN is coming soon — here's an early preview of how connecting will feel.",
};

export default function MiraVpnPage() {
  return (
    <main id="mira-main" style={{ maxWidth: 640, margin: "0 auto", padding: "56px 24px 90px" }}>
      <header style={{ textAlign: "center", marginBottom: 28 }}>
        <span
          style={{
            display: "inline-block",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: ".08em",
            textTransform: "uppercase",
            color: "var(--mira-slate)",
            border: "1px solid var(--mira-fog)",
            borderRadius: 999,
            padding: "4px 12px",
          }}
        >
          Coming soon · preview
        </span>
        <h1
          className="display"
          style={{ fontSize: "clamp(30px,5vw,46px)", margin: "16px 0 0" }}
        >
          Mira <span className="grad">VPN</span>
        </h1>
        <p
          style={{
            color: "var(--mira-graphite)",
            fontSize: 16.5,
            margin: "14px auto 0",
            maxWidth: 480,
            lineHeight: 1.6,
          }}
        >
          Fast, private access that just works — wherever you are. Mira VPN
          isn&apos;t available yet. Here&apos;s an early preview of how connecting
          will feel once it&apos;s live.
        </p>
      </header>

      <Connect />

      <p
        style={{
          textAlign: "center",
          color: "var(--mira-slate)",
          fontSize: 13,
          margin: "20px auto 0",
          maxWidth: 460,
          lineHeight: 1.6,
        }}
      >
        This is a preview — access links aren&apos;t being issued yet. Everything
        above runs on your device; nothing is sent to our servers.
      </p>
    </main>
  );
}
