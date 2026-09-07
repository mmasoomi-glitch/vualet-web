"use client";

/* RELEASE GATE C1 — honest disclosure before a customer connects WhatsApp.
   Revision r2 (specs#160r2). The six sections and four checkboxes of specs#160
   are now three sections and TWO checkboxes, one of which is optional.

   WHAT CHANGED AND WHY — read this before you "restore" anything:
     - The product's normal shape is a PRIVATE SELF-CHAT: the customer messages
       themselves and the assistant replies from their own account. specs#160's
       section 3 ("It runs inside a WhatsApp group you create") had become
       FACTUALLY WRONG. It is replaced by the truth, not softened.
     - The three required ticks became ONE. "Unofficial automation" and "ban
       risk" are two halves of one fact — the unofficial automation IS what
       creates the ban risk — so they are merged into a single box that states
       both. The judge (google/gemini-2.5-flash, gen-1787492131-bFj1wgqjjyikuMA3lZbv)
       accepted the merge and REFUSED to demote the ban risk to prose at all.
     - "Replies come from your own account" is now PROSE, not a tick. The judge:
       it "is a product feature, not a risk or consequence". It is still on this
       screen, above the box.
   No RISK FACT was removed. Only the number of ticks changed. Two specs#160
   sentences were dropped as redundant on the judge's ruling ("we recommend a
   secondary or dedicated number", covered by the shout line; "you may decline
   any part of this", inherent in an unticked box). A third the judge ordered
   RESTORED, and it is back verbatim in the risk box below.

   specs#160 records DELIBERATE OMISSIONS. They still bind. Do not "improve"
   this file by adding any of them back:
     - no ban probability, frequency or likelihood ("rare", "unlikely", "we have
       never seen it") — no substantiated data exists, and the self-chat shape is
       NOT a licence to imply the risk is small;
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
   What lives in THIS file is the disclosure COPY (specs#160r2), and nothing else. */
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
.wad-row input[type="checkbox"] { flex: none; width: 24px; height: 24px; margin: 2px 0 0;
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
        {/* treat absent optional key as false */}
        <input type="checkbox" id={id} checked={consent[key] ?? false} onChange={() => toggle(key)} />
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

      <h2 id={`${uid}-h`} className="wad-h2">Your AI, your own WhatsApp</h2>
      <p className="wad-lede">Message yourself and get AI replies from your own number&mdash;private by default.</p>

      {/* HOW THIS WORKS. The self-chat shape is stated because it is the truth,
          not because it makes the risk below sound smaller. */}
      <div className="wad-sec">
        <span className="wad-k">How this works</span>
        <p>This assistant links as a paired device using unofficial automation, not WhatsApp&rsquo;s official Business API.</p>
        <p>By default, it&rsquo;s a private chat with yourself: you message yourself, it replies from your account, group mode off unless turned on.</p>
      </div>

      {/* THE RISK. Stated bluntly, never buried, never softened. */}
      <div className="wad-risk">
        <span className="wad-k">The risk</span>
        <p>This breaks WhatsApp&rsquo;s Terms of Service, and WhatsApp can ban or restrict the number you connect with no guaranteed appeal and no compensation from us.</p>
        {/* RESTORED verbatim from specs#160 on the judge's ruling: "can ban" alone
            reads as a one-off, and this risk does not stop after setup. */}
        <p>This is a real and ongoing risk, not a one-time possibility.</p>
        <p className="wad-shout">Do not connect a number you cannot afford to lose.</p>
      </div>

      {/* DATA + the optional observation number, described neutrally, never sold. */}
      <div className="wad-sec">
        <span className="wad-k">Your data</span>
        <p>Messages are encrypted at rest on our servers.</p>
        <p>You may add a company-operated WhatsApp number that can read messages in the chat; it is off by default, appears as a visible participant, can be removed at any time, and declining does not affect the service you receive.</p>
      </div>

      {/* CONSENT — ONE required box (the merged unofficial-automation/ban-risk
          acceptance) and ONE optional opt-in. */}
      <fieldset className="wad-fs">
        <legend className="wad-lg">Your consent</legend>
        {box(
          "banRisk",
          false,
          <>I understand this connects to WhatsApp in a way WhatsApp does not officially allow, that WhatsApp can ban or restrict the number I connect, and I accept that risk.</>
        )}
        {box(
          "observationNumber",
          true,
          <>I choose to add the company-operated number, understanding it can read messages in the chat and can be removed at any time.</>
        )}
      </fieldset>
    </section>
  );
}
