import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mira — Your Personal AI Assistant | Vualet",
  description:
    "Your own AI assistant, in the chat you already use. No app to install. Mira talks, remembers you, and gets things done on Telegram or WhatsApp.",
};

const STEPS: [string, string][] = [
  ["Pick & shape her", "Choose a plan and tell Mira who to be — a friend, a tutor, an assistant. She's yours alone."],
  ["Connect your chat", "Tap to open Telegram, or scan a code to link your own WhatsApp. No new number, no app."],
  ["Just talk", "Speak like you would to a person. She figures out the rest and hands you the result."],
];

const FEATURES: [string, string, string][] = [
  ["Companion", "Talks like a person", "Natural voice notes, in your language, who remembers your life across every chat."],
  ["Builder", "Makes real things", "Describe what you need in plain words; Mira builds it and sends it back, ready to use."],
  ["Tutor", "Teaches & tests", "Language practice, exam prep, interviews — feed her your notes and she becomes the expert."],
  ["Helper", "Everyday magic", "Summaries, reading documents, search, prices, images — the busywork, quietly handled."],
  ["Yours", "Private by design", "Your Mira is sealed off from everyone else's. Your conversations are yours alone."],
  ["Caring", "Looks out for you", "Always-on support and crisis protection — built to keep you safe, not just busy."],
];

type Tier = {
  name: string;
  price: string;
  cadence: string;
  sub: string;
  items: string[];
  featured?: boolean;
  cta: string;
};

const TIERS: Tier[] = [
  {
    name: "Trial",
    price: "Free",
    cadence: "",
    sub: "1 hour · 20 msgs/day",
    items: ["Everything, to taste", "Voice + chat", "No card to start"],
    cta: "Start free",
  },
  {
    name: "Companion",
    price: "$19",
    cadence: "/mo",
    sub: "Chat & voice",
    items: ["Unlimited-ish chat", "Everyday helpers", "Your language"],
    cta: "Choose Companion",
  },
  {
    name: "Assistant",
    price: "$59",
    cadence: "/mo",
    sub: "+ small builds",
    items: ["Everything in Companion", "Builds little apps", "Priority replies"],
    featured: true,
    cta: "Choose Assistant",
  },
  {
    name: "Studio",
    price: "$199",
    cadence: "/mo",
    sub: "+ full builds",
    items: ["Full app builds", "Your own number", "Top of the queue"],
    cta: "Choose Studio",
  },
];

// A small, on-brand chat preview to show the voice-note-from-a-friend feel.
function ChatPreview() {
  return (
    <div className="relative rounded-3xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl">
      <div className="flex items-center gap-3 pb-4 border-b border-[var(--border)]">
        <div
          className="grid place-items-center w-10 h-10 rounded-full text-sm font-bold text-white bg-[var(--color-vualet-indigo)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          M
        </div>
        <div>
          <p className="text-sm font-semibold tracking-tight">Mira</p>
          <p className="text-xs text-[var(--color-vualet-success)]">online · voice-first</p>
        </div>
      </div>
      <div className="space-y-3 pt-4">
        <div className="flex justify-end">
          <span className="inline-block max-w-[80%] px-3.5 py-2 rounded-2xl rounded-br-md text-sm text-white bg-[var(--color-vualet-indigo)]">
            Can you turn my meeting notes into a one-pager?
          </span>
        </div>
        <div className="flex justify-start">
          <span className="inline-flex items-center gap-2 max-w-[80%] px-3.5 py-2 rounded-2xl rounded-bl-md text-sm bg-[var(--surface-2)] text-[var(--foreground)]">
            <span aria-hidden className="text-[var(--color-vualet-indigo)]">▶</span>
            Voice note · 0:14
          </span>
        </div>
        <div className="flex justify-start">
          <span className="inline-block max-w-[80%] px-3.5 py-2 rounded-2xl rounded-bl-md text-sm bg-[var(--surface-2)] text-[var(--foreground)]">
            Done — sent it back as a PDF. Want me to draft the email too?
          </span>
        </div>
      </div>
    </div>
  );
}

export default function MiraPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 [background:radial-gradient(60%_60%_at_50%_0%,rgba(91,91,246,0.15),transparent_60%)]" />
        <div className="mx-auto max-w-7xl px-6 pt-24 pb-16 md:pt-32 md:pb-24">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1 text-xs font-medium text-[var(--muted)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-vualet-lime)]" />
                No app · No new number · Just a message
              </div>
              <h1
                className="mt-6 text-5xl md:text-7xl font-semibold tracking-tight leading-[1.05]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Your own assistant,<br />
                in the chat you <span className="text-[var(--color-vualet-indigo)]">already use.</span>
              </h1>
              <p className="mt-6 max-w-2xl text-lg md:text-xl text-[var(--muted)] leading-relaxed">
                Mira lives in your Telegram or WhatsApp. She talks, remembers you, and quietly gets
                things done — from answering a question to building you a small app — delivered like a
                voice note from a friend.
              </p>
              <div className="mt-10 flex flex-col sm:flex-row gap-3">
                <Link
                  href="/signup?product=mira"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-sm font-medium text-white bg-[var(--color-vualet-indigo)] hover:bg-[var(--color-vualet-indigo-hover)] transition-colors"
                >
                  Start free — 1 hour <span aria-hidden>→</span>
                </Link>
                <Link
                  href="#how"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-sm font-medium border border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors"
                >
                  See how it works
                </Link>
              </div>
              <p className="mt-6 text-xs text-[var(--muted)]">
                Free 1-hour trial · No credit card · Cancel anytime
              </p>
            </div>

            <div className="relative lg:pl-6">
              <div className="absolute -inset-4 -z-10 [background:radial-gradient(60%_60%_at_60%_40%,rgba(199,242,90,0.12),transparent_70%)]" />
              <ChatPreview />
            </div>
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <section className="border-t border-[var(--border)] bg-[var(--surface-2)]">
        <div className="mx-auto max-w-7xl px-6 py-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              ["Voice-first", "Talk, don't type"],
              ["Multilingual", "Replies in your language"],
              ["No install", "Telegram or WhatsApp"],
              ["Private", "Yours alone, always"],
            ].map(([t, s]) => (
              <div key={t}>
                <p
                  className="text-xl font-semibold tracking-tight"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {t}
                </p>
                <p className="mt-1 text-sm text-[var(--muted)]">{s}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-t border-[var(--border)]">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-vualet-indigo)]">
              Three steps, no tech required
            </p>
            <h2
              className="mt-2 text-3xl md:text-4xl font-semibold tracking-tight"
              style={{ fontFamily: "var(--font-display)" }}
            >
              You never install anything. You just start talking.
            </h2>
          </div>
          <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-4">
            {STEPS.map(([t, s], i) => (
              <div
                key={t}
                className="relative rounded-2xl border border-[var(--border)] bg-[var(--background)] p-7 hover:border-[var(--color-vualet-indigo)] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="grid place-items-center w-9 h-9 rounded-lg text-sm font-bold text-white bg-[var(--color-vualet-indigo)]"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    {i + 1}
                  </div>
                  {i < STEPS.length - 1 && (
                    <span aria-hidden className="hidden md:block text-[var(--border)] text-xl">
                      →
                    </span>
                  )}
                </div>
                <h3 className="mt-5 text-lg font-semibold tracking-tight">{t}</h3>
                <p className="mt-2 text-sm text-[var(--muted)] leading-relaxed">{s}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-[var(--border)] bg-[var(--surface-2)]">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-vualet-indigo)]">
              One assistant, many sides
            </p>
            <h2
              className="mt-2 text-3xl md:text-4xl font-semibold tracking-tight"
              style={{ fontFamily: "var(--font-display)" }}
            >
              What Mira does
            </h2>
            <p className="mt-4 text-lg text-[var(--muted)] leading-relaxed">
              She&apos;s whoever you need her to be — and she remembers the difference.
            </p>
          </div>
          <div className="mt-14 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map(([k, t, s]) => (
              <div
                key={t}
                className="group rounded-2xl border border-[var(--border)] bg-[var(--background)] p-7 hover:border-[var(--color-vualet-indigo)] transition-colors"
              >
                <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-vualet-indigo)]">
                  {k}
                </span>
                <h3 className="mt-4 text-lg font-semibold tracking-tight">{t}</h3>
                <p className="mt-2 text-sm text-[var(--muted)] leading-relaxed">{s}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="border-t border-[var(--border)]">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-vualet-indigo)]">
              Pricing
            </p>
            <h2
              className="mt-2 text-3xl md:text-4xl font-semibold tracking-tight"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Simple plans
            </h2>
            <p className="mt-4 text-lg text-[var(--muted)] leading-relaxed">
              Start free for an hour. Upgrade only when she&apos;s already earned it.
            </p>
          </div>
          <div className="mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
            {TIERS.map((tier) => (
              <div
                key={tier.name}
                className={`relative flex flex-col rounded-2xl border p-7 transition-colors ${
                  tier.featured
                    ? "border-[var(--color-vualet-indigo)] bg-[var(--background)] shadow-lg lg:-mt-3"
                    : "border-[var(--border)] bg-[var(--background)] hover:border-[var(--color-vualet-indigo)]"
                }`}
              >
                {tier.featured && (
                  <span className="absolute -top-3 left-7 inline-flex items-center rounded-full bg-[var(--color-vualet-indigo)] px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-white">
                    Most popular
                  </span>
                )}
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-vualet-indigo)]">
                  {tier.name}
                </p>
                <p className="mt-3 flex items-baseline gap-1">
                  <span
                    className="text-4xl font-semibold tracking-tight"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    {tier.price}
                  </span>
                  {tier.cadence && (
                    <span className="text-sm text-[var(--muted)]">{tier.cadence}</span>
                  )}
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">{tier.sub}</p>
                <ul className="mt-6 space-y-2.5 text-sm text-[var(--muted)]">
                  {tier.items.map((it) => (
                    <li key={it} className="flex gap-2">
                      <span aria-hidden className="text-[var(--color-vualet-indigo)]">✓</span>
                      <span>{it}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/signup?product=mira"
                  className={`mt-7 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-medium transition-colors ${
                    tier.featured
                      ? "text-white bg-[var(--color-vualet-indigo)] hover:bg-[var(--color-vualet-indigo-hover)]"
                      : "border border-[var(--border)] hover:bg-[var(--surface-2)]"
                  }`}
                >
                  {tier.cta} <span aria-hidden>→</span>
                </Link>
              </div>
            ))}
          </div>
          <p className="mt-6 text-xs text-[var(--muted)]">
            Prices in USD. Billed monthly · Cancel anytime · VAT added where applicable.
          </p>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="border-t border-[var(--border)]">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <div className="relative overflow-hidden rounded-3xl bg-[var(--color-vualet-ink)] text-[var(--color-vualet-text-dark)] p-10 md:p-16">
            <div className="absolute inset-0 [background:radial-gradient(50%_60%_at_80%_20%,rgba(199,242,90,0.18),transparent_60%)]" />
            <div className="relative max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-vualet-lime)]">
                Meet Mira
              </p>
              <h2
                className="mt-3 text-3xl md:text-5xl font-semibold tracking-tight"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Send one message. Meet the assistant who remembers you.
              </h2>
              <p className="mt-4 text-lg text-white/70">
                No download, no setup, no new number. Start free for an hour and see what she can do
                — then keep her only if she&apos;s already earned it.
              </p>
              <div className="mt-10 flex flex-col sm:flex-row gap-3">
                <Link
                  href="/signup?product=mira"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-sm font-medium text-[var(--color-vualet-ink)] bg-[var(--color-vualet-lime)] hover:bg-white transition-colors"
                >
                  Start free — 1 hour <span aria-hidden>→</span>
                </Link>
                <Link
                  href="#how"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-sm font-medium text-white border border-white/20 hover:bg-white/5 transition-colors"
                >
                  See how it works
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
