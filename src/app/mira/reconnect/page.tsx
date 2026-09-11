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

import { useMemo, useState, type FormEvent } from "react";
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

export default function ReconnectPage() {
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
