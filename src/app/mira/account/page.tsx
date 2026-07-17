"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/* Pre-launch reality (mirrors /mira/plans + /mira/signup): Mira is waitlist-only.
   Payments are NOT live — no plan, no card, no charges until launch. This page must
   never imply an active paid subscription or real metered usage. */

// Labels for the persona saved by the /mira/start wizard (localStorage "mira_setup").
// That wizard stores vibe/role as ids — map them back to human labels for display.
const VIBE_LABELS: Record<string, string> = {
  warm: "Warm & gentle",
  bright: "Bright & playful",
  calm: "Calm & grounded",
  sharp: "Sharp & direct",
};
const ROLE_LABELS: Record<string, string> = {
  friend: "Friend",
  tutor: "Tutor",
  assistant: "Assistant",
  coach: "Coach",
};

type Persona = {
  assistantName?: string;
  role?: string;
  vibe?: string;
  persona?: string;
};

const card: React.CSSProperties = {
  background: "var(--mira-canvas)",
  border: "1px solid var(--mira-fog)",
  borderRadius: "var(--mira-radius-lg)",
  boxShadow: "var(--mira-shadow-sm)",
};

export default function MiraAccount() {
  // Read the saved persona on the client only (avoids SSR/hydration mismatch).
  const [persona, setPersona] = useState<Persona | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("mira_setup");
      const parsed = raw ? (JSON.parse(raw) as Persona) : null;
      // Treat an empty object (the "skip" path) as "no persona yet".
      setPersona(parsed && parsed.assistantName ? parsed : null);
    } catch {
      setPersona(null);
    }
    setLoaded(true);
  }, []);

  const assistantName = persona?.assistantName?.trim() || "Mira";
  const vibeLabel = persona?.vibe ? VIBE_LABELS[persona.vibe] ?? "" : "";
  const roleLabel = persona?.role ? ROLE_LABELS[persona.role] ?? "" : "";

  function signOut() {
    // Clear any local session state and return to the entry page.
    // (Server-side session invalidation lands with real auth.)
    try {
      localStorage.removeItem("mira_setup");
      localStorage.removeItem("mira_token");
    } catch {}
    window.location.href = "/mira";
  }

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "48px 24px 80px" }}>
      <header style={{ marginBottom: 28 }}>
        <p style={{ fontSize: 13, color: "var(--mira-slate)", margin: 0 }}>Your account</p>
        <h1 className="display" style={{ fontSize: "clamp(28px,4.5vw,40px)", margin: "4px 0 0" }}>
          Good to see you.
        </h1>
        <p style={{ color: "var(--mira-graphite)", fontSize: 15.5, margin: "8px 0 0" }}>
          You&apos;re early — Mira is opening in waves, and your spot is being saved.
        </p>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
        {/* Waitlist / plan status — honest pre-launch state (no fake subscription) */}
        <section style={{ ...card, padding: 24, display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "center" }}>
          <div>
            <p style={{ fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--mira-rose-deep)", fontWeight: 600, margin: 0 }}>
              Your status
            </p>
            <p className="display" style={{ fontSize: 26, fontWeight: 400, margin: "6px 0 4px", display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              You&apos;re on the waitlist
              <span style={{ fontSize: 14, color: "var(--mira-slate)" }}>Free preview</span>
            </p>
            <p style={{ fontSize: 13.5, color: "var(--mira-graphite)", margin: 0 }}>
              No plan, no card, no charges yet. Paid plans open at launch — you&apos;ll be first through the door.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {/* Plans are waitlist-only pre-launch → the one honest action is joining the list. */}
            <Link className="btn-mira" href="/mira/signup" style={{ padding: "11px 20px", fontSize: 14 }}>
              Join the waitlist →
            </Link>
            {/* No billing exists yet → clearly disabled, never a dead click or a freeze. */}
            <button
              type="button"
              className="btn-mira-soft"
              disabled
              aria-disabled="true"
              title="Billing opens after launch"
              style={{ padding: "10px 18px", fontSize: 14, cursor: "not-allowed", opacity: 0.55 }}
            >
              Manage billing · after launch
            </button>
          </div>
        </section>

        {/* Persona card — surface what the /mira/start wizard saved (TASK-05) */}
        <section style={{ ...card, padding: 24 }}>
          <p style={{ fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--mira-rose-deep)", fontWeight: 600, margin: 0 }}>
            Your Mira
          </p>
          {!loaded ? (
            <p style={{ color: "var(--mira-slate)", fontSize: 14.5, margin: "10px 0 0" }}>Loading…</p>
          ) : persona ? (
            <>
              <p className="display" style={{ fontSize: 24, fontWeight: 400, margin: "6px 0 4px" }}>
                {assistantName}
              </p>
              <p style={{ fontSize: 14.5, color: "var(--mira-graphite)", margin: 0 }}>
                {[vibeLabel, roleLabel].filter(Boolean).join(" · ") || "Shaped and ready"}
              </p>
              <div style={{ marginTop: 16 }}>
                <Link className="btn-mira-soft" href="/mira/start" style={{ padding: "10px 18px", fontSize: 14 }}>
                  Reshape {assistantName}
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className="display" style={{ fontSize: 22, fontWeight: 400, margin: "6px 0 4px" }}>
                Shape your Mira
              </p>
              <p style={{ fontSize: 14.5, color: "var(--mira-graphite)", margin: 0 }}>
                Give her a name, a vibe, and a role. It takes a minute, and you can change any of it later.
              </p>
              <div style={{ marginTop: 16 }}>
                <Link className="btn-mira" href="/mira/start" style={{ padding: "11px 20px", fontSize: 14 }}>
                  Shape your Mira →
                </Link>
              </div>
            </>
          )}
        </section>

        {/* What you'll get — illustrative preview, clearly not live usage (TASK-04) */}
        <section style={{ ...card, padding: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, gap: 12, flexWrap: "wrap" }}>
            <h2 className="display" style={{ fontSize: 20, fontWeight: 400, margin: 0 }}>What your free preview includes</h2>
            <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--mira-slate)" }}>
              Preview · not billed
            </span>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 14.5, color: "var(--mira-graphite)", display: "grid", gap: 8 }}>
            <li style={{ padding: "2px 0" }}>✓ A million tokens free, every month</li>
            <li style={{ padding: "2px 0" }}>✓ Chat and voice notes, remembered across conversations</li>
            <li style={{ padding: "2px 0" }}>✓ A persona you shape — hers to keep</li>
          </ul>
          <p style={{ fontSize: 12.5, color: "var(--mira-slate)", margin: "16px 0 0" }}>
            Live usage meters arrive when plans go live. Nothing here is charged.
          </p>
        </section>

        {/* Sign out */}
        <section style={{ ...card, padding: 24, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 className="display" style={{ fontSize: 18, fontWeight: 400, margin: "0 0 2px" }}>Signed in on this device</h2>
            <p style={{ fontSize: 13.5, color: "var(--mira-graphite)", margin: 0 }}>Your setup lives on this device until real accounts land.</p>
          </div>
          <button
            type="button"
            className="btn-mira-soft"
            style={{ padding: "10px 18px", fontSize: 14, background: "transparent", color: "var(--mira-slate)", cursor: "pointer" }}
            onClick={signOut}
          >
            Sign out
          </button>
        </section>
      </div>
    </main>
  );
}
