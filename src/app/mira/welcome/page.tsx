"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

// The server issues one of two shapes, depending on the channel the customer
// signed up on (decisions#340: WhatsApp is the primary channel; Telegram is not
// offered to new customers, but links already issued for it keep working):
//   WhatsApp -> { token, channel: "whatsapp", pairUrl, ... }
//   Telegram -> { token, botUrl, ... }
// Both link fields are optional on purpose. If neither arrives we say so out
// loud rather than inventing a link — a link that cannot bind anything looks
// like success and fails silently, which is worse than an honest error.
type Connect = {
  plan?: string;
  status?: string;
  customerId?: string | null;
  assistantName?: string | null;
  channel?: string | null;
  pairUrl?: string | null;
  botUrl?: string | null;
};

// Why we have no usable link. The recovery differs per case, so these are kept
// apart instead of collapsing into one boolean:
//   "expired"  — the server looked and there is no such link (4xx). Retrying
//                cannot help; the customer needs a fresh link.
//   "network"  — we never got an answer (offline, DNS, 5xx). Retrying can help.
//   "unusable" — a record came back, but with no server-issued link in it.
type ErrKind = "expired" | "network" | "unusable";
type Phase = "no-token" | "loading" | "ready" | ErrKind;

// A link only "binds" the customer to their plan if it actually carries the
// connect token (Telegram: ?start=..., WhatsApp: the pairing code in the URL).
// Anything else opens a chat that is attached to nothing.
function linkCarriesToken(url: string, token: string): boolean {
  if (!url || !token) return false;
  return url.includes(token) || url.includes(encodeURIComponent(token));
}

const CARD: React.CSSProperties = {
  marginTop: 34,
  textAlign: "left",
  background: "var(--mira-canvas)",
  border: "1px solid var(--mira-fog)",
  borderRadius: "var(--mira-radius-lg)",
  padding: 24,
};

// The outcome is stamped with the token it belongs to, so a result for a stale
// token can never be rendered next to a new one.
type Result = { token: string; data?: Connect; err?: ErrKind };

function Welcome() {
  const params = useSearchParams();
  const token = params.get("token");
  const [result, setResult] = useState<Result | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) return;
    let live = true;

    (async () => {
      let res: Response;
      try {
        res = await fetch(`/api/connect?token=${encodeURIComponent(token)}`);
      } catch {
        if (live) setResult({ token, err: "network" });
        return;
      }
      if (!live) return;
      if (!res.ok) {
        // 4xx: the server answered and there is no such link — a retry is
        // pointless. 5xx: our side is unwell, so offer the retry.
        setResult({ token, err: res.status >= 400 && res.status < 500 ? "expired" : "network" });
        return;
      }
      let d: Connect;
      try {
        d = (await res.json()) as Connect;
      } catch {
        if (live) setResult({ token, err: "unusable" });
        return;
      }
      if (!live) return;
      setResult({ token, data: d });
      // Durably save the Dodo customer id for /mira/account to read later.
      // Wrapped so a storage exception (private mode, quota) can't break the flow.
      try {
        if (d.customerId) localStorage.setItem("mira_customer", d.customerId);
      } catch {}
    })();

    return () => {
      live = false;
    };
  }, [token, attempt]);

  const current = result && result.token === token ? result : null;
  const data = current?.data ?? null;
  const err = current?.err ?? null;

  const channel = (data?.channel ?? "").trim().toLowerCase();
  const pairUrl = typeof data?.pairUrl === "string" ? data.pairUrl.trim() : "";
  const botUrl = typeof data?.botUrl === "string" ? data.botUrl.trim() : "";

  // Prefer the channel the server named; otherwise use whichever link it sent.
  // The label always describes the link we are actually about to open, so we can
  // never name a channel the href does not go to.
  const usingPair = channel === "telegram" ? !botUrl && !!pairUrl : !!pairUrl;
  const link = usingPair ? pairUrl : botUrl;
  const channelLabel = usingPair ? "WhatsApp" : "Telegram";

  // The "links you automatically" promise is only printed when the link we hold
  // can actually keep it.
  const bound = !!link && !!token && linkCarriesToken(link, token);
  const active = data?.status === "active";

  const phase: Phase = !token
    ? "no-token"
    : err
      ? err
      : !data
        ? "loading"
        : !link
          ? "unusable"
          : "ready";

  const heading: Record<Phase, React.ReactNode> = {
    "no-token": (
      <>
        Your link is <span className="grad">missing</span>.
      </>
    ),
    loading: <>One moment…</>,
    ready: (
      <>
        She&apos;s <span className="grad">yours</span> now.
      </>
    ),
    expired: (
      <>
        We couldn&apos;t <span className="grad">find</span> that link.
      </>
    ),
    network: (
      <>
        We couldn&apos;t <span className="grad">reach</span> us.
      </>
    ),
    unusable: (
      <>
        Something&apos;s <span className="grad">missing</span> on our side.
      </>
    ),
  };

  const body: Record<Phase, string> = {
    "no-token":
      "This page needs the personal link from your confirmation email or from the last step of checkout. Without it there is nothing here to connect — we can't tell whose plan this is.",
    loading: "Finding your connection link.",
    ready: active
      ? `Payment confirmed. One tap and Mira starts talking to you on ${channelLabel}.`
      : `Almost there — tap below to open Mira on ${channelLabel}. The moment your payment clears, she unlocks everything.`,
    expired:
      "That link is unknown to us — it may have expired, or already been used. Nothing is lost: open your account to get a fresh one, or get in touch and we'll send you one.",
    network:
      "We couldn't get an answer from our servers, so we don't yet know which link is yours. Nothing has happened to your plan. Try again in a moment.",
    unusable:
      "Your record came back without a usable connection link, so there is nothing we can safely send you to yet. Please get in touch and we'll finish connecting you by hand.",
  };

  const steps: [string, string][] = [
    [
      `Tap “Open Mira on ${channelLabel}”`,
      bound
        ? "It opens your chat with her and links it to your plan automatically."
        : "It opens your chat with her. Because this link doesn't carry your plan, she'll ask you to confirm it before she starts.",
    ],
    ["Send her a first message", "Type or hold to talk — she replies in her own voice."],
    ["She remembers you", "Every conversation builds on the last. No setup, no app."],
  ];

  const showRecovery = phase === "no-token" || phase === "expired" || phase === "unusable";

  return (
    <main id="mira-main" style={{ maxWidth: 620, margin: "0 auto", padding: "64px 24px 90px", textAlign: "center" }}>
      <div
        className="mira-aura"
        aria-hidden
        style={{ width: 120, height: 120, margin: "0 auto 8px", borderRadius: "50%", background: "var(--mira-grad-presence, var(--mira-gradient-presence))", filter: "blur(6px)", opacity: phase === "ready" || phase === "loading" ? 0.9 : 0.35 }}
      />
      <h1 className="display" style={{ fontSize: "clamp(30px,5vw,46px)", margin: "8px 0 0" }}>
        {heading[phase]}
      </h1>
      <p
        role="status"
        aria-live="polite"
        style={{ color: "var(--mira-graphite)", fontSize: 17, margin: "14px auto 0", maxWidth: 460, lineHeight: 1.6 }}
      >
        {body[phase]}
      </p>

      {phase === "ready" && (
        <a
          className="btn-mira"
          href={link}
          target="_blank"
          rel="noreferrer"
          style={{ display: "inline-flex", marginTop: 30, fontSize: 16, padding: "16px 32px" }}
        >
          Open Mira on {channelLabel} →
        </a>
      )}

      {phase === "network" && (
        <button
          type="button"
          className="btn-mira"
          onClick={() => {
            setResult(null);
            setAttempt((n) => n + 1);
          }}
          style={{ display: "inline-flex", marginTop: 30, fontSize: 16, padding: "16px 32px", border: "none", cursor: "pointer" }}
        >
          Try again
        </button>
      )}

      {showRecovery && (
        <div style={{ ...CARD, textAlign: "center" }}>
          <p style={{ fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--mira-rose-ink)", fontWeight: 600, margin: 0 }}>
            How to get connected
          </p>
          <p style={{ fontSize: 15, color: "var(--mira-graphite)", margin: "12px 0 0", lineHeight: 1.6 }}>
            If you already have a plan, your account page can issue a fresh connection link. If you&apos;re not sure whether a
            purchase went through, tell us and we&apos;ll check for you — please don&apos;t pay again.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginTop: 18 }}>
            <Link className="btn-mira" href="/mira/account" style={{ display: "inline-flex", fontSize: 15, padding: "13px 26px" }}>
              Go to your account
            </Link>
            <Link className="btn-mira-soft" href="/contact" style={{ display: "inline-flex", fontSize: 15, padding: "13px 26px" }}>
              Contact us
            </Link>
          </div>
        </div>
      )}

      {/* No channel disclosure is rendered here on purpose. The canonical, reviewed
          WhatsApp disclosure is _components/WhatsAppDisclosure.tsx (specs#160) and the
          consent gate lives in the signup wizard, which the customer passes through
          before reaching this page. A second wording of a legal notice is a liability,
          so this page states none. */}
      {phase === "ready" && (
        <div style={CARD}>
          <p style={{ fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--mira-rose-ink)", fontWeight: 600, margin: 0 }}>
            What happens next
          </p>
          {steps.map(([t, s], i) => (
            <div key={t} style={{ display: "flex", gap: 14, marginTop: 16 }}>
              <span style={{ flex: "none", display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: "50%", color: "#fff", background: "var(--mira-grad-presence, var(--mira-gradient-presence))", fontSize: 13, fontWeight: 600 }}>{i + 1}</span>
              <div>
                <p className="display" style={{ fontSize: 16, fontWeight: 400, margin: 0 }}>{t}</p>
                <p style={{ fontSize: 14, color: "var(--mira-graphite)", margin: "2px 0 0", lineHeight: 1.5 }}>{s}</p>
              </div>
            </div>
          ))}
        </div>
      )}

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
