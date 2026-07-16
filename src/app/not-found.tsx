import Link from "next/link";
import "./mira/mira-theme.css";

// Branded 404 — replaces the default Next.js black/white error page with the
// Mira cream/plum brand (Fraunces display face, warm ink) so a mistyped or
// dead link doesn't dump visitors onto an unbranded page.
export default function NotFound() {
  return (
    <div className="mira-root" style={{ minHeight: "70vh" }}>
      <main
        style={{
          minHeight: "70vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "64px 24px",
        }}
      >
        <p
          className="display"
          style={{ fontSize: "clamp(56px,12vw,120px)", lineHeight: 1, margin: 0, color: "var(--mira-rose-deep)" }}
        >
          404
        </p>
        <h1 className="display" style={{ fontSize: "clamp(24px,4vw,34px)", margin: "18px 0 8px", fontWeight: 400 }}>
          This page wandered off.
        </h1>
        <p style={{ color: "var(--mira-graphite)", fontSize: 16, maxWidth: 440, margin: "0 0 32px", lineHeight: 1.6 }}>
          We couldn&apos;t find what you were looking for. Let&apos;s get you back
          somewhere useful.
        </p>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center" }}>
          <Link className="btn-mira" href="/mira">
            Back to Mira
          </Link>
          <Link className="btn-mira-soft" href="/">
            Vualet home
          </Link>
        </div>
      </main>
    </div>
  );
}
