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

const TIERS: [string, string, string, string[]][] = [
  ["Trial", "Free", "1 hour · 20 msgs/day", ["Everything, to taste", "Voice + chat", "No card to start"]],
  ["Companion", "$19/mo", "chat & voice", ["Unlimited-ish chat", "Everyday helpers", "Your language"]],
  ["Assistant", "$59/mo", "+ small builds", ["Everything in Companion", "Builds little apps", "Priority"]],
  ["Studio", "$199/mo", "+ full builds", ["Full app builds", "Your own number", "Top of the queue"]],
];

export default function MiraPage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 [background:radial-gradient(60%_60%_at_50%_0%,rgba(91,91,246,0.15),transparent_60%)]" />
        <div className="mx-auto max-w-7xl px-6 pt-24 pb-16 md:pt-32 md:pb-20">
          <div className="max-w-4xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1 text-xs font-medium text-[var(--muted)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-vualet-lime)]" />
              No app · No new number · Just a message
            </div>
            <h1 className="mt-6 text-5xl md:text-7xl font-semibold tracking-tight leading-[1.05]" style={{ fontFamily: "var(--font-display)" }}>
              Your own assistant,<br />
              in the chat you <span className="text-[var(--color-vualet-indigo)]">already use.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg md:text-xl text-[var(--muted)] leading-relaxed">
              Mira lives in your Telegram or WhatsApp. She talks, remembers you, and quietly gets
              things done — from answering a question to building you a small app — delivered like a
              voice note from a friend.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row gap-3">
              <Link href="/signup?product=mira" className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-sm font-medium text-white bg-[var(--color-vualet-indigo)] hover:bg-[var(--color-vualet-indigo-hover)] transition-colors">
                Start free — 1 hour <span aria-hidden>→</span>
              </Link>
              <Link href="#how" className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-sm font-medium border border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors">
                See how it works
              </Link>
            </div>
            <p className="mt-6 text-xs text-[var(--muted)]">Free 1-hour trial · No credit card · Cancel anytime</p>
          </div>
        </div>
      </section>

      <section id="how" className="border-t border-[var(--border)] bg-[var(--surface-2)]">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-vualet-indigo)]">Three steps, no tech required</p>
          <h2 className="mt-2 text-3xl md:text-4xl font-semibold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>You never install anything. You just start talking.</h2>
          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-4">
            {STEPS.map(([t, s], i) => (
              <div key={t} className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-6">
                <div className="grid place-items-center w-9 h-9 rounded-lg text-sm font-bold text-white bg-[var(--color-vualet-indigo)]">{i + 1}</div>
                <h3 className="mt-5 text-lg font-semibold tracking-tight">{t}</h3>
                <p className="mt-2 text-sm text-[var(--muted)] leading-relaxed">{s}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)]">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>What Mira does</h2>
          <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map(([k, t, s]) => (
              <div key={t} className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-vualet-indigo)]">{k}</p>
                <h3 className="mt-3 text-lg font-semibold tracking-tight">{t}</h3>
                <p className="mt-2 text-sm text-[var(--muted)] leading-relaxed">{s}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)] bg-[var(--surface-2)]">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>Simple plans</h2>
          <p className="mt-2 text-[var(--muted)]">Start free for an hour. Upgrade only when she&apos;s already earned it.</p>
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {TIERS.map(([name, price, sub, items]) => (
              <div key={name} className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-vualet-indigo)]">{name}</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>{price}</p>
                <p className="text-xs text-[var(--muted)]">{sub}</p>
                <ul className="mt-4 space-y-1.5 text-sm text-[var(--muted)]">
                  {items.map((it) => <li key={it}>✓ {it}</li>)}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-10">
            <Link href="/signup?product=mira" className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-sm font-medium text-white bg-[var(--color-vualet-indigo)] hover:bg-[var(--color-vualet-indigo-hover)] transition-colors">
              Get Mira <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
