import Link from "next/link";

const STEPS: [string, string][] = [
  ["Shape her", "Pick a plan and tell Mira who to be — a friend, a tutor, an assistant. She's yours alone."],
  ["Connect your chat", "Open her in Telegram, or scan a code to link your own WhatsApp. No new number."],
  ["Just talk", "Speak like you would to a person. She figures out the rest and hands you the result."],
];

const FEATURES: [string, string, string][] = [
  ["Companion", "Talks like a person", "Natural voice notes, in your language, who remembers your life across every chat."],
  ["Everything", "Replaces your apps", "Store family albums, run your accounting, draft and send — all by simple voice."],
  ["Builder", "Makes real things", "Describe what you need in plain words; Mira builds it and sends it back, ready to use."],
  ["Tutor", "Teaches & tests", "Language practice, exam prep, interviews — feed her your notes and she becomes the expert."],
  ["Yours", "Private by design", "Your Mira is sealed off from everyone else's. Your conversations are yours alone."],
  ["Caring", "Looks out for you", "She notices the emotional context, not just the task — and keeps you safe, not just busy."],
];

const TIERS: { name: string; price: string; sub: string; items: string[]; featured?: boolean }[] = [
  { name: "Trial", price: "Free", sub: "1 hour · 20 msgs/day", items: ["Everything, to taste", "Voice + chat", "No card to start"] },
  { name: "Companion", price: "$19", sub: "chat & voice", items: ["Unlimited-ish chat", "Everyday helpers", "Your language"] },
  { name: "Assistant", price: "$59", sub: "+ small builds", items: ["Everything in Companion", "Builds little apps", "Priority replies"], featured: true },
  { name: "Studio", price: "$199", sub: "+ full builds", items: ["Full app builds", "Your own number", "Top of the queue"] },
];

const card: React.CSSProperties = { background: "var(--mira-canvas)", border: "1px solid var(--mira-fog)", borderRadius: "var(--mira-radius-lg)", boxShadow: "var(--mira-shadow-sm)" };

export default function MiraPage() {
  return (
    <div style={{ background: "var(--mira-cream)", color: "var(--mira-ink)" }}>
      {/* Hero */}
      <section style={{ position: "relative", overflow: "hidden", textAlign: "center" }}>
        <div className="mira-aura" aria-hidden style={{ position: "absolute", inset: "-8% 0 auto 0", height: 520, margin: "auto", zIndex: 0, background: "var(--mira-grad-aura)", filter: "blur(80px)", opacity: 0.35 }} />
        <div style={{ position: "relative", zIndex: 1, maxWidth: 1080, margin: "0 auto", padding: "84px 24px 48px" }}>
          <img src="/mira/mira-wordmark-color.svg" alt="Mira" style={{ height: 34, marginBottom: 26 }} />
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--mira-graphite)", background: "var(--mira-frost)", borderRadius: 999, padding: "7px 14px" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--mira-rose)" }} /> No app · No new number · Just a message
          </div>
          <h1 className="display" style={{ fontSize: "clamp(40px,7vw,76px)", lineHeight: 1.05, margin: "22px auto 0", maxWidth: "15ch" }}>
            Your assistant.<br /><span className="grad">Wonderful, by reflection.</span>
          </h1>
          <p style={{ fontSize: "clamp(17px,2.2vw,21px)", color: "var(--mira-graphite)", maxWidth: 600, margin: "22px auto 0", lineHeight: 1.6 }}>
            Mira lives in the chat you already use. She talks, remembers you, and quietly gets things
            done — from a quick answer to storing your family albums to running your accounting, all by voice.
          </p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", marginTop: 34, flexWrap: "wrap" }}>
            <Link className="btn-mira" href="/mira/signup">Start free — 1 hour →</Link>
            <Link className="btn-mira-soft" href="#how">See how she works</Link>
          </div>
          <p style={{ marginTop: 16, fontSize: 13, color: "var(--mira-slate)" }}>Free 1-hour trial · No credit card · Cancel anytime</p>
        </div>
      </section>

      {/* Trust strip */}
      <section style={{ borderTop: "1px solid var(--mira-fog)", borderBottom: "1px solid var(--mira-fog)" }}>
        <div className="mira-4col" style={{ maxWidth: 1080, margin: "0 auto", padding: "26px 24px", textAlign: "center" }}>
          {[["Voice-first", "Talk, don't type"], ["Multilingual", "In your language"], ["No install", "Telegram or WhatsApp"], ["Private", "Yours alone, always"]].map(([t, s]) => (
            <div key={t}><p className="display" style={{ fontSize: 18, fontWeight: 400, margin: 0 }}>{t}</p><span style={{ fontSize: 13, color: "var(--mira-slate)" }}>{s}</span></div>
          ))}
        </div>
      </section>

      {/* How */}
      <section id="how" style={{ maxWidth: 1080, margin: "0 auto", padding: "64px 24px" }}>
        <h2 className="display" style={{ fontSize: "clamp(28px,4vw,38px)", textAlign: "center", margin: "0 0 8px" }}>Three steps. No tech required.</h2>
        <p style={{ textAlign: "center", color: "var(--mira-graphite)", maxWidth: 540, margin: "0 auto 36px" }}>You never install anything. You just start talking.</p>
        <div className="mira-3col">
          {STEPS.map(([t, s], i) => (
            <div key={t} style={{ ...card, padding: 26 }}>
              <div style={{ display: "grid", placeItems: "center", width: 36, height: 36, borderRadius: "50%", color: "#fff", background: "var(--mira-grad-presence)", fontWeight: 600 }}>{i + 1}</div>
              <h3 className="display" style={{ fontSize: 19, fontWeight: 400, margin: "14px 0 6px" }}>{t}</h3>
              <p style={{ color: "var(--mira-graphite)", fontSize: 15, margin: 0, lineHeight: 1.6 }}>{s}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section style={{ maxWidth: 1080, margin: "0 auto", padding: "8px 24px 64px" }}>
        <h2 className="display" style={{ fontSize: "clamp(28px,4vw,38px)", textAlign: "center", margin: "0 0 8px" }}>The one that does everything</h2>
        <p style={{ textAlign: "center", color: "var(--mira-graphite)", maxWidth: 560, margin: "0 auto 36px" }}>The app that replaces your apps — by voice.</p>
        <div className="mira-3col">
          {FEATURES.map(([k, t, s]) => (
            <div key={t} style={{ ...card, padding: 26 }}>
              <p style={{ fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--mira-rose-deep)", fontWeight: 600, margin: 0 }}>{k}</p>
              <h3 className="display" style={{ fontSize: 20, fontWeight: 400, margin: "10px 0 6px" }}>{t}</h3>
              <p style={{ color: "var(--mira-graphite)", fontSize: 15, margin: 0, lineHeight: 1.6 }}>{s}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section style={{ background: "var(--mira-canvas)", borderTop: "1px solid var(--mira-fog)" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "64px 24px" }}>
          <h2 className="display" style={{ fontSize: "clamp(28px,4vw,38px)", textAlign: "center", margin: "0 0 8px" }}>Simple plans</h2>
          <p style={{ textAlign: "center", color: "var(--mira-graphite)", margin: "0 auto 36px" }}>Start free for an hour. Upgrade only when she&apos;s already earned it.</p>
          <div className="mira-4col">
            {TIERS.map((t) => (
              <div key={t.name} style={{ background: "var(--mira-cream)", border: `1px solid ${t.featured ? "var(--mira-rose)" : "var(--mira-fog)"}`, borderRadius: "var(--mira-radius-lg)", padding: 24, boxShadow: t.featured ? "var(--mira-shadow-md)" : "none" }}>
                <p style={{ fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--mira-rose-deep)", fontWeight: 600, margin: 0 }}>{t.name}</p>
                <p className="display" style={{ fontSize: 32, fontWeight: 400, margin: "8px 0 0" }}>{t.price}</p>
                <p style={{ fontSize: 12, color: "var(--mira-slate)", margin: 0 }}>{t.sub}</p>
                <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 0", fontSize: 14, color: "var(--mira-graphite)" }}>
                  {t.items.map((it) => <li key={it} style={{ padding: "3px 0" }}>✓ {it}</li>)}
                </ul>
              </div>
            ))}
          </div>
          <div style={{ textAlign: "center", marginTop: 30 }}>
            <Link className="btn-mira" href="/mira/signup">Meet Mira →</Link>
          </div>
        </div>
      </section>

      <p style={{ textAlign: "center", color: "var(--mira-slate)", fontSize: 13, padding: "30px 0" }}>Mira — MEE-rah · she sees · a Vualet product</p>
    </div>
  );
}
