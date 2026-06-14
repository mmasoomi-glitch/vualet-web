import Link from "next/link";

/** Shared lightweight Mira nav. Server component (no interactivity needed). */
export default function MiraNav({ cta = true }: { cta?: boolean }) {
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        background: "color-mix(in srgb, var(--mira-cream) 82%, transparent)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--mira-fog)",
      }}
    >
      <nav
        style={{
          maxWidth: 1080,
          margin: "0 auto",
          padding: "14px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <Link href="/mira" aria-label="Mira home" style={{ display: "inline-flex", alignItems: "center" }}>
          <img src="/mira/mira-wordmark-color.svg" alt="Mira" style={{ height: 22 }} />
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Link href="/mira/plans" className="mira-navlink" style={{ fontSize: 14, color: "var(--mira-graphite)", textDecoration: "none" }}>
            Plans
          </Link>
          <Link href="/mira/account" className="mira-navlink" style={{ fontSize: 14, color: "var(--mira-graphite)", textDecoration: "none" }}>
            Account
          </Link>
          {cta && (
            <Link className="btn-mira" href="/mira/start" style={{ padding: "9px 18px", fontSize: 14 }}>
              Shape your Mira
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
