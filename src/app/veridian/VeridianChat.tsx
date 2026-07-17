"use client";

import { useEffect, useRef, useState } from "react";

type Msg = { role: "me" | "her"; text: string };

const SUGGESTIONS = [
  "What can Veridian do?",
  "How does voice work?",
  "What are the pricing tiers?",
  "Does it make things up?",
];

const MSG_MAX_LEN = 800;

export default function VeridianChat() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      role: "her",
      text:
        "Hi — I'm the Veridian demo. Ask me anything I know about the product: voice on WhatsApp and Telegram, my memory, OCR, small builds, pricing, or the company. If I don't know something, I'll tell you — I won't make it up.",
    },
  ]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy]);

  async function sendText(text: string) {
    const clean = text.trim().slice(0, MSG_MAX_LEN);
    if (!clean || busy) return;
    setMsgs((m) => [...m, { role: "me", text: clean }]);
    setInput("");
    setBusy(true);
    try {
      const r = await fetch("/api/veridian-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: clean }),
      });
      const d = await r.json().catch(() => ({}));
      setMsgs((m) => [
        ...m,
        { role: "her", text: d?.reply ?? "Sorry, I lost that for a second — try again?" },
      ]);
    } catch {
      setMsgs((m) => [
        ...m,
        { role: "her", text: "I couldn't reach the demo just now — please try again." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendText(input);
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        border: "1px solid var(--mira-fog)",
        borderRadius: "var(--mira-radius-lg)",
        background: "var(--mira-canvas)",
        boxShadow: "var(--mira-shadow-md)",
        overflow: "hidden",
        minWidth: 0,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: 16,
          background: "var(--mira-grad-presence)",
          color: "#fff",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 38,
            height: 38,
            borderRadius: "50%",
            background: "rgba(255,255,255,.22)",
            display: "grid",
            placeItems: "center",
            fontWeight: 600,
          }}
        >
          V
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ fontWeight: 500 }}>Veridian</strong>
          <div style={{ fontSize: 12, opacity: 0.9 }}>read-only demo · answers from what it knows</div>
        </div>
      </div>

      {/* Log */}
      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label="Conversation with the Veridian demo"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          minHeight: 280,
          maxHeight: "52vh",
        }}
      >
        {msgs.map((m, i) => (
          <div
            key={i}
            className="mira-bot-msg"
            style={
              m.role === "me"
                ? {
                    alignSelf: "flex-end",
                    background: "var(--mira-grad-presence)",
                    color: "#fff",
                    borderBottomRightRadius: 5,
                    maxWidth: "84%",
                    padding: "10px 14px",
                    fontSize: 14,
                    lineHeight: 1.5,
                    borderRadius: 16,
                  }
                : {
                    alignSelf: "flex-start",
                    background: "var(--mira-frost)",
                    color: "var(--mira-ink)",
                    borderBottomLeftRadius: 5,
                    maxWidth: "84%",
                    padding: "10px 14px",
                    fontSize: 14,
                    lineHeight: 1.5,
                    borderRadius: 16,
                  }
            }
          >
            {m.text}
          </div>
        ))}
        {busy && (
          <div
            className="mira-bot-msg"
            style={{
              alignSelf: "flex-start",
              background: "var(--mira-frost)",
              color: "var(--mira-ink)",
              opacity: 0.6,
              padding: "10px 14px",
              fontSize: 14,
              borderRadius: 16,
            }}
          >
            …
          </div>
        )}
      </div>

      {/* Suggestions */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "10px 16px 0" }}>
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => sendText(s)}
            disabled={busy}
            style={{
              border: "1px solid var(--mira-fog)",
              background: "var(--mira-cream)",
              color: "var(--mira-graphite)",
              borderRadius: "var(--mira-radius-full)",
              padding: "7px 13px",
              fontSize: 12.5,
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Composer */}
      <form
        onSubmit={onSubmit}
        style={{ display: "flex", gap: 8, padding: 16, borderTop: "1px solid var(--mira-fog)", marginTop: 12 }}
      >
        <label htmlFor="veridian-input" className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
          Ask the Veridian demo a question
        </label>
        <input
          id="veridian-input"
          value={input}
          maxLength={MSG_MAX_LEN}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about voice, memory, OCR, pricing…"
          autoComplete="off"
          style={{
            flex: 1,
            minWidth: 0,
            padding: "12px 14px",
            borderRadius: "var(--mira-radius-full)",
            border: "1px solid var(--mira-fog)",
            background: "var(--mira-cream)",
            color: "var(--mira-ink)",
            fontSize: 14,
            outline: "none",
          }}
        />
        <button type="submit" className="btn-mira" disabled={busy} aria-label="Send message" style={{ padding: "12px 20px" }}>
          {busy ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
