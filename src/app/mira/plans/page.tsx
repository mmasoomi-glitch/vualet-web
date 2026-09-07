import Link from "next/link";
import { TIERS } from "../_components/tiers";

export const metadata = {
  title: "Choose your Mira plan",
  description:
    "Choose the Mira plan you want before setting her up, then move on to checkout to complete the next step in signup.",
};

// Every tier — paid and free — routes to /mira/checkout, which collects the
// customer's email before starting payment.
//
// This page used to POST straight to /api/checkout with only { plan }. That
// worked under Stripe Checkout, which collected the email on its own hosted
// page. Dodo requires the email up-front, so with no email supplied, dodo.ts
// fell back to a hardcoded "guest@vualet.com" — and because this page is the
// main paid entry point, EVERY paying customer collapsed into that one fake
// identity, unable to be identified, sign in, or have entitlement resolved.
//
// /mira/checkout already collects the email and already handles promo codes,
// so routing here reuses a working path rather than duplicating it. Jury #101.
export default function MiraPlans() {
  return (
    <main
      id="mira-main"
      className="mira-plans-pad"
      style={{ maxWidth: 1080, width: "100%", minWidth: 0, boxSizing: "border-box", margin: "0 auto", padding: "48px 24px 80px" }}
    >
      <header style={{ textAlign: "center", marginBottom: 28 }}>
        <span
          style={{
            display: "inline-block",
            fontSize: 11.5,
            fontWeight: 600,
            letterSpacing: ".14em",
            textTransform: "uppercase",
            color: "var(--mira-ink)",
            background: "var(--mira-rose-light)",
            border: "1px solid var(--mira-rose-light)",
            borderRadius: 999,
            padding: "4px 14px",
            marginBottom: 14,
          }}
        >
          14-day free trial
        </span>
        <h1 className="display" style={{ fontSize: "clamp(30px,5vw,48px)", margin: "0 0 8px" }}>
          Choose how far <span className="grad">she goes</span>
        </h1>
        <p style={{ color: "var(--mira-graphite)", fontSize: 16, maxWidth: 540, margin: "0 auto" }}>
          Start your 14-day free trial — no charge for 14 days, cancel anytime. Or stay on the Free
          plan: a million tokens every month, no card needed.
        </p>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(min(220px,100%),1fr))",
          gap: 16,
          minWidth: 0,
        }}
      >
        {TIERS.map((t) => {
          const paid = t.id !== "free";
          return (
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
                  Most complete
                </span>
              )}
              <p style={{ fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--mira-rose-ink)", fontWeight: 600, margin: 0 }}>{t.name}</p>
              <p className="display" style={{ fontSize: 34, fontWeight: 400, margin: "8px 0 0", display: "flex", alignItems: "baseline", gap: 4 }}>
                {t.price}
                {t.per ? (
                  <>
                    <span style={{ fontSize: 14, color: "var(--mira-slate)" }} aria-hidden="true">{t.per}</span>
                    {t.per === "/mo" ? (
                      <span className="mira-sr-only"> per month</span>
                    ) : (
                      <span className="mira-sr-only">{t.per}</span>
                    )}
                  </>
                ) : null}
              </p>
              <p style={{ fontSize: 12, color: "var(--mira-slate)", margin: 0 }}>{t.sub}</p>
              <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 0", fontSize: 14, color: "var(--mira-graphite)" }}>
                {t.items.map((it) => (
                  <li key={it} style={{ padding: "3px 0" }}><span aria-hidden="true">✓ </span>{it}</li>
                ))}
              </ul>
              <div style={{ marginTop: 18 }}>
                {paid ? (
                  <Link
                    href={`/mira/checkout?plan=${t.id}`}
                    className="btn-mira"
                    style={{ width: "100%", justifyContent: "center", display: "inline-flex", fontSize: 14, textDecoration: "none" }}
                  >
                    {t.cta}
                  </Link>
                ) : (
                  <Link
                    href="/mira/checkout?plan=free"
                    className="btn-mira-soft"
                    style={{ width: "100%", justifyContent: "center", display: "inline-flex", fontSize: 14, textDecoration: "none" }}
                  >
                    {t.cta}
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ textAlign: "center", fontSize: 13.5, color: "var(--mira-slate)", margin: "24px 0 0" }}>
        Start your 14-day free trial — no charge for 14 days, cancel anytime.
      </p>
    </main>
  );
}
