"use client";

import Link from "next/link";
import { TIERS, tierById } from "../_components/tiers";

/* TODO(backend): all numbers below are stubbed client state.
   Replace with the authenticated account + usage from the API. */
const STUB_ACCOUNT = {
  assistantName: "Mira",
  role: "assistant",
  planId: "companion",
  renews: "Jul 14, 2026",
  usage: {
    messages: { used: 1840, cap: 5000, label: "Messages this month" },
    voice: { used: 92, cap: 300, label: "Voice minutes" },
    builds: { used: 1, cap: 3, label: "Little builds" },
  },
};

function Meter({ used, cap, label }: { used: number; cap: number; label: string }) {
  const pct = Math.min(100, Math.round((used / cap) * 100));
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontSize: 13.5, color: "var(--mira-graphite)" }}>{label}</span>
        <span className="display" style={{ fontSize: 15 }}>
          {used.toLocaleString()} <span style={{ color: "var(--mira-slate)", fontSize: 12 }}>/ {cap.toLocaleString()}</span>
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: "var(--mira-fog)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "var(--mira-grad-presence)", borderRadius: 999, transition: "width .4s" }} />
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  background: "var(--mira-canvas)",
  border: "1px solid var(--mira-fog)",
  borderRadius: "var(--mira-radius-lg)",
  boxShadow: "var(--mira-shadow-sm)",
};

export default function MiraAccount() {
  const plan = tierById(STUB_ACCOUNT.planId) ?? TIERS[0];
  const nextPlan = TIERS[Math.min(TIERS.length - 1, TIERS.findIndex((t) => t.id === plan.id) + 1)];
  const canUpgrade = nextPlan.id !== plan.id;
  const u = STUB_ACCOUNT.usage;

  async function checkout(planId: string) {
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: planId }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.url) window.location.href = data.url;
    else alert(data.message || "Couldn't start checkout right now.");
  }

  async function openBilling() {
    const customerId = typeof window !== "undefined" ? localStorage.getItem("mira_customer") : null;
    if (!customerId) {
      alert("Open billing from the link in your welcome email — your account isn't signed in yet.");
      return;
    }
    const res = await fetch("/api/portal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer_id: customerId }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.url) window.location.href = data.url;
    else alert(data.message || "Couldn't open the billing portal.");
  }

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "48px 24px 80px" }}>
      <header style={{ marginBottom: 28 }}>
        <p style={{ fontSize: 13, color: "var(--mira-slate)", margin: 0 }}>Your account</p>
        <h1 className="display" style={{ fontSize: "clamp(28px,4.5vw,40px)", margin: "4px 0 0" }}>
          Good to see you.
        </h1>
        <p style={{ color: "var(--mira-graphite)", fontSize: 15.5, margin: "8px 0 0" }}>
          {STUB_ACCOUNT.assistantName} is your {STUB_ACCOUNT.role}, and she&apos;s doing well.
        </p>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
        {/* Plan card */}
        <section style={{ ...card, padding: 24, display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "center" }}>
          <div>
            <p style={{ fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--mira-rose-deep)", fontWeight: 600, margin: 0 }}>
              Current plan
            </p>
            <p className="display" style={{ fontSize: 28, fontWeight: 400, margin: "6px 0 2px", display: "flex", alignItems: "baseline", gap: 6 }}>
              {plan.name}
              <span style={{ fontSize: 16, color: "var(--mira-slate)" }}>{plan.price}{plan.per}</span>
            </p>
            <p style={{ fontSize: 13, color: "var(--mira-slate)", margin: 0 }}>Renews {STUB_ACCOUNT.renews}</p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {canUpgrade && (
              <button type="button" className="btn-mira" onClick={() => checkout(nextPlan.id)} style={{ padding: "11px 20px", fontSize: 14, cursor: "pointer" }}>
                Upgrade to {nextPlan.name} →
              </button>
            )}
            <button type="button" className="btn-mira-soft" onClick={openBilling} style={{ padding: "10px 18px", fontSize: 14, cursor: "pointer" }}>
              Manage billing
            </button>
          </div>
        </section>

        {/* Usage card */}
        <section style={{ ...card, padding: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 18 }}>
            <h2 className="display" style={{ fontSize: 20, fontWeight: 400, margin: 0 }}>Your month so far</h2>
            <span style={{ fontSize: 12, color: "var(--mira-slate)" }}>Resets {STUB_ACCOUNT.renews}</span>
          </div>
          <div style={{ display: "grid", gap: 18 }}>
            <Meter used={u.messages.used} cap={u.messages.cap} label={u.messages.label} />
            <Meter used={u.voice.used} cap={u.voice.cap} label={u.voice.label} />
            <Meter used={u.builds.used} cap={u.builds.cap} label={u.builds.label} />
          </div>
          <p style={{ fontSize: 12.5, color: "var(--mira-slate)", margin: "18px 0 0" }}>
            {/* TODO(backend): live usage from metering service. */}
            Plenty left. She&apos;ll let you know long before you run low.
          </p>
        </section>

        {/* Manage card */}
        <section style={{ ...card, padding: 24, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 className="display" style={{ fontSize: 18, fontWeight: 400, margin: "0 0 2px" }}>Make her more yours</h2>
            <p style={{ fontSize: 13.5, color: "var(--mira-graphite)", margin: 0 }}>Reshape her vibe, role, or name anytime.</p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link className="btn-mira-soft" href="/mira/start" style={{ padding: "10px 18px", fontSize: 14 }}>
              Reshape Mira
            </Link>
            <button
              type="button"
              className="btn-mira-soft"
              style={{ padding: "10px 18px", fontSize: 14, background: "transparent", color: "var(--mira-slate)" }}
              onClick={() => {
                // TODO(backend): wire to real sign-out.
                alert("Stub: sign out hooks into auth here.");
              }}
            >
              Sign out
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
