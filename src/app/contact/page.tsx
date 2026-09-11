import Link from "next/link";
import { Fraunces, Inter } from "next/font/google";
import "../mira/mira-theme.css";

// Reuse the Mira brand kit so Contact reads as one brand (no new palette).
const fraunces = Fraunces({ subsets: ["latin"], weight: ["300", "400", "500"], variable: "--font-mira-display", display: "swap" });
const interMira = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mira-ui", display: "swap" });

export const metadata = {
  title: "Contact us — Mira",
  description: "Get in touch with the Mira team. Send us a message and we'll get back to you.",
};

const field: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid var(--mira-fog)",
  background: "var(--mira-cream)",
  color: "var(--mira-ink)",
  fontSize: 15,
  fontFamily: "inherit",
};

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const sent = sp?.sent === "1";
  const error = sp?.error;

  return (
    <div
      className={`mira-root ${fraunces.variable} ${interMira.variable}`}
      style={{ background: "var(--mira-cream)", color: "var(--mira-ink)", minHeight: "100vh" }}
    >
      <style>{`
        .contact-wrap input:focus-visible,
        .contact-wrap textarea:focus-visible,
        .contact-wrap button:focus-visible,
        .contact-wrap a:focus-visible {
          outline: 2px solid var(--aether);
          outline-offset: 2px;
          border-radius: 6px;
        }
      `}</style>

      <div
        className="contact-wrap"
        style={{ maxWidth: 620, width: "100%", minWidth: 0, boxSizing: "border-box", margin: "0 auto", padding: "64px 20px 80px" }}
      >
        <header style={{ textAlign: "center", marginBottom: 28 }}>
          <h1 className="display" style={{ fontSize: "clamp(30px,6vw,48px)", lineHeight: 1.1, margin: "0 0 12px" }}>
            Contact <span className="grad">us</span>
          </h1>
          <p style={{ color: "var(--mira-graphite)", fontSize: 16, lineHeight: 1.6, maxWidth: "46ch", margin: "0 auto" }}>
            Questions, partnerships, or feedback — send us a message and the Mira team will get back to you.
          </p>
        </header>

        {sent ? (
          <div
            role="status"
            style={{
              background: "var(--mira-canvas)",
              border: "1px solid var(--mira-fog)",
              borderRadius: "var(--mira-radius-lg)",
              boxShadow: "var(--mira-shadow-md)",
              padding: "32px 24px",
              textAlign: "center",
            }}
          >
            <div aria-hidden style={{ fontSize: 34, marginBottom: 8 }}>✓</div>
            <h2 className="display" style={{ fontSize: 24, margin: "0 0 8px" }}>Thank you</h2>
            <p style={{ color: "var(--mira-graphite)", fontSize: 15, lineHeight: 1.6, margin: "0 0 20px" }}>
              Your message has been received. We&apos;ll be in touch at the email you provided.
            </p>
            <Link href="/veridian" className="btn-mira">Back to the demo</Link>
          </div>
        ) : (
          <form
            method="POST"
            action="/api/contact"
            style={{
              background: "var(--mira-canvas)",
              border: "1px solid var(--mira-fog)",
              borderRadius: "var(--mira-radius-lg)",
              boxShadow: "var(--mira-shadow-md)",
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            {error && (
              <p
                role="alert"
                style={{
                  margin: 0,
                  padding: "10px 14px",
                  borderRadius: 12,
                  background: "#FDECEC",
                  color: "#7A1F1F",
                  fontSize: 13.5,
                }}
              >
                {error === "2"
                  ? "Something went wrong saving your message — please try again."
                  : "Please fill in your name, a valid email, and a message."}
              </p>
            )}

            <div>
              <label htmlFor="name" style={{ display: "block", fontSize: 13.5, fontWeight: 500, marginBottom: 6 }}>
                Name
              </label>
              <input id="name" name="name" type="text" required maxLength={120} autoComplete="name" style={field} />
            </div>

            <div>
              <label htmlFor="email" style={{ display: "block", fontSize: 13.5, fontWeight: 500, marginBottom: 6 }}>
                Email
              </label>
              <input id="email" name="email" type="email" required maxLength={254} autoComplete="email" style={field} />
            </div>

            <div>
              <label htmlFor="message" style={{ display: "block", fontSize: 13.5, fontWeight: 500, marginBottom: 6 }}>
                Message
              </label>
              <textarea id="message" name="message" required maxLength={4000} rows={5} style={{ ...field, resize: "vertical", lineHeight: 1.5 }} />
            </div>

            <button type="submit" className="btn-mira" style={{ alignSelf: "flex-start" }}>
              Send message
            </button>
          </form>
        )}

        <div style={{ marginTop: 24, textAlign: "center" }}>
          <Link
            href="/veridian"
            className="mira-navlink"
            style={{ color: "var(--mira-graphite)", fontSize: 14 }}
          >
            ← Back to the Mira demo
          </Link>
        </div>
      </div>
    </div>
  );
}
