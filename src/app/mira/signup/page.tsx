export const metadata = { title: "Join the waitlist" };

const card: React.CSSProperties = {
  background: "var(--mira-canvas)",
  border: "1px solid var(--mira-fog)",
  borderRadius: "var(--mira-radius-lg)",
  boxShadow: "var(--mira-shadow-sm)",
  padding: 28,
};

const input: React.CSSProperties = {
  width: "100%",
  padding: "13px 15px",
  fontSize: 15,
  borderRadius: "var(--mira-radius-md)",
  border: "1px solid var(--mira-fog)",
  background: "var(--mira-cream)",
  color: "var(--mira-ink)",
  outline: "none",
};

// Waitlist capture. Posts a real name+email to /api/waitlist, which persists it
// to the durable on-disk store (survives restarts) and redirects to the
// "you're on the list" thank-you. No localStorage, no dead-end at the not-yet-
// live checkout — a native form so it works even without JS.
export default function MiraSignup() {
  return (
    <main id="mira-main" style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px 80px" }}>
      {/* waitlist is a single step — no plan/payment stepper pre-launch */}
      <header style={{ textAlign: "center", marginBottom: 24 }}>
        <h1 className="display" style={{ fontSize: "clamp(28px,4.5vw,40px)", margin: "0 0 6px" }}>
          Join the <span className="grad">waitlist</span>
        </h1>
        <p style={{ color: "var(--mira-graphite)", fontSize: 15.5, margin: 0 }}>
          Mira is opening access in waves. Leave your name and email — we&apos;ll invite you the moment your spot is ready.
        </p>
      </header>

      <form action="/api/waitlist" method="post" style={card}>
        <input type="hidden" name="source" value="mira" />
        <label htmlFor="mira-name" style={{ display: "block", fontSize: 13, color: "var(--mira-graphite)", marginBottom: 6 }}>Your name</label>
        <input id="mira-name" style={input} name="name" placeholder="Maya" required autoFocus />
        <label htmlFor="mira-email" style={{ display: "block", fontSize: 13, color: "var(--mira-graphite)", margin: "16px 0 6px" }}>Email</label>
        <input id="mira-email" style={input} type="email" name="email" placeholder="you@email.com" required />
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 9,
            margin: "18px 0 0",
            fontSize: 13,
            lineHeight: 1.5,
            color: "var(--mira-graphite)",
          }}
        >
          <input
            type="checkbox"
            name="accept_terms"
            value="yes"
            required
            style={{ marginTop: 2, flexShrink: 0, accentColor: "var(--mira-aether-ink)" }}
          />
          <span>
            I agree to the{" "}
            <a
              href="/legal/terms"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--mira-aether-ink)", textDecoration: "underline" }}
            >
              Terms &amp; Conditions
            </a>
            .
          </span>
        </label>
        <button
          type="submit"
          className="btn-mira"
          style={{ width: "100%", marginTop: 22, justifyContent: "center", fontSize: 15.5, padding: "15px" }}
        >
          Join the waitlist →
        </button>
        <p style={{ textAlign: "center", fontSize: 12.5, color: "var(--mira-slate)", margin: "14px 0 0" }}>
          We&apos;ll email you the moment your invite is ready.
        </p>
      </form>
    </main>
  );
}
