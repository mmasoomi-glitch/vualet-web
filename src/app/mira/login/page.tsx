"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

/* Passwordless sign-in (jury verdict A). Enter email -> we send a one-time link ->
   clicking it creates a real server session. No password to remember or leak. */

const card: React.CSSProperties = {
  background: "var(--mira-canvas)",
  border: "1px solid var(--mira-fog)",
  borderRadius: "var(--mira-radius-lg)",
  boxShadow: "var(--mira-shadow-sm)",
};

function Login() {
  const params = useSearchParams();
  const expired = params.get("e") === "expired";
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await fetch("/api/auth/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setSent(true); // always — the endpoint never reveals whether the email exists
    } catch {
      setSent(true);
    }
    setBusy(false);
  }

  return (
    <main id="mira-main" style={{ maxWidth: 460, margin: "0 auto", padding: "72px 24px 90px" }}>
      <h1 className="display" style={{ fontSize: "clamp(28px,5vw,40px)", margin: 0, textAlign: "center" }}>
        Sign in to Mira
      </h1>
      <p style={{ color: "var(--mira-graphite)", fontSize: 15.5, margin: "12px auto 0", textAlign: "center", maxWidth: 380, lineHeight: 1.6 }}>
        Enter your email and we&rsquo;ll send you a one-time sign-in link. No password to remember.
      </p>

      {expired && !sent && (
        <p role="alert" style={{ marginTop: 20, textAlign: "center", fontSize: 14, color: "var(--mira-rose-ink)" }}>
          That link expired or was already used. Enter your email for a fresh one.
        </p>
      )}

      {sent ? (
        <section style={{ ...card, padding: 28, marginTop: 28, textAlign: "center" }}>
          <div className="mira-aura" aria-hidden style={{ width: 72, height: 72, margin: "0 auto 12px", borderRadius: "50%", background: "var(--mira-grad-presence, var(--mira-gradient-presence))", filter: "blur(5px)", opacity: 0.9 }} />
          <h2 className="display" style={{ fontSize: 22, fontWeight: 400, margin: 0 }}>Check your email</h2>
          <p style={{ fontSize: 14.5, color: "var(--mira-graphite)", margin: "10px 0 0", lineHeight: 1.6 }}>
            If <strong>{email}</strong> has a Mira account, a sign-in link is on its way. It works once and expires in 15 minutes.
          </p>
          <button type="button" onClick={() => setSent(false)} style={{ marginTop: 18, background: "transparent", border: 0, color: "var(--mira-rose-ink)", fontSize: 14, cursor: "pointer" }}>
            Use a different email
          </button>
        </section>
      ) : (
        <form onSubmit={submit} style={{ ...card, padding: 28, marginTop: 28, display: "grid", gap: 14 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, color: "var(--mira-slate)" }}>Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              style={{ padding: "13px 15px", fontSize: 15, borderRadius: 12, border: "1px solid var(--mira-fog)", background: "#fff", color: "var(--mira-graphite)" }}
            />
          </label>
          <button
            type="submit"
            className="btn-mira"
            disabled={busy}
            style={{ padding: "13px 20px", fontSize: 15, opacity: busy ? 0.7 : 1, cursor: busy ? "wait" : "pointer" }}
          >
            {busy ? "Sending…" : "Send me a sign-in link →"}
          </button>
        </form>
      )}
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main style={{ padding: "80px 24px", textAlign: "center", color: "var(--mira-slate)" }}>Loading…</main>}>
      <Login />
    </Suspense>
  );
}
