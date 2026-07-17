import Link from "next/link";
import VeridianChat from "./VeridianChat";

export default function VeridianPage() {
  return (
    <div style={{ background: "var(--mira-cream)", color: "var(--mira-ink)", minHeight: "100vh" }}>
      {/* Visible focus indicator for the chat input + suggestion chips (WCAG 2.4.7).
          Scoped to this page; reduced-motion is respected by the theme's own rules. */}
      <style>{`
        .veridian-wrap input:focus-visible,
        .veridian-wrap button:focus-visible,
        .veridian-wrap a:focus-visible {
          outline: 2px solid var(--aether);
          outline-offset: 2px;
          border-radius: 6px;
        }
      `}</style>

      <div
        className="veridian-wrap"
        style={{
          maxWidth: 760,
          width: "100%",
          minWidth: 0,
          boxSizing: "border-box",
          margin: "0 auto",
          padding: "56px 20px 72px",
        }}
      >
        {/* Header */}
        <header style={{ textAlign: "center", marginBottom: 22 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              color: "var(--mira-graphite)",
              background: "var(--mira-frost)",
              borderRadius: 999,
              padding: "7px 14px",
            }}
          >
            <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--mira-rose)" }} />
            Live product demo
          </div>
          <h1
            className="display"
            style={{ fontSize: "clamp(32px,6vw,52px)", lineHeight: 1.08, margin: "18px auto 12px", maxWidth: "16ch" }}
          >
            Ask Mira <span className="grad">anything it knows</span>
          </h1>
          <p style={{ color: "var(--mira-graphite)", fontSize: 16, lineHeight: 1.6, maxWidth: "52ch", margin: "0 auto" }}>
            This demo answers only from a curated set of facts about the product. If it doesn&apos;t know
            something, it says so instead of guessing — a small illustration of grounded AI that doesn&apos;t
            make things up.
          </p>
        </header>

        {/* Canonical Memory banner — the headline proof. Reuses the Recall-Ledger
            aesthetic (mono type, hairline border, verified green tick) from mira-theme.css. */}
        <div
          role="note"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            background: "var(--mira-canvas)",
            border: "1px solid var(--mira-fog)",
            borderLeft: "2px solid var(--mira-verify)",
            borderRadius: "var(--mira-radius-lg)",
            padding: "14px 18px",
            marginBottom: 12,
          }}
        >
          <span
            aria-hidden
            style={{
              marginTop: 2,
              width: 20,
              height: 20,
              flex: "0 0 auto",
              borderRadius: "50%",
              background: "rgba(18,120,78,.14)",
              color: "var(--mira-verify-deep)",
              display: "grid",
              placeItems: "center",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            ✓
          </span>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: "var(--mira-mono)",
                fontSize: 11,
                letterSpacing: ".16em",
                textTransform: "uppercase",
                color: "var(--mira-verify-deep)",
                marginBottom: 4,
              }}
            >
              Canonical Memory
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.55, color: "var(--mira-ink)" }}>
              The first AI that remembers you — and can prove it. Tell her your name or a detail about
              yourself, then come back later:{" "}
              <strong style={{ fontWeight: 600 }}>she recalls exactly what you told her</strong>, and never
              invents what she doesn&apos;t know.
              <span
                style={{
                  display: "block",
                  marginTop: 6,
                  fontFamily: "var(--mira-mono)",
                  fontSize: 11.5,
                  letterSpacing: ".04em",
                  color: "var(--mira-graphite)",
                }}
              >
                Verified · tamper-evident · grounded
              </span>
            </div>
          </div>
        </div>

        {/* Sandbox banner */}
        <div
          role="note"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            background: "var(--mira-frost)",
            border: "1px solid var(--mira-fog)",
            borderRadius: "var(--mira-radius-lg)",
            padding: "12px 16px",
            marginBottom: 18,
            fontSize: 13.5,
            color: "var(--mira-graphite)",
            lineHeight: 1.5,
          }}
        >
          <span aria-hidden style={{ fontSize: 16, lineHeight: 1.4 }}>🔒</span>
          <span>
            <strong style={{ color: "var(--mira-ink)", fontWeight: 500 }}>Sandboxed demo.</strong> Mira can
            answer anything it knows, but it cannot act — it can&apos;t run code, browse, send messages, or
            change anything. It&apos;s read-only, on purpose.
          </span>
        </div>

        {/* Chat */}
        <VeridianChat />

        {/* Coming soon note */}
        <div
          style={{
            marginTop: 20,
            textAlign: "center",
            fontSize: 13.5,
            color: "var(--mira-graphite)",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "var(--mira-petal)",
              color: "var(--mira-ink)",
              borderRadius: 999,
              padding: "8px 16px",
            }}
          >
            <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--mira-rose-deep)" }} />
            Coming soon: Veridian CLS Unlimited (T&amp;C apply)
          </span>
        </div>

        {/* Footer actions */}
        <div style={{ marginTop: 28, display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
          <Link href="/contact" className="btn-mira-soft">
            Contact us
          </Link>
          <Link
            href="/mira"
            className="mira-navlink"
            style={{ display: "inline-flex", alignItems: "center", color: "var(--mira-graphite)", fontSize: 14 }}
          >
            Explore the product →
          </Link>
        </div>
      </div>
    </div>
  );
}
