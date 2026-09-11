"use client";

/**
 * /mira/reconnect — the button that did not exist.
 *
 * A paying customer whose WhatsApp link dropped had no self-serve way back to a
 * QR code. The only visible route was /mira/start, which opens with persona
 * setup and reads like signing up and paying all over again. Re-pairing is
 * actually free — POST /api/begin has no payment gate — but nothing said so.
 *
 * The copy below exists to make that explicit, because a customer who thinks
 * reconnecting will charge them simply will not do it.
 */

import { Suspense, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  DEFAULT_CALLING_CODE,
  isPhoneReason,
  normalisePhone,
  phoneErrorText,
} from "@/lib/phone";
import WhatsAppDisclosure from "@/app/mira/_components/WhatsAppDisclosure";
import {
  CONSENT_DISCLOSURE,
  EMPTY_WHATSAPP_CONSENT,
  whatsAppConsentComplete,
  type WhatsAppConsent,
} from "@/lib/consent";

type BeginResponse = {
  pairUrl?: unknown;
  message?: unknown;
  error?: unknown;
};

/**
 * The token path: a customer who arrived from the assistant's automatic
 * reconnect message.
 *
 * They must not have to retype a number or re-consent. They are already a known
 * customer with consent on record, and the token identifies them — asking them
 * to fill in a form again would be the manual recovery workflow this whole
 * subsystem exists to remove, just wearing a nicer shirt.
 */
function TokenReconnect({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reconnect() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/channel/reconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data: { ok?: boolean; pairUrl?: string; message?: string } = await res
        .json()
        .catch(() => ({}));

      if (res.ok && data.ok && typeof data.pairUrl === "string") {
        window.location.href = data.pairUrl;
        // Deliberately NOT clearing busy. The navigation is already underway,
        // and re-enabling the button would invite a second click that spends a
        // token which no longer exists.
        return;
      }

      setError(
        typeof data.message === "string"
          ? data.message
          : "We couldn't use that link. Message Mira again and she'll send a fresh one.",
      );
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    }
    // Reached only on a failure path, so the customer can try again.
    setBusy(false);
  }

  return (
    <main style={{ maxWidth: 620, margin: "0 auto", padding: "32px 20px 64px" }}>
      <h1 className="display" style={{ fontSize: "clamp(26px,4.5vw,38px)", margin: "0 0 12px" }}>
        Reconnect Mira to WhatsApp
      </h1>

      <div style={{ lineHeight: 1.65, color: "var(--mira-slate, #5A5560)", marginBottom: 28 }}>
        <p style={{ margin: "0 0 12px" }}>
          <strong>This does not create a new subscription and does not charge you anything.</strong>{" "}
          Your plan and your history stay exactly as they are.
        </p>
        <p style={{ margin: 0 }}>
          We already know who you are, so there is nothing to fill in. Tap below and
          you&rsquo;ll get a QR code to scan from WhatsApp on your phone.
        </p>
      </div>

      <button
        type="button"
        onClick={reconnect}
        disabled={busy}
        style={{
          width: "100%",
          padding: "14px 18px",
          borderRadius: 12,
          border: "none",
          fontSize: 16,
          fontWeight: 600,
          cursor: busy ? "not-allowed" : "pointer",
          opacity: busy ? 0.6 : 1,
          background: "var(--mira-ink, #1B1721)",
          color: "#fff",
        }}
      >
        {busy ? "Reconnecting…" : "Reconnect WhatsApp"}
      </button>

      {error && (
        <div style={{ marginTop: 16 }}>
          <p
            style={{
              margin: "0 0 8px",
              padding: "10px 12px",
              borderRadius: 10,
              background: "rgba(220,38,38,0.08)",
              border: "1px solid rgba(220,38,38,0.25)",
              color: "#B91C1C",
              fontSize: 14,
            }}
          >
            {error}
          </p>
          {/* A dead end here would send them to support, which is the one
              workflow this page exists to remove. */}
          <p style={{ margin: 0, fontSize: 13, color: "var(--mira-slate, #5A5560)" }}>
            Message Mira again on WhatsApp and she&rsquo;ll send you a fresh link straight away.
          </p>
        </div>
      )}
    </main>
  );
}

/**
 * useSearchParams needs a Suspense boundary in the App Router, so the page is
 * the boundary and the work happens inside it. Reading window.location during
 * render instead would render the form on the server and the token view on the
 * client — a hydration mismatch — and reading it in an effect would set state
 * synchronously during mount and cascade a second render.
 */
export default function ReconnectPage() {
  return (
    <Suspense fallback={null}>
      <ReconnectInner />
    </Suspense>
  );
}

function ReconnectInner() {
  const token = useSearchParams().get("t") || "";

  const [phone, setPhone] = useState("");
  // Every box starts UNCHECKED. Consent is something the customer gives, never a default.
  const [consent, setConsent] = useState<WhatsAppConsent>(EMPTY_WHATSAPP_CONSENT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // normalisePhone returns a discriminated union — PhoneOk { ok: true, e164 }
  // or PhoneFail { ok: false, reason }. Narrow on `ok`; the fields do not
  // coexist, so neither can be read before the check.
  const normalised = useMemo(
    () => normalisePhone(phone, { defaultCallingCode: DEFAULT_CALLING_CODE }),
    [phone],
  );

  const phoneValid = normalised.ok;
  const e164 = normalised.ok ? normalised.e164 : "";
  const phoneError =
    phone.length > 0 && !normalised.ok && isPhoneReason(normalised.reason)
      ? phoneErrorText(normalised.reason)
      : null;

  // The consent RULE comes from its definition, not from a hand-rolled field check.
  const canSubmit = phoneValid && whatsAppConsentComplete(consent) && !busy;

  // A customer who arrived from the assistant's message takes the token path.
  // The self-serve form below stays for everyone else — someone who found this
  // page themselves, or whose link died — so neither route is a dead end.
  if (token) return <TokenReconnect token={token} />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/begin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: e164,
          channel: "whatsapp",
          consent,
          consentVersion: CONSENT_DISCLOSURE,
        }),
      });

      const data: BeginResponse = await res.json().catch(() => ({}));

      if (res.ok && typeof data.pairUrl === "string") {
        window.location.href = data.pairUrl;
        return;
      }

      const msg =
        typeof data.message === "string"
          ? data.message
          : typeof data.error === "string"
            ? data.error
            : "We couldn't start the reconnection. Please try again in a moment.";
      setError(msg);
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      // Never leave the button permanently disabled on a failure path.
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 620, margin: "0 auto", padding: "32px 20px 64px" }}>
      <h1 className="display" style={{ fontSize: "clamp(26px,4.5vw,38px)", margin: "0 0 12px" }}>
        Reconnect Mira to WhatsApp
      </h1>

      <div style={{ lineHeight: 1.65, color: "var(--mira-slate, #5A5560)", marginBottom: 28 }}>
        <p style={{ margin: "0 0 12px" }}>
          <strong>This does not create a new subscription and does not charge you anything.</strong>{" "}
          Your existing plan stays exactly as it is. This only links Mira back to your WhatsApp.
        </p>
        <p style={{ margin: "0 0 12px" }}>
          The link between Mira and WhatsApp can drop — a phone going offline for a
          long stretch, or WhatsApp retiring the linked device. While it is down she
          simply stops receiving your messages, which is why she can go quiet.
        </p>
        <p style={{ margin: 0 }}>
          It takes about a minute. On the next screen you&rsquo;ll get a QR code to scan
          from WhatsApp on your phone.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 20 }}>
          <label
            htmlFor="reconnect-phone"
            style={{ display: "block", marginBottom: 6, fontWeight: 600 }}
          >
            Your WhatsApp number
          </label>
          <input
            id="reconnect-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(ev) => setPhone(ev.target.value)}
            aria-invalid={phoneError ? true : undefined}
            aria-describedby={phoneError ? "reconnect-phone-error" : undefined}
            style={{
              width: "100%",
              padding: "11px 12px",
              fontSize: 16,
              border: `1px solid ${phoneError ? "#C2451E" : "#D8D3CB"}`,
              borderRadius: 8,
              boxSizing: "border-box",
            }}
          />
          {phoneError && (
            <span
              id="reconnect-phone-error"
              style={{ color: "#C2451E", fontSize: 13.5, display: "block", marginTop: 6 }}
            >
              {phoneError}
            </span>
          )}
        </div>

        <div style={{ marginBottom: 24 }}>
          <WhatsAppDisclosure value={consent} onChange={setConsent} />
        </div>

        {error && (
          <div
            role="alert"
            style={{
              background: "#FDF0EC",
              border: "1px solid #F0C9BC",
              color: "#8C2E13",
              padding: 12,
              borderRadius: 8,
              marginBottom: 16,
              fontSize: 14.5,
            }}
          >
            {error}
          </div>
        )}

        <button type="submit" className="btn-mira" disabled={!canSubmit} aria-busy={busy}>
          {busy ? "Preparing your QR code…" : "Reconnect WhatsApp"}
        </button>
      </form>

      <p style={{ marginTop: 28, fontSize: 14.5 }}>
        <Link href="/mira/account">← Back to your account</Link>
      </p>
    </main>
  );
}
