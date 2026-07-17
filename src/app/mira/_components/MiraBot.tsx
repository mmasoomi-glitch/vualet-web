"use client";

import { useEffect, useRef, useState } from "react";

type Msg = { role: "me" | "her"; text: string };

export default function MiraBot() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "her", text: "Hi, I'm Mira. Ask me anything about plans, billing, or how I work — I'm here." },
  ]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, open]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setMsgs((m) => [...m, { role: "me", text }]);
    setInput("");
    setBusy(true);
    try {
      const r = await fetch("/api/veridian-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const d = await r.json();
      setMsgs((m) => [...m, { role: "her", text: d.reply ?? "Sorry, I lost that for a second — try again?" }]);
    } catch {
      setMsgs((m) => [...m, { role: "her", text: "I couldn't reach the line just now — please try again." }]);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="mira-bot-fab" onClick={() => setOpen(true)} aria-label="Chat with Mira">
        <span className="av">M</span>
        Ask Mira
      </button>
    );
  }

  return (
    <div className="mira-bot-panel" role="dialog" aria-label="Chat with Mira">
      <div className="mira-bot-head">
        <span className="av">M</span>
        <div style={{ flex: 1 }}>
          <strong style={{ fontWeight: 500 }}>Mira</strong>
          <div style={{ fontSize: 12, opacity: 0.85 }}>online · here to help</div>
        </div>
        <button
          onClick={() => setOpen(false)}
          aria-label="Close"
          style={{ background: "transparent", border: "none", color: "#fff", fontSize: 22, cursor: "pointer", lineHeight: 1 }}
        >
          ×
        </button>
      </div>

      <div className="mira-bot-log" ref={logRef}>
        {msgs.map((m, i) => (
          <div key={i} className={`mira-bot-msg ${m.role}`}>{m.text}</div>
        ))}
        {busy && <div className="mira-bot-msg her" style={{ opacity: 0.6 }}>…</div>}
      </div>

      <div className="mira-bot-foot">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Type a message…"
          aria-label="Message Mira"
        />
        <button onClick={send} aria-label="Send" disabled={busy}>→</button>
      </div>
    </div>
  );
}
