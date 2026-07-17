import Link from "next/link";
import { TIERS } from "../_components/tiers";
import { Stepper } from "../_components/Stepper";

export const metadata = { title: "Plans — coming soon" };

// Pre-launch: the plans are a PREVIEW. They render fully but are professionally
// dimmed and deactivated (no selection, no checkout) — the one live action is
// joining the waitlist. Nothing here charges anyone until launch.
export default function MiraPlans() {
  return (
    <main
      className="mira-plans-pad"
      style={{ maxWidth: 1080, width: "100%", minWidth: 0, boxSizing: "border-box", margin: "0 auto", padding: "48px 24px 80px" }}
    >
      <Stepper current={2} />

      <header style={{ textAlign: "center", marginBottom: 28 }}>
        <span
          style={{
            display: "inline-block",
            fontSize: 11.5,
            fontWeight: 600,
            letterSpacing: ".14em",
            textTransform: "uppercase",
            color: "var(--mira-rose-deep)",
            background: "var(--mira-rose-light)",
            border: "1px solid var(--mira-rose-light)",
            borderRadius: 999,
            padding: "4px 14px",
            marginBottom: 14,
          }}
        >
          Coming soon
        </span>
        <h1 className="display" style={{ fontSize: "clamp(30px,5vw,48px)", margin: "0 0 8px" }}>
          Choose how far <span className="grad">she goes</span>
        </h1>
        <p style={{ color: "var(--mira-graphite)", fontSize: 16, maxWidth: 540, margin: "0 auto" }}>
          A preview of what&apos;s coming — including a million tokens free, every month. Plans open at
          launch. Join the waitlist and you&apos;re first through the door.
        </p>
      </header>

      {/* The one live action */}
      <div style={{ textAlign: "center", marginBottom: 34 }}>
        <Link
          href="/mira/signup"
          className="btn-mira"
          style={{ minWidth: 240, justifyContent: "center", display: "inline-flex" }}
        >
          Join the waitlist →
        </Link>
      </div>

      {/* Dimmed, deactivated preview of the tiers */}
      <div
        aria-hidden
        style={{
          position: "relative",
          opacity: 0.5,
          filter: "grayscale(0.15)",
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(min(220px,100%),1fr))",
            gap: 16,
            minWidth: 0,
          }}
        >
          {TIERS.map((t) => (
            <div
              key={t.id}
              style={{
                textAlign: "left",
                background: "var(--mira-cream)",
                border: `1.5px solid ${t.featured ? "var(--mira-rose-light)" : "var(--mira-fog)"}`,
                borderRadius: "var(--mira-radius-lg)",
                padding: 24,
                position: "relative",
              }}
            >
              {t.featured && (
                <span
                  style={{
                    position: "absolute",
                    top: 16,
                    right: 16,
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#fff",
                    background: "var(--mira-grad-presence)",
                    borderRadius: 999,
                    padding: "3px 10px",
                  }}
                >
                  Most loved
                </span>
              )}
              <p style={{ fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--mira-rose-deep)", fontWeight: 600, margin: 0 }}>{t.name}</p>
              <p className="display" style={{ fontSize: 34, fontWeight: 400, margin: "8px 0 0", display: "flex", alignItems: "baseline", gap: 4 }}>
                {t.price}
                {t.per && <span style={{ fontSize: 14, color: "var(--mira-slate)" }}>{t.per}</span>}
              </p>
              <p style={{ fontSize: 12, color: "var(--mira-slate)", margin: 0 }}>{t.sub}</p>
              <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 0", fontSize: 14, color: "var(--mira-graphite)" }}>
                {t.items.map((it) => (
                  <li key={it} style={{ padding: "3px 0" }}>✓ {it}</li>
                ))}
              </ul>
              <div
                style={{
                  marginTop: 18,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  color: "var(--mira-slate)",
                }}
              >
                Coming soon
              </div>
            </div>
          ))}
        </div>
      </div>

      <p style={{ textAlign: "center", fontSize: 13.5, color: "var(--mira-slate)", margin: "24px 0 0" }}>
        Plans activate at launch — no card, no charges until then.
      </p>
    </main>
  );
}
