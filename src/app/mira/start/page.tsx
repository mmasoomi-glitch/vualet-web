"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  DEFAULT_CALLING_CODE,
  isPhoneReason,
  normalisePhone,
  phoneErrorText,
} from "@/lib/phone";
import WhatsAppDisclosure from "@/app/mira/_components/WhatsAppDisclosure";
// The consent RULE comes from its definition, not from the component that renders the copy.
// WhatsAppDisclosure re-exports these for backwards compatibility, but pointing at the shim
// would hide which module actually owns the rule — and the whole reason it moved to
// @/lib/consent is that the browser predicate and the two server validators must be one thing.
import {
  EMPTY_WHATSAPP_CONSENT,
  whatsAppConsentComplete,
  type WhatsAppConsent,
} from "@/lib/consent";

/* ---------- presets / option data ---------- */

const VIBES: { id: string; label: string; blurb: string }[] = [
  { id: "warm", label: "Warm & gentle", blurb: "Soft-spoken, patient, always kind." },
  { id: "bright", label: "Bright & playful", blurb: "Quick wit, a little sparkle." },
  { id: "calm", label: "Calm & grounded", blurb: "Steady, unhurried, reassuring." },
  { id: "sharp", label: "Sharp & direct", blurb: "Clear, candid, no filler." },
];

const ROLES: { id: string; label: string; blurb: string }[] = [
  { id: "friend", label: "A friend", blurb: "Someone to talk to, who remembers." },
  { id: "tutor", label: "A tutor", blurb: "Teaches, tests, and explains." },
  { id: "assistant", label: "An assistant", blurb: "Gets things done for you." },
  { id: "coach", label: "A coach", blurb: "Keeps you moving, gently." },
];

// Mira lives in WhatsApp. This is not a picker any more: there is exactly one channel a new
// customer is offered, so the wizard states it plainly instead of showing a one-option choice
// or a greyed-out "coming soon" tile that the customer cannot act on.
const CHANNEL = {
  id: "whatsapp",
  label: "WhatsApp",
  note: "The chat you already use. No app to install.",
} as const;

// Language is a CONSTRAINT, not a personality trait. It used to be implicit: the only
// "reply in the user's language" rule lived inside the engine's DEFAULT_PERSONA, so anyone
// who shaped their own Mira here lost it and she drifted back to English mid-conversation.
// "Match me" keeps that mirroring behaviour; picking a language pins her to it explicitly.
const LANGUAGES: { id: string; label: string; blurb: string }[] = [
  { id: "auto", label: "Match me", blurb: "She replies in whatever language you write in." },
  { id: "English", label: "English", blurb: "Always English." },
  { id: "Arabic", label: "العربية · Arabic", blurb: "Always Arabic, in your dialect." },
  { id: "Persian", label: "فارسی · Persian", blurb: "Always Persian." },
];

const STEPS = ["Name", "Vibe", "Role", "Language", "WhatsApp", "Review"] as const;
type StepName = (typeof STEPS)[number];

// Every branch in this file is keyed by STEP.Name, never by a bare index. The wizard used to be
// written as `step === 4`, which meant inserting or reordering a single step silently re-pointed
// the gate, the renderer and the progress bar at different things. Deriving the indices from STEPS
// makes that class of bug impossible: rename or reorder above and everything below follows.
const STEP = Object.fromEntries(STEPS.map((label, i) => [label, i])) as Record<StepName, number>;
const LAST_STEP = STEPS.length - 1;

/** The language sentence added to her persona. Empty for "Match me" — the engine mirrors by default. */
function languageClause(langId: string): string {
  if (!langId || langId === "auto") return "";
  return ` Always reply in ${langId}, even if the customer writes in another language.`;
}

/* ---------- shared styles ---------- */

const card: React.CSSProperties = {
  background: "var(--mira-canvas)",
  border: "1px solid var(--mira-fog)",
  borderRadius: "var(--mira-radius-lg)",
  boxShadow: "var(--mira-shadow-sm)",
};

function OptionCard({
  selected,
  disabled,
  onClick,
  title,
  blurb,
  badge,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  blurb: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        textAlign: "left",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        background: selected ? "var(--mira-frost)" : "var(--mira-canvas)",
        border: `1.5px solid ${selected ? "var(--mira-rose)" : "var(--mira-fog)"}`,
        borderRadius: "var(--mira-radius-lg)",
        padding: 18,
        boxShadow: selected ? "var(--mira-shadow-md)" : "none",
        transition: "border-color .2s, box-shadow .2s, background .2s",
        position: "relative",
      }}
    >
      {badge && (
        <span
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            fontSize: 11,
            color: "var(--mira-slate)",
            background: "var(--mira-petal)",
            borderRadius: 999,
            padding: "2px 9px",
          }}
        >
          {badge}
        </span>
      )}
      <p className="display" style={{ fontSize: 17, fontWeight: 400, margin: "0 0 4px" }}>
        {title}
      </p>
      <p style={{ fontSize: 13.5, color: "var(--mira-graphite)", margin: 0, lineHeight: 1.5 }}>{blurb}</p>
    </button>
  );
}

/* ---------- main ---------- */

export default function ShapeYourMira() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [vibe, setVibe] = useState<string>("warm");
  const [vibeText, setVibeText] = useState("");
  const [role, setRole] = useState<string>("friend");
  const [lang, setLang] = useState<string>("auto");
  const [phone, setPhone] = useState("");
  // Errors appear once the customer has actually left the field, not while they are still
  // half-way through typing their own number.
  const [phoneTouched, setPhoneTouched] = useState(false);
  // RELEASE GATE C1 (decisions#340). Every box starts UNCHECKED — consent is something the
  // customer gives, never something we pre-give on their behalf. The optional observation
  // number is false in EMPTY_WHATSAPP_CONSENT and nothing here ever flips it for them.
  const [consent, setConsent] = useState<WhatsAppConsent>(EMPTY_WHATSAPP_CONSENT);
  // Set when they try to move on without consenting, so the reason appears instead of a
  // Continue button that simply does nothing.
  const [consentAttempted, setConsentAttempted] = useState(false);
  const [done, setDone] = useState(false);

  // WhatsApp is THE channel a new customer gets. It is a constant, not state, because there is
  // nothing here for them to choose between.
  const channel = CHANNEL.id;

  const vibeLabel = VIBES.find((v) => v.id === vibe)?.label ?? "";
  const roleLabel = ROLES.find((r) => r.id === role)?.label ?? "";
  const langLabel = LANGUAGES.find((l) => l.id === lang)?.label ?? "";
  const channelLabel = CHANNEL.label;

  // The single source of truth for "is this number usable". The same vendored normaliser the
  // engine uses, so a number typed here and a number shared in chat land on one identity.
  const phoneResult = useMemo(
    () => normalisePhone(phone, { defaultCallingCode: DEFAULT_CALLING_CODE }),
    [phone],
  );
  const phoneE164 = phoneResult.ok ? phoneResult.e164 : null;
  const phoneError = !phoneResult.ok && phoneTouched ? phoneErrorText(phoneResult.reason) : null;

  // The consent rule itself lives in WhatsAppDisclosure (writer C / specs#160) and is NOT
  // restated here. Three required boxes; the observation number is optional and excluded.
  const consentComplete = whatsAppConsentComplete(consent);

  // Compose the system prompt the assistant will adopt as its persona, and persist
  // the whole setup to localStorage so checkout can carry it through the
  // connect token to the assistant. (See /api/begin → /api/connect.)
  //
  // The channel and the number are persisted alongside the persona, because checkout needs to
  // know WHERE she is being connected, not just who she is. Only the NORMALISED E.164 number is
  // written — never a half-typed string, so nothing downstream can inherit an unusable number.
  // (This wizard has never rehydrated state on load; that is unchanged here.)
  useEffect(() => {
    const assistantName = name.trim() || "Mira";
    const roleText = (roleLabel || "personal assistant").toLowerCase();
    const vibeBlurb = VIBES.find((v) => v.id === vibe)?.blurb ?? "";
    const vibe_ = vibeText.trim() || vibeBlurb;
    const persona =
      `You are ${assistantName}, a ${roleText}. ${vibe_} ` +
      `Talk warmly and in character, keep replies short and natural, ` +
      `never mention being an AI, a model, or any company/technology.` +
      languageClause(lang);
    try {
      localStorage.setItem(
        "mira_setup",
        JSON.stringify({
          assistantName,
          role,
          vibe,
          language: lang,
          persona,
          channel,
          ...(phoneE164 ? { phone: phoneE164 } : {}),
        }),
      );
    } catch {
      /* ignore (e.g. storage disabled) */
    }
  }, [name, role, vibe, vibeText, roleLabel, lang, channel, phoneE164]);

  // The real connect link, issued by the server on submit. Until then it is null and no link is
  // shown — we never hand the customer a link that cannot actually bind them.
  //
  // Two server shapes are supported on purpose:
  //   WhatsApp → { token, channel: "whatsapp", pairUrl }
  //   Telegram → { token, botUrl }              (the legacy shape, for existing bindings)
  // We read whichever is present rather than assuming a Telegram deep link, and if NEITHER is
  // present we say so out loud instead of pretending the request merely failed.
  const [connectLink, setConnectLink] = useState<string | null>(null);
  const [connectChannel, setConnectChannel] = useState<string>(CHANNEL.id);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const canAdvance =
    (step === STEP.Name && name.trim().length > 0) ||
    (step === STEP.Vibe && !!vibe) ||
    (step === STEP.Role && !!role) ||
    (step === STEP.Language && !!lang) ||
    (step === STEP.WhatsApp && phoneResult.ok && consentComplete) ||
    step === STEP.Review;

  function next() {
    // The number step refuses in a way the customer can SEE. A dead Continue button that says
    // nothing is how someone ends up handing over a number without ever reading the risk.
    if (step === STEP.WhatsApp && (!phoneResult.ok || !consentComplete)) {
      if (!phoneResult.ok) setPhoneTouched(true);
      if (!consentComplete) setConsentAttempted(true);
      return;
    }
    if (step < LAST_STEP) setStep((s) => s + 1);
  }
  function back() {
    setStep((s) => Math.max(0, s - 1));
  }

  // Actually create the assistant. Everything the customer just shaped is sent
  // to /api/begin, which mints a real signed single-use connect token and
  // returns the real link that binds this setup to their chat.
  //
  // Note we deliberately reuse /api/begin rather than adding a new field to the
  // connect record: the engine's identity plumbing is being rebuilt in
  // parallel, and touching that shape here would risk a conflict (jury #105).
  async function submit() {
    // Last line of defence. The Review step can be reached with the number already entered, so
    // if it is somehow not usable by the time they press the button, stop here and send them
    // back to the field rather than posting a setup that cannot be delivered.
    if (!phoneResult.ok) {
      setPhoneTouched(true);
      setStep(STEP.WhatsApp);
      setSubmitError(phoneErrorText(phoneResult.reason));
      return;
    }
    // GATE C1. No connect call is made until the three required consents are given. This is a
    // second, independent check rather than a repeat of canAdvance: reaching Review must never
    // be enough on its own to bind a real WhatsApp number.
    if (!consentComplete) {
      setConsentAttempted(true);
      setStep(STEP.WhatsApp);
      setSubmitError("Please read the WhatsApp notice and tick the three required boxes first.");
      return;
    }
    setSubmitError(null);
    setSubmitBusy(true);
    const assistantName = name.trim() || "Mira";
    const roleText = (roleLabel || "personal assistant").toLowerCase();
    const vibeBlurb = VIBES.find((v) => v.id === vibe)?.blurb ?? "";
    const vibe_ = vibeText.trim() || vibeBlurb;
    const persona =
      `You are ${assistantName}, a ${roleText}. ${vibe_} ` +
      `Talk warmly and in character, keep replies short and natural, ` +
      `never mention being an AI, a model, or any company/technology.` +
      languageClause(lang);

    try {
      const res = await fetch("/api/begin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // ONE canonical shape. `channel`, `phone` and `consent` are binding parameters and live
        // at the top level, which is exactly where /api/begin reads them (route.ts:105-114).
        // `setup` carries personality only. They are deliberately NOT duplicated in both places:
        // two copies of the same field is ambiguity about which one wins, not defensiveness.
        //
        // `consent` is sent so the record of what the customer was told, and agreed to, exists
        // server-side and not only in this component's memory. A gate that lives only in the
        // browser is a gate anyone can walk around.
        body: JSON.stringify({
          channel,
          phone: phoneResult.e164,
          consent,
          setup: { assistantName, role, vibe, language: lang, persona },
        }),
      });
      const data = await res.json().catch(() => ({}));

      // 503 — the WhatsApp pairing surface is not open on OUR side yet. This is our
      // configuration, not anything the customer did, and the server refuses BEFORE it mints or
      // stores anything (route.ts:166-176), so there is no half-made account to worry about.
      // Say that, rather than a blaming "try once more".
      if (res.status === 503 && data.error === "whatsapp_unavailable") {
        setSubmitError(
          "WhatsApp signup isn't open on our side yet — that's us, not you. Nothing was created and nothing was charged. Everything you chose is still here; please try again shortly.",
        );
        setSubmitBusy(false);
        return;
      }

      // 400 invalid_phone — the server re-normalises with the SAME vendored rules this page
      // uses, so this should be unreachable. If it ever fires, the two copies have drifted:
      // trust the server, show its reason, and put the customer back on the field.
      if (res.status === 400 && data.error === "invalid_phone") {
        setPhoneTouched(true);
        setStep(STEP.WhatsApp);
        setSubmitError(phoneErrorText(isPhoneReason(data.reason) ? data.reason : "length"));
        setSubmitBusy(false);
        return;
      }

      // Read whichever connect link this channel returns; never assume a Telegram deep link.
      const link: string | null =
        (typeof data.pairUrl === "string" && data.pairUrl) ||
        (typeof data.botUrl === "string" && data.botUrl) ||
        null;

      if (res.ok && link) {
        setConnectLink(link);
        setConnectChannel(
          typeof data.channel === "string" && data.channel
            ? data.channel
            : data.pairUrl
              ? "whatsapp"
              : "telegram",
        );
        try {
          localStorage.setItem("mira_connect_url", link);
          // Kept for anything still reading the old key on the Telegram path only — we do not
          // write a WhatsApp pairing URL into a key named "bot_url".
          if (typeof data.botUrl === "string" && data.botUrl) {
            localStorage.setItem("mira_bot_url", data.botUrl);
          }
        } catch {
          /* ignore (e.g. storage disabled) */
        }
        setDone(true);
        return;
      }

      if (res.ok) {
        // The server accepted the setup but handed back no way to reach her. Retrying would
        // mint a SECOND token and still leave the customer with nothing, so say plainly what
        // happened instead of showing the generic "try once more" and hoping.
        setSubmitError(
          `${assistantName} was created, but we didn't get your connect link back. Nothing is lost — open your account and we'll finish connecting her there.`,
        );
      } else {
        setSubmitError(
          data.message || "We couldn't set her up just then. Try once more?",
        );
      }
    } catch {
      setSubmitError("Something went wrong on our side. Try once more?");
    }
    setSubmitBusy(false);
  }

  function skip() {
    // Never block onboarding on this form: hand over an empty setup so the
    // bot greets first and asks who she should be, capturing the reply as
    // the persona in chat.
    try {
      localStorage.setItem("mira_setup", JSON.stringify({}));
    } catch {
      /* ignore */
    }
    window.location.href = "/mira/plans";
  }

  /* ---------- confirmation screen ---------- */
  if (done) {
    // Whatever the server bound her to, name it honestly. `done` is only ever set with a real
    // link in hand, so there is no state here where we promise a chat we cannot open.
    const openWhere = connectChannel === "telegram" ? "Telegram" : "WhatsApp";
    return (
      <main style={{ minHeight: "70vh", display: "grid", placeItems: "center", padding: "64px 24px" }}>
        <div style={{ ...card, maxWidth: 560, width: "100%", padding: "40px 32px", textAlign: "center", position: "relative", overflow: "hidden" }}>
          <div
            className="mira-aura"
            aria-hidden
            style={{ position: "absolute", inset: "-40% 0 auto 0", height: 280, margin: "auto", background: "var(--mira-grad-aura)", filter: "blur(70px)", opacity: 0.3, zIndex: 0 }}
          />
          <div style={{ position: "relative", zIndex: 1 }}>
            <div style={{ display: "grid", placeItems: "center", width: 56, height: 56, borderRadius: "50%", margin: "0 auto 18px", background: "var(--mira-grad-presence)", color: "#fff", fontSize: 26 }}>
              ✓
            </div>
            <h1 className="display" style={{ fontSize: "clamp(26px,4vw,34px)", margin: "0 0 8px" }}>
              {name || "Mira"} is ready to meet you.
            </h1>
            <p style={{ color: "var(--mira-graphite)", fontSize: 15.5, lineHeight: 1.6, margin: "0 auto 26px", maxWidth: 420 }}>
              Open her in {openWhere} and say hello. She already knows she&apos;s your {roleLabel.toLowerCase()} — {vibeLabel.toLowerCase()}.
            </p>
            {connectLink && (
              <a className="btn-mira" href={connectLink} target="_blank" rel="noopener noreferrer" style={{ width: "100%", maxWidth: 320 }}>
                Open {name || "Mira"} in {openWhere} →
              </a>
            )}
            <p style={{ fontSize: 12.5, color: "var(--mira-slate)", margin: "14px 0 0" }}>
              This link is yours alone — it connects her to your chat the first time you open it.
              {phoneE164 && openWhere === "WhatsApp" ? ` She's expecting ${phoneE164}.` : ""}
            </p>
            <div style={{ marginTop: 22, paddingTop: 22, borderTop: "1px solid var(--mira-fog)", display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <Link className="btn-mira-soft" href="/mira/plans">
                Pick a plan
              </Link>
              <Link className="btn-mira-soft" href="/mira/account">
                Go to account
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  /* ---------- builder ---------- */
  return (
    <main id="mira-main" style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px 80px" }}>
      <header style={{ textAlign: "center", marginBottom: 28 }}>
        <h1 className="display" style={{ fontSize: "clamp(30px,5vw,46px)", margin: "0 0 8px" }}>
          Shape your <span className="grad">Mira</span>
        </h1>
        <p style={{ color: "var(--mira-graphite)", fontSize: 16, margin: 0 }}>
          Tell her who to be. You can change any of this later, just by asking.
        </p>
      </header>

      {/* progress */}
      <div style={{ display: "flex", gap: 8, marginBottom: 28 }}>
        {STEPS.map((label, i) => (
          <div key={label} style={{ flex: 1 }}>
            <div
              style={{
                height: 4,
                borderRadius: 999,
                background: i <= step ? "var(--mira-grad-presence)" : "var(--mira-fog)",
                transition: "background .3s",
              }}
            />
            <span style={{ fontSize: 11, color: i === step ? "var(--mira-rose-ink)" : "var(--mira-slate)", display: "block", marginTop: 6, textAlign: "center" }}>
              {label}
            </span>
          </div>
        ))}
      </div>

      <div style={{ ...card, padding: "28px 24px" }}>
        {/* STEP 0 — name */}
        {step === STEP.Name && (
          <div>
            <h2 className="display" style={{ fontSize: 22, fontWeight: 400, margin: "0 0 6px" }}>What should I call her?</h2>
            <p style={{ color: "var(--mira-graphite)", fontSize: 14.5, margin: "0 0 18px" }}>A name makes her yours. Mira is just fine, too.</p>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canAdvance && next()}
              placeholder="Mira"
              maxLength={32}
              style={{
                width: "100%",
                fontSize: 18,
                padding: "14px 16px",
                borderRadius: "var(--mira-radius-lg)",
                border: "1.5px solid var(--mira-fog)",
                background: "var(--mira-cream)",
                color: "var(--mira-ink)",
                outline: "none",
              }}
            />
          </div>
        )}

        {/* STEP 1 — vibe */}
        {step === STEP.Vibe && (
          <div>
            <h2 className="display" style={{ fontSize: 22, fontWeight: 400, margin: "0 0 6px" }}>How should she feel?</h2>
            <p style={{ color: "var(--mira-graphite)", fontSize: 14.5, margin: "0 0 18px" }}>Pick a starting vibe — then add a few words in your own voice.</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
              {VIBES.map((v) => (
                <OptionCard key={v.id} selected={vibe === v.id} onClick={() => setVibe(v.id)} title={v.label} blurb={v.blurb} />
              ))}
            </div>
            <textarea
              value={vibeText}
              onChange={(e) => setVibeText(e.target.value)}
              placeholder="Optional — e.g. 'talks like my older sister, never lectures, loves a good list.'"
              rows={3}
              maxLength={280}
              style={{
                marginTop: 14,
                width: "100%",
                fontSize: 14.5,
                padding: "12px 14px",
                borderRadius: "var(--mira-radius-lg)",
                border: "1.5px solid var(--mira-fog)",
                background: "var(--mira-cream)",
                color: "var(--mira-ink)",
                outline: "none",
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
          </div>
        )}

        {/* STEP 2 — role */}
        {step === STEP.Role && (
          <div>
            <h2 className="display" style={{ fontSize: 22, fontWeight: 400, margin: "0 0 6px" }}>What is she here for?</h2>
            <p style={{ color: "var(--mira-graphite)", fontSize: 14.5, margin: "0 0 18px" }}>She can be more than one thing — pick where she starts.</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
              {ROLES.map((r) => (
                <OptionCard key={r.id} selected={role === r.id} onClick={() => setRole(r.id)} title={r.label} blurb={r.blurb} />
              ))}
            </div>
          </div>
        )}

        {/* STEP 3 — language */}
        {step === STEP.Language && (
          <div>
            <h2 className="display" style={{ fontSize: 22, fontWeight: 400, margin: "0 0 6px" }}>What language should she speak?</h2>
            <p style={{ color: "var(--mira-graphite)", fontSize: 14.5, margin: "0 0 18px" }}>Pick one and she stays in it. Or let her follow your lead.</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
              {LANGUAGES.map((l) => (
                <OptionCard key={l.id} selected={lang === l.id} onClick={() => setLang(l.id)} title={l.label} blurb={l.blurb} />
              ))}
            </div>
            <p style={{ fontSize: 12.5, color: "var(--mira-slate)", margin: "14px 0 0" }}>
              You can change this any time — just tell her in chat.
            </p>
          </div>
        )}

        {/* STEP — WhatsApp: where she lives, and the number she'll answer on */}
        {step === STEP.WhatsApp && (
          <div>
            {/* GATE C1 (decisions#340): the risk copy is on screen BEFORE the number field, not
                after it and not behind a link. The customer reads what WhatsApp can do to the
                number they are about to type, and consents, or they do not proceed. */}
            <WhatsAppDisclosure value={consent} onChange={setConsent} />

            <div style={{ marginTop: 26, paddingTop: 24, borderTop: "1px solid var(--mira-fog)" }}>
              <h2 className="display" style={{ fontSize: 22, fontWeight: 400, margin: "0 0 6px" }}>
                Which number should she connect?
              </h2>
              <p style={{ color: "var(--mira-graphite)", fontSize: 14.5, margin: "0 0 18px" }}>
                She lives in {CHANNEL.label} — {CHANNEL.note.toLowerCase()} This is the number that
                gets connected, so choose one you can afford to lose.
              </p>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onBlur={() => setPhoneTouched(true)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  setPhoneTouched(true);
                  if (canAdvance) next();
                }}
                placeholder="+971 50 123 4567"
                maxLength={24}
                aria-label="Your WhatsApp number"
                aria-invalid={phoneError ? true : undefined}
                aria-describedby={phoneError ? "phone-error" : "phone-hint"}
                style={{
                  width: "100%",
                  fontSize: 18,
                  padding: "14px 16px",
                  borderRadius: "var(--mira-radius-lg)",
                  border: `1.5px solid ${phoneError ? "var(--mira-rose)" : "var(--mira-fog)"}`,
                  background: "var(--mira-cream)",
                  color: "var(--mira-ink)",
                  outline: "none",
                }}
              />
              {phoneError ? (
                <p
                  id="phone-error"
                  role="alert"
                  style={{ fontSize: 13, color: "var(--mira-rose-ink)", margin: "10px 0 0", lineHeight: 1.5 }}
                >
                  {phoneError}
                </p>
              ) : (
                <p
                  id="phone-hint"
                  style={{ fontSize: 12.5, color: "var(--mira-slate)", margin: "10px 0 0", lineHeight: 1.5 }}
                >
                  {phoneE164
                    ? `We'll connect her to ${phoneE164}.`
                    : `A local number is fine — we'll add +${DEFAULT_CALLING_CODE} for you. For anywhere else, start with + and your country code.`}
                </p>
              )}
              {consentAttempted && !consentComplete && (
                <p
                  role="alert"
                  style={{ fontSize: 13, color: "var(--mira-rose-ink)", margin: "12px 0 0", lineHeight: 1.5 }}
                >
                  Please tick the three required boxes above. We can&apos;t connect a number until
                  you&apos;ve confirmed you understand what WhatsApp can do to it.
                </p>
              )}
            </div>
          </div>
        )}

        {/* STEP — review */}
        {step === STEP.Review && (
          <div>
            <h2 className="display" style={{ fontSize: 22, fontWeight: 400, margin: "0 0 16px" }}>Meet {name || "Mira"}.</h2>
            <dl style={{ margin: 0 }}>
              {[
                ["Name", name || "Mira"],
                ["Vibe", vibeLabel + (vibeText ? ` — “${vibeText}”` : "")],
                ["Role", roleLabel],
                ["Language", langLabel],
                ["Channel", channelLabel],
                ["Number", phoneE164 ?? "—"],
                // Stated neutrally, as a choice they made — not sold back to them as a feature.
                ["Observation number", consent.observationNumber ? "Added" : "Not added"],
              ].map(([k, v], i) => (
                <div key={k} style={{ display: "flex", gap: 16, padding: "12px 0", borderTop: i === 0 ? "none" : "1px solid var(--mira-fog)" }}>
                  <dt style={{ width: 90, flexShrink: 0, fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--mira-slate)", paddingTop: 2 }}>{k}</dt>
                  <dd style={{ margin: 0, fontSize: 15.5, color: "var(--mira-ink)", lineHeight: 1.5 }}>{v}</dd>
                </div>
              ))}
            </dl>
            <p style={{ fontSize: 13, color: "var(--mira-slate)", marginTop: 16 }}>
              You&apos;ll start on the free plan. Upgrade whenever she&apos;s earned it.
            </p>
          </div>
        )}

        {/* nav */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 28, gap: 12 }}>
          {step > 0 ? (
            <button type="button" onClick={back} className="btn-mira-soft" style={{ background: "transparent", color: "var(--mira-graphite)" }}>
              ← Back
            </button>
          ) : (
            <Link href="/mira" className="btn-mira-soft" style={{ background: "transparent", color: "var(--mira-graphite)" }}>
              ← Cancel
            </Link>
          )}
          <button
            type="button"
            onClick={skip}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13.5, color: "var(--mira-slate)", textDecoration: "underline", textUnderlineOffset: 3 }}
          >
            Skip — let her ask me
          </button>
          {step < LAST_STEP ? (
            <button type="button" onClick={next} disabled={!canAdvance} className="btn-mira" style={{ opacity: canAdvance ? 1 : 0.5, cursor: canAdvance ? "pointer" : "not-allowed" }}>
              Continue →
            </button>
          ) : (
            <button type="button" onClick={submit} disabled={submitBusy} className="btn-mira" style={{ opacity: submitBusy ? 0.7 : 1, cursor: submitBusy ? "wait" : "pointer" }}>
              {submitBusy ? "Bringing her to life…" : "Bring her to life →"}
            </button>
          )}
        </div>
        {submitError && (
          <p role="alert" style={{ textAlign: "center", fontSize: 13.5, color: "var(--mira-rose-ink)", margin: "14px 0 0" }}>
            {submitError}
          </p>
        )}
      </div>
    </main>
  );
}
