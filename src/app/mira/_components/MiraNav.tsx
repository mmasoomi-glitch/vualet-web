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
      <nav className="mira-navbar-row" aria-label="Primary">
        <Link href="/mira" aria-label="Mira home" style={{ display: "inline-flex", alignItems: "center", minWidth: 0, flexShrink: 0 }}>
          <img src="/mira/mira-wordmark-color.svg" alt="Mira" style={{ height: 22, maxWidth: "100%" }} />
        </Link>
        {/* At <=420px the Account link hides and the CTA shrinks (mira-theme.css) —
            flex-wrap alone doesn't reliably collapse this row at 320px because a
            wrapping flex container's intrinsic width is measured per-item, not as
            a sum, so the browser never judged this row "too wide" to wrap; explicit
            prioritization is the reliable fix. */}
        <div className="mira-navbar-links">
          <Link href="/mira/plans" className="mira-navlink" style={{ fontSize: 14, color: "var(--mira-graphite)", textDecoration: "none" }}>
            Plans
          </Link>
          <Link href="/mira/account" className="mira-navlink mira-nav-account" style={{ fontSize: 14, color: "var(--mira-graphite)", textDecoration: "none" }}>
            Account
          </Link>
          {cta && (
            <Link className="btn-mira mira-nav-cta" href="/mira/start">
              Start free
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
