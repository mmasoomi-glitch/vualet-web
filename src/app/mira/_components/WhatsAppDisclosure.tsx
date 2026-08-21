"use client";

/* RELEASE GATE C1 — honest disclosure before a customer connects WhatsApp.
   The copy below is the canonical approved text (specs#160) and is rendered
   faithfully: the same six sections in the same order, the risk NOT buried, and
   the four consent checkboxes with only the fourth optional.

   specs#160 records DELIBERATE OMISSIONS. Do not "improve" this file by adding
   any of them back:
     - no ban probability, frequency or likelihood ("rare", "unlikely", "we have
       never seen it") — no substantiated data exists;
     - no claim that a ban is reversible, appealable, or that we will intervene;
     - no promise of compensation, restoration or replacement;
     - no detail of what WhatsApp detects or how (speculative, and an evasion guide);
     - no widening of "encrypted at rest" into a broader security or privacy claim;
     - no framing of the observation number as a benefit or as "monitoring for you";
     - no claim that declining the observation number is cost-free beyond "does not
       affect the service you receive".
   No emoji, and no reassurance the spec withholds. Softening this text re-opens
   release gate C1 (decisions#340).

   Rendering is self-contained (scoped .wad-* styles inline) so it can be dropped
   into the signup wizard without touching mira-theme.css. Wiring it into the
   wizard belongs to the wizard file, not here. */

import { useId, useState } from "react";

/* The consent RULE is NOT defined here. It lives once, in src/lib/consent.ts,
   because this browser predicate and the server-side validators in /api/begin and
   /api/checkout must never drift apart — the drift is silent and lands either as a
   wizard that goes green while the server records nothing, or a server that refuses
   a form the customer genuinely completed. That module is plain TypeScript with no
   imports and no "use client" directive, which is exactly what lets a client
   component and a route handler share it. Do not re-add a local copy.
   What lives in THIS file is the disclosure COPY (specs#160), and nothing else. */
import {
  EMPTY_WHATSAPP_CONSENT,
  whatsAppConsentComplete,
  type WhatsAppConsent,
} from "@/lib/consent";

/* Re-exported so today's importers of this component — the signup wizard and the
   checkout page — keep compiling unchanged. These are pass-throughs, not a second
   definition: @/lib/consent remains the only place the rule is written down. */
export { EMPTY_WHATSAPP_CONSENT, whatsAppConsentComplete };
export type { WhatsAppConsent };

type Props = {
  /** Controlled value. Omit to let the component hold its own state. */
  value?: WhatsAppConsent;
  /** Called with the full next consent object on every change. */
  onChange?: (next: WhatsAppConsent) => void;
  /** Optional wrapper class, e.g. to slot it into a wizard step. */
  className?: string;
};

const CSS = `
.wad { color: var(--mira-ink, #1C1830); font-size: 1rem; line-height: 1.55; text-align: start; }
.wad-h2 { font-family: var(--font-mira-display, "Fraunces", Georgia, serif); font-weight: 400;
  font-size: clamp(1.4rem, 2.6vw, 1.9rem); line-height: 1.15; margin: 0 0 6px; letter-spacing: -.01em; }
.wad-lede { color: var(--mira-graphite, #4A4560); margin: 0 0 22px; font-size: .98rem; }
.wad-sec { margin: 0 0 18px; }
.wad-k { font-family: var(--mira-mono, ui-monospace, Consolas, monospace); font-size: .68rem;
  letter-spacing: .14em; text-transform: uppercase; color: var(--mira-rose-ink, #935312);
  display: block; margin: 0 0 6px; }
.wad-sec p { margin: 0 0 8px; color: var(--mira-graphite, #4A4560); }
.wad-sec p:last-child { margin-bottom: 0; }
.wad-risk { border: 2px solid var(--mira-rose-ink, #935312); border-radius: var(--mira-radius-lg, 24px);
  background: var(--mira-canvas, #FCFAF5); padding: 22px 24px; margin: 0 0 20px; }
.wad-risk p { color: var(--mira-ink, #1C1830); margin: 0 0 8px; }
.wad-risk p:last-child { margin-bottom: 0; }
.wad-shout { font-weight: 600; text-transform: uppercase; letter-spacing: .02em; }
.wad-fs { border: 1px solid var(--mira-fog, #E4E0D8); border-radius: var(--mira-radius-lg, 24px);
  padding: 20px 22px; margin: 24px 0 0; background: var(--mira-frost, #EFEBE2); }
.wad-lg { font-family: var(--mira-mono, ui-monospace, Consolas, monospace); font-size: .68rem;
  letter-spacing: .14em; text-transform: uppercase; color: var(--mira-graphite, #4A4560);
  padding: 0; margin: 0 0 14px; }
.wad-row { display: flex; align-items: flex-start; gap: 12px; margin: 0 0 14px; }
.wad-row:last-child { margin-bottom: 0; }
.wad-row input[type="checkbox"] { flex: none; width: 20px; height: 20px; margin: 2px 0 0;
  accent-color: var(--mira-aether-ink, #4F46E5); cursor: pointer; }
.wad-row input[type="checkbox"]:focus-visible { outline: 3px solid var(--mira-aether-ink, #4F46E5); outline-offset: 2px; }
.wad-row label { cursor: pointer; color: var(--mira-ink, #1C1830); font-size: .96rem; line-height: 1.5; }
.wad-opt { font-family: var(--mira-mono, ui-monospace, Consolas, monospace); font-size: .62rem;
  letter-spacing: .14em; text-transform: uppercase; color: var(--mira-graphite, #4A4560);
  border: 1px solid var(--mira-fog, #E4E0D8); border-radius: var(--mira-radius-full, 999px);
  padding: 2px 8px; margin-inline-end: 8px; background: #fff; white-space: nowrap; }
@media (max-width: 640px) { .wad-risk, .wad-fs { padding-inline: 18px; } }
`;

export default function WhatsAppDisclosure({ value, onChange, className }: Props) {
  const uid = useId();
  const [own, setOwn] = useState<WhatsAppConsent>(EMPTY_WHATSAPP_CONSENT);
  const consent = value ?? own;

  function toggle(key: keyof WhatsAppConsent) {
    const next = { ...consent, [key]: !consent[key] };
    if (value === undefined) setOwn(next);
    onChange?.(next);
  }

  function box(key: keyof WhatsAppConsent, optional: boolean, text: React.ReactNode) {
    const id = `${uid}-${key}`;
    return (
      <div className="wad-row">
        <input type="checkbox" id={id} checked={consent[key]} onChange={() => toggle(key)} />
        <label htmlFor={id}>
          {optional && <span className="wad-opt">Optional</span>}
          {text}
        </label>
      </div>
    );
  }

  return (
    <section className={className ? `wad ${className}` : "wad"} aria-labelledby={`${uid}-h`}>
      <style>{CSS}</style>

      <h2 id={`${uid}-h`} className="wad-h2">Before You Connect WhatsApp: Please Read This.</h2>
      <p className="wad-lede">
        This explains exactly how the WhatsApp connection works and what it risks. Read it before you connect a number.
      </p>

      {/* 1 — HOW THIS WORKS */}
      <div className="wad-sec">
        <span className="wad-k">1 &middot; How this works</span>
        <p>
          This assistant connects using headless WhatsApp Web (the Baileys library) &mdash; the same technology behind
          WhatsApp Web in a browser, automated. It is <strong>not</strong> WhatsApp&rsquo;s official Business API. It
          links as a paired device on your own WhatsApp account.
        </p>
      </div>

      {/* 2 — THE RISK. Stated bluntly, never buried, never softened. */}
      <div className="wad-risk">
        <span className="wad-k">2 &middot; The risk &mdash; read this even if you skip everything else</span>
        <p>
          This method <strong>violates WhatsApp&rsquo;s Terms of Service</strong>. WhatsApp can detect this kind of use
          and <strong>ban or restrict the phone number you connect</strong>, with no guaranteed appeal and no
          compensation from us.
        </p>
        <p>This is a real and ongoing risk, not a one-time possibility.</p>
        <p className="wad-shout">Do not connect a number you cannot afford to lose.</p>
        <p>We recommend a secondary or dedicated number, not your primary line.</p>
      </div>

      {/* 3 — HOW THE ASSISTANT APPEARS */}
      <div className="wad-sec">
        <span className="wad-k">3 &middot; How the assistant appears</span>
        <p>
          It runs inside a WhatsApp group you create, and depending on your setup its replies may appear to come from
          your own account rather than a separate bot identity.
        </p>
      </div>

      {/* 4 — OPTIONAL OBSERVATION NUMBER (described neutrally, never sold) */}
      <div className="wad-sec">
        <span className="wad-k">4 &middot; Optional observation number</span>
        <p>
          You may choose to add a company-operated WhatsApp number to your group. If added, it can read{" "}
          <strong>every message in that group</strong>, for quality monitoring and escalation. It is:
        </p>
        <p>
          <strong>Off by default</strong> &mdash; we do not add it without your action.{" "}
          <strong>Not anonymous</strong> &mdash; it appears as a visible participant.{" "}
          <strong>Removable at any time</strong> &mdash; by you, like any other member.{" "}
          <strong>Not required</strong> &mdash; declining has no effect on the service you receive.
        </p>
      </div>

      {/* 5 — DATA HANDLING (exactly this, and nothing broader) */}
      <div className="wad-sec">
        <span className="wad-k">5 &middot; Data handling</span>
        <p>Messages are encrypted at rest on our servers.</p>
      </div>

      {/* 6 — DECLINING */}
      <div className="wad-sec">
        <span className="wad-k">6 &middot; If you would rather not</span>
        <p>You may decline any part of this and use an alternative channel instead.</p>
      </div>

      {/* CONSENT — each required to proceed except where marked optional */}
      <fieldset className="wad-fs">
        <legend className="wad-lg">Your consent &mdash; each required to proceed except where marked optional</legend>

        {box(
          "unofficialAutomation",
          false,
          <>I understand this uses unofficial WhatsApp automation, not WhatsApp&rsquo;s Business API.</>
        )}
        {box(
          "banRisk",
          false,
          <>
            I understand this may cause WhatsApp to ban or restrict the phone number I connect, and I am choosing to
            accept that risk.
          </>
        )}
        {box(
          "ownAccountReplies",
          false,
          <>I understand the assistant&rsquo;s replies may appear to come from my own WhatsApp account.</>
        )}
        {box(
          "observationNumber",
          true,
          <>
            I choose to add the observation number to my group, understanding it can read all group messages, is not
            anonymous, and can be removed at any time.
          </>
        )}
      </fieldset>
    </section>
  );
}
