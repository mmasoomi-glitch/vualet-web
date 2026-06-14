"use client";

import { useState } from "react";
import Link from "next/link";

type Msg = { role: "user" | "bot"; text: string };

export function CsBot() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "bot", text: "Hi — I'm Vualet support. I can help with refunds, billing, cancellations, and any issue. Sign in and ask away." },
  ]);

  // Placeholder auth gate — replace with the real session check when auth lands.
  const loggedIn = typeof window !== "undefined" && !!window.localStorage.getItem("vualet_session");

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setMsgs((m) => [...m, { role: "user", text }]);
    setInput("");
    setBusy(true);
    try {
      const r = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const d = await r.json();
      setMsgs((m) => [...m, { role: "bot", text: d.reply ?? "Sorry, something went wrong." }]);
    } catch {
      setMsgs((m) => [...m, { role: "bot", text: "I couldn't reach support just now — please try again." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close support" : "Open support"}
        aria-expanded={open}
        className="fixed bottom-5 right-5 z-50 grid place-items-center w-14 h-14 rounded-full text-white bg-[var(--color-vualet-indigo)] hover:bg-[var(--color-vualet-indigo-hover)] shadow-lg transition-colors"
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      {open && (
        <div
          className="fixed bottom-24 right-5 z-50 w-[min(92vw,380px)] rounded-2xl border border-[var(--border)] bg-[var(--background)] shadow-2xl overflow-hidden flex flex-col"
          style={{ maxHeight: "70vh" }}
        >
          <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)] flex items-center gap-3">
            <div
              className="grid place-items-center w-9 h-9 rounded-full text-xs font-bold text-white bg-[var(--color-vualet-indigo)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              V
            </div>
            <div>
              <p className="text-sm font-semibold">Vualet Support</p>
              <p className="text-xs text-[var(--muted)]">Refunds · Billing · Questions</p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-right" : ""}>
                <span
                  className={`inline-block px-3 py-2 rounded-2xl text-sm max-w-[85%] ${
                    m.role === "user"
                      ? "bg-[var(--color-vualet-indigo)] text-white"
                      : "bg-[var(--surface-2)] text-[var(--foreground)]"
                  }`}
                >
                  {m.text}
                </span>
              </div>
            ))}
          </div>

          {loggedIn ? (
            <div className="p-2 border-t border-[var(--border)] flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="Ask about a refund, billing…"
                className="flex-1 px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--background)] text-sm outline-none focus:border-[var(--color-vualet-indigo)]"
              />
              <button
                onClick={send}
                disabled={busy}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white bg-[var(--color-vualet-indigo)] disabled:opacity-50"
              >
                Send
              </button>
            </div>
          ) : (
            <div className="p-3 border-t border-[var(--border)] text-center">
              <p className="text-sm text-[var(--muted)]">Please sign in to chat with support.</p>
              <Link href="/login" className="mt-2 inline-flex px-4 py-2 rounded-xl text-sm font-medium text-white bg-[var(--color-vualet-indigo)]">
                Sign in
              </Link>
            </div>
          )}
        </div>
      )}
    </>
  );
}
