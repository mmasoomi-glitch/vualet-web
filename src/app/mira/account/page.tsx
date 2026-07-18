"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/* Payments are live: a Stripe customer id in localStorage["mira_customer"] (saved at
   /mira/welcome after checkout) means an active paid subscription — show that state and
   enable "Manage billing". With no customer id on this device, fall back to the honest
   no-plan / waitlist state. Never imply a subscription we can't see a customer id for. */

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
  const [signedIn, setSignedIn] = useState(false);
  // Stripe customer id saved at /mira/welcome after payment — presence means an
  // active paid subscription. Absent = still on the waitlist / no plan.
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("mira_setup");
      const parsed = raw ? (JSON.parse(raw) as Persona) : null;
      // Treat an empty object (the "skip" path) as "no persona yet".
      setPersona(parsed && parsed.assistantName ? parsed : null);
      const cust = localStorage.getItem("mira_customer");
      setCustomerId(cust || null);
      // "Signed in on this device" = any local setup, token, or subscription exists.
      setSignedIn(Boolean(raw) || Boolean(localStorage.getItem("mira_token")) || Boolean(cust));
    } catch {
      setPersona(null);
      setCustomerId(null);
      setSignedIn(false);
    }
    setLoaded(true);
  }, []);

  async function openBillingPortal() {
    if (!customerId) return;
    setPortalError(null);
    setPortalBusy(true);
    try {
      const res = await fetch("/api/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: customerId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setPortalError(data.message || "Couldn't open billing. Please try again.");
    } catch {
      setPortalError("Something went wrong. Please try again.");
    }
    setPortalBusy(false);
  }

  const assistantName = persona?.assistantName?.trim() || "Mira";
  const vibeLabel = persona?.vibe ? VIBE_LABELS[persona.vibe] ?? "" : "";
  const roleLabel = persona?.role ? ROLE_LABELS[persona.role] ?? "" : "";

  function signOut() {
    // Clear any local session state and return to the entry page.
    // (Server-side session invalidation lands with real auth.)
    try {
      localStorage.removeItem("mira_setup");
      localStorage.removeItem("mira_token");
      localStorage.removeItem("mira_customer");
    } catch {}
    setPersona(null);
    setCustomerId(null);
    setSignedIn(false);
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
          {customerId
            ? "Your subscription is active. Manage payment, invoices, or cancel anytime below."
            : "You’re early — Mira is opening in waves, and your spot is being saved."}
        </p>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
        {/* Plan status — active subscription when a Stripe customer id is on this
            device, otherwise the honest waitlist / no-plan state. */}
        {customerId ? (
          <section style={{ ...card, padding: 24, display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "center" }}>
            <div>
              <p style={{ fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--mira-rose-deep)", fontWeight: 600, margin: 0 }}>
                Your status
              </p>
              <p className="display" style={{ fontSize: 26, fontWeight: 400, margin: "6px 0 4px", display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                Subscription active
                <span style={{ fontSize: 14, color: "var(--mira-slate)" }}>Mira plan</span>
              </p>
              <p style={{ fontSize: 13.5, color: "var(--mira-graphite)", margin: 0 }}>
                Your plan is live. Update payment, view invoices, or cancel anytime in the billing portal.
              </p>
              {portalError && (
                <p role="alert" style={{ fontSize: 13, color: "var(--mira-rose-deep)", margin: "8px 0 0" }}>
                  {portalError}
                </p>
              )}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn-mira"
                onClick={openBillingPortal}
                disabled={portalBusy}
                style={{ padding: "11px 20px", fontSize: 14, opacity: portalBusy ? 0.7 : 1, cursor: portalBusy ? "wait" : "pointer" }}
              >
                {portalBusy ? "Opening…" : "Manage billing →"}
              </button>
            </div>
          </section>
        ) : (
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
                No plan on this device yet. Start a 14-day free trial anytime — no charge for 14 days, cancel anytime.
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <Link className="btn-mira" href="/mira/plans" style={{ padding: "11px 20px", fontSize: 14 }}>
                See plans →
              </Link>
            </div>
          </section>
        )}

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

        {/* Sign out — now reflects real local state (TASK-02: sign-out takes effect) */}
        {loaded && (signedIn ? (
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
        ) : (
          <section style={{ ...card, padding: 24, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h2 className="display" style={{ fontSize: 18, fontWeight: 400, margin: "0 0 2px" }}>Signed out on this device</h2>
              <p style={{ fontSize: 13.5, color: "var(--mira-graphite)", margin: 0 }}>No Mira setup is saved on this device.</p>
            </div>
            <Link
              href="/mira/start"
              className="btn-mira-soft"
              style={{ padding: "10px 18px", fontSize: 14, textDecoration: "none" }}
            >
              Set up Mira
            </Link>
          </section>
        ))}
      </div>
    </main>
  );
}
