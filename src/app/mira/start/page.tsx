"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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

const CHANNELS: { id: string; label: string; note: string; soon?: boolean }[] = [
  { id: "telegram", label: "Telegram", note: "Ready now · no new number" },
  { id: "whatsapp", label: "WhatsApp", note: "Coming soon", soon: true },
];

const STEPS = ["Name", "Vibe", "Role", "Channel", "Review"] as const;

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
  const [channel, setChannel] = useState<string>("telegram");
  const [done, setDone] = useState(false);

  const vibeLabel = VIBES.find((v) => v.id === vibe)?.label ?? "";
  const roleLabel = ROLES.find((r) => r.id === role)?.label ?? "";
  const channelLabel = CHANNELS.find((c) => c.id === channel)?.label ?? "";

  // Compose the system prompt the bot will adopt as its persona, and persist
  // the whole setup to localStorage so checkout can carry it through the
  // connect token to the Telegram bot. (See /api/begin → /api/connect.)
  useEffect(() => {
    const assistantName = name.trim() || "Mira";
    const roleText = (roleLabel || "personal assistant").toLowerCase();
    const vibeBlurb = VIBES.find((v) => v.id === vibe)?.blurb ?? "";
    const vibe_ = vibeText.trim() || vibeBlurb;
    const persona =
      `You are ${assistantName}, a ${roleText}. ${vibe_} ` +
      `Talk warmly and in character, keep replies short and natural, ` +
      `never mention being an AI, a model, or any company/technology.`;
    try {
      localStorage.setItem(
        "mira_setup",
        JSON.stringify({ assistantName, role, vibe, persona }),
      );
    } catch {
      /* ignore (e.g. storage disabled) */
    }
  }, [name, role, vibe, vibeText, roleLabel]);

  // TODO(backend): replace with the real Telegram bot deep-link once provisioning exists.
  const telegramLink = useMemo(() => {
    const payload = encodeURIComponent(
      `name=${name || "Mira"};vibe=${vibe};role=${role}`,
    );
    return `https://t.me/MiraAssistantBot?start=${payload}`;
  }, [name, vibe, role]);

  const canAdvance =
    (step === 0 && name.trim().length > 0) ||
    (step === 1 && !!vibe) ||
    (step === 2 && !!role) ||
    (step === 3 && channel === "telegram") ||
    step === 4;

  function next() {
    if (step < STEPS.length - 1) setStep((s) => s + 1);
  }
  function back() {
    setStep((s) => Math.max(0, s - 1));
  }

  function submit() {
    // TODO(backend): POST the assistant config to create the Mira instance,
    // then issue a real deep-link / linking code. For now we just confirm.
    setDone(true);
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
              Open her in Telegram and say hello. She already knows she&apos;s your {roleLabel.toLowerCase()} — {vibeLabel.toLowerCase()}.
            </p>
            <a className="btn-mira" href={telegramLink} target="_blank" rel="noopener noreferrer" style={{ width: "100%", maxWidth: 320 }}>
              Open {name || "Mira"} in Telegram →
            </a>
            <p style={{ fontSize: 12.5, color: "var(--mira-slate)", margin: "14px 0 0" }}>
              {/* TODO(backend): this is a placeholder deep-link. */}
              A placeholder link for now — your real Mira link arrives at launch.
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
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px 80px" }}>
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
            <span style={{ fontSize: 11, color: i === step ? "var(--mira-rose-deep)" : "var(--mira-slate)", display: "block", marginTop: 6, textAlign: "center" }}>
              {label}
            </span>
          </div>
        ))}
      </div>

      <div style={{ ...card, padding: "28px 24px" }}>
        {/* STEP 0 — name */}
        {step === 0 && (
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
        {step === 1 && (
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
        {step === 2 && (
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

        {/* STEP 3 — channel */}
        {step === 3 && (
          <div>
            <h2 className="display" style={{ fontSize: 22, fontWeight: 400, margin: "0 0 6px" }}>Where should she live?</h2>
            <p style={{ color: "var(--mira-graphite)", fontSize: 14.5, margin: "0 0 18px" }}>In the chat you already use. No app to install.</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
              {CHANNELS.map((c) => (
                <OptionCard
                  key={c.id}
                  selected={channel === c.id}
                  disabled={c.soon}
                  onClick={() => !c.soon && setChannel(c.id)}
                  title={c.label}
                  blurb={c.note}
                  badge={c.soon ? "Soon" : undefined}
                />
              ))}
            </div>
          </div>
        )}

        {/* STEP 4 — review */}
        {step === 4 && (
          <div>
            <h2 className="display" style={{ fontSize: 22, fontWeight: 400, margin: "0 0 16px" }}>Meet {name || "Mira"}.</h2>
            <dl style={{ margin: 0 }}>
              {[
                ["Name", name || "Mira"],
                ["Vibe", vibeLabel + (vibeText ? ` — “${vibeText}”` : "")],
                ["Role", roleLabel],
                ["Channel", channelLabel],
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
          {step < STEPS.length - 1 ? (
            <button type="button" onClick={next} disabled={!canAdvance} className="btn-mira" style={{ opacity: canAdvance ? 1 : 0.5, cursor: canAdvance ? "pointer" : "not-allowed" }}>
              Continue →
            </button>
          ) : (
            <button type="button" onClick={submit} className="btn-mira">
              Bring her to life →
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
