"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type Connect = { plan: string; status: string; customerId: string | null; botUrl: string };

function Welcome() {
  const params = useSearchParams();
  const token = params.get("token");
  const [data, setData] = useState<Connect | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/connect?token=${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Connect) => {
        setData(d);
        // Durably save the Stripe customer id for /mira/account to read later.
        // Wrapped so a storage exception (private mode, quota) can't break the flow.
        try {
          if (d.customerId) localStorage.setItem("mira_customer", d.customerId);
        } catch {}
      })
      .catch(() => setErr(true));
  }, [token]);

  const botUrl = data?.botUrl ?? "https://t.me/ballerina_10840_bot";
  const active = data?.status === "active";

  return (
    <main id="mira-main" style={{ maxWidth: 620, margin: "0 auto", padding: "64px 24px 90px", textAlign: "center" }}>
      <div
        className="mira-aura"
        aria-hidden
        style={{ width: 120, height: 120, margin: "0 auto 8px", borderRadius: "50%", background: "var(--mira-grad-presence, var(--mira-gradient-presence))", filter: "blur(6px)", opacity: 0.9 }}
      />
      <h1 className="display" style={{ fontSize: "clamp(30px,5vw,46px)", margin: "8px 0 0" }}>
        She&apos;s <span className="grad">yours</span> now.
      </h1>
      <p style={{ color: "var(--mira-graphite)", fontSize: 17, margin: "14px auto 0", maxWidth: 460, lineHeight: 1.6 }}>
        {err
          ? "Your plan is being set up. Open Mira on Telegram and say hi — she'll pick it up from there."
          : active
            ? "Payment confirmed. One tap and Mira starts talking to you on Telegram."
            : "Almost there — tap below to open Mira on Telegram. The moment your payment clears, she unlocks everything."}
      </p>

      <a
        className="btn-mira"
        href={botUrl}
        target="_blank"
        rel="noreferrer"
        style={{ display: "inline-flex", marginTop: 30, fontSize: 16, padding: "16px 32px" }}
      >
        Open Mira on Telegram →
      </a>

      <div style={{ marginTop: 40, textAlign: "left", background: "var(--mira-canvas)", border: "1px solid var(--mira-fog)", borderRadius: "var(--mira-radius-lg)", padding: 24 }}>
        <p style={{ fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--mira-rose-ink)", fontWeight: 600, margin: 0 }}>
          What happens next
        </p>
        {[
          ["Tap “Open Mira on Telegram”", "It opens your chat with her and links it to your plan automatically."],
          ["Send her a first message", "Type or hold to talk — she replies in her own voice."],
          ["She remembers you", "Every conversation builds on the last. No setup, no app."],
        ].map(([t, s], i) => (
          <div key={t} style={{ display: "flex", gap: 14, marginTop: 16 }}>
            <span style={{ flex: "none", display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: "50%", color: "#fff", background: "var(--mira-grad-presence, var(--mira-gradient-presence))", fontSize: 13, fontWeight: 600 }}>{i + 1}</span>
            <div>
              <p className="display" style={{ fontSize: 16, fontWeight: 400, margin: 0 }}>{t}</p>
              <p style={{ fontSize: 14, color: "var(--mira-graphite)", margin: "2px 0 0", lineHeight: 1.5 }}>{s}</p>
            </div>
          </div>
        ))}
      </div>

      <p style={{ fontSize: 14, color: "var(--mira-slate)", marginTop: 26 }}>
        Manage your plan anytime from <Link href="/mira/account" style={{ color: "var(--mira-rose-ink)" }}>your account</Link>.
      </p>
    </main>
  );
}

export default function WelcomePage() {
  return (
    <Suspense fallback={<main style={{ padding: "80px 24px", textAlign: "center", color: "var(--mira-slate)" }}>Setting up…</main>}>
      <Welcome />
    </Suspense>
  );
}
