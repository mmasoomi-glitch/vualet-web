"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import RecallOrbit from "@/app/mira/_components/RecallOrbit";

/* ---------------------------------------------------------------------------
   Web Speech API typing. window.SpeechRecognition / webkitSpeechRecognition are
   not in the default DOM lib, so we declare the minimal surface we use and read
   the constructor off window through a typed cast (keeps `tsc --noEmit` clean).
--------------------------------------------------------------------------- */
type SRAlternative = { transcript: string };
type SRResult = ArrayLike<SRAlternative> & { isFinal: boolean };
type SRResultList = ArrayLike<SRResult>;
interface SREvent {
  resultIndex: number;
  results: SRResultList;
}
interface SRInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}
type SRCtor = new () => SRInstance;

function getSR(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

type Msg = { id: number; role: "me" | "her"; text: string; audioUrl?: string; autoplay?: boolean };

const SUGGESTIONS = [
  "What can Mira do?",
  "Do you remember me?",
  "How does voice work?",
  "What are the pricing tiers?",
];

const MSG_MAX_LEN = 800;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* fixed waveform silhouette for a played-back voice note (px heights) */
const VN_BARS = [7, 12, 18, 10, 22, 14, 9, 19, 13, 24, 11, 16, 8, 20, 12, 17, 9, 14];

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

/* --------------------------------------------------------------------------
   A played-back "voice note" bubble — the same visual vocabulary the site
   markets in its WhatsApp self-chat section (play button + waveform + duration).
-------------------------------------------------------------------------- */
function VoiceNote({ src, autoplay }: { src: string; autoplay?: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [dur, setDur] = useState(0);
  const [cur, setCur] = useState(0);

  useEffect(() => {
    if (!autoplay) return;
    const a = audioRef.current;
    if (!a) return;
    a.play()
      .then(() => setPlaying(true))
      .catch(() => {
        /* autoplay blocked → visitor can press play */
      });
  }, [autoplay]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      a.play()
        .then(() => setPlaying(true))
        .catch(() => {});
    } else {
      a.pause();
      setPlaying(false);
    }
  }, []);

  const progress = dur > 0 ? cur / dur : 0;
  const litBars = Math.round(progress * VN_BARS.length);

  return (
    <div className={`vvc-vn ${playing ? "is-playing" : ""}`}>
      <button
        type="button"
        className="vvc-vn-play"
        onClick={toggle}
        aria-label={playing ? "Pause voice reply" : "Play voice reply"}
      >
        {playing ? (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden fill="currentColor">
            <rect x="2" y="1.5" width="3" height="9" rx="1" />
            <rect x="7" y="1.5" width="3" height="9" rx="1" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden fill="currentColor">
            <path d="M3 1.8v8.4a.6.6 0 0 0 .92.5l6.6-4.2a.6.6 0 0 0 0-1L3.92 1.3A.6.6 0 0 0 3 1.8z" />
          </svg>
        )}
      </button>
      <div className="vvc-vn-wave" aria-hidden>
        {VN_BARS.map((h, i) => (
          <i
            key={i}
            style={{ height: h, opacity: playing ? (i < litBars ? 1 : 0.42) : 0.6 }}
          />
        ))}
      </div>
      <span className="vvc-vn-time">{fmtTime(playing || cur ? cur : dur)}</span>
      <span className="vvc-vn-mic" aria-hidden>
        ♪
      </span>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => setCur(e.currentTarget.currentTime || 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCur(0);
        }}
      />
    </div>
  );
}

// What both message bubbles share. Each branch spreads this FIRST, so the single
// rounded corner it then sets still overrides borderRadius - spreading last would
// reset that corner to 16 and quietly change the bubble shape.
const bubbleBase: React.CSSProperties = {
  maxWidth: "84%",
  padding: "10px 14px",
  fontSize: 14,
  lineHeight: 1.5,
  borderRadius: 16,
};

export default function VeridianChat() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [supportsMic, setSupportsMic] = useState(false);
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState("");
  const [recSecs, setRecSecs] = useState(0);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [trialOpen, setTrialOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailErr, setEmailErr] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      id: 0,
      role: "her",
      text:
        "Hi — I'm Mira. You can talk to me: hold the mic and speak like a voice note, or just type. Turn my voice on and I'll reply out loud. Tell me your name or a detail about yourself, come back later, and watch me remember — I only recall what you actually tell me, and I never make things up.",
    },
  ]);

  const logRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(1);
  const recRef = useRef<SRInstance | null>(null);
  const finalRef = useRef("");
  const interimRef = useRef("");
  const sentRef = useRef(false);
  const voiceOnRef = useRef(voiceOn);
  const urlsRef = useRef<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recStartXRef = useRef(0);
  const cancelRef = useRef(false);

  useEffect(() => {
    voiceOnRef.current = voiceOn;
    if (!voiceOn && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, [voiceOn]);

  useEffect(() => {
    setSupportsMic(getSR() !== null);
    // Revoke any object URLs we created on unmount.
    const urls = urlsRef.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy, trialOpen]);

  const nextId = () => idRef.current++;

  const browserSpeak = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";
      u.rate = 1;
      window.speechSynthesis.speak(u);
    } catch {
      /* speech is a nice-to-have */
    }
  }, []);

  // Speak her reply: try ElevenLabs (her real voice) → play as a voice-note
  // bubble; if it returns no audio, fall back to the browser voice. Only ever
  // called right after the visitor's own action, so autoplay is allowed.
  const speakHer = useCallback(
    async (text: string, id: number) => {
      if (!voiceOnRef.current) return;
      try {
        const r = await fetch("/api/veridian-voice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (r.status === 200) {
          const blob = await r.blob();
          if (blob.size > 0 && voiceOnRef.current) {
            const url = URL.createObjectURL(blob);
            urlsRef.current.push(url);
            setMsgs((m) => m.map((x) => (x.id === id ? { ...x, audioUrl: url, autoplay: true } : x)));
            return;
          }
        }
      } catch {
        /* fall through to browser speech */
      }
      if (voiceOnRef.current) browserSpeak(text);
    },
    [browserSpeak],
  );

  const sendText = useCallback(
    async (text: string) => {
      const clean = text.trim().slice(0, MSG_MAX_LEN);
      if (!clean || busy) return;
      setInterim("");
      setMsgs((m) => [...m, { id: nextId(), role: "me", text: clean }]);
      setInput("");
      setBusy(true);
      try {
        const r = await fetch("/api/veridian-demo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: clean }),
        });
        const d = await r.json().catch(() => ({}));
        const reply: string = d?.reply ?? "Sorry, I lost that for a second — try again?";
        const herId = nextId();
        setMsgs((m) => [...m, { id: herId, role: "her", text: reply }]);
        if (d?.trialGate) setTrialOpen(true);
        void speakHer(reply, herId);
      } catch {
        setMsgs((m) => [
          ...m,
          { id: nextId(), role: "her", text: "I couldn't reach the demo just now — please try again." },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [busy, speakHer],
  );

  /* ---------- press-and-talk voice input ---------- */
  const stopRecognition = useCallback(() => {
    const rec = recRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
  }, []);

  // Slide-away / cancel: drop the take without sending it.
  const cancelRecognition = useCallback(() => {
    cancelRef.current = true;
    sentRef.current = true;
    finalRef.current = "";
    interimRef.current = "";
    setInterim("");
    const rec = recRef.current;
    if (rec) {
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const startRecognition = useCallback(() => {
    if (recording || busy) return;
    const SR = getSR();
    if (!SR) return;
    const rec = new SR();
    rec.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    finalRef.current = "";
    interimRef.current = "";
    sentRef.current = false;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();

    rec.onresult = (e: SREvent) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const t = res[0]?.transcript ?? "";
        if (res.isFinal) finalRef.current += t;
        else live += t;
      }
      interimRef.current = live;
      setInterim((finalRef.current + " " + live).trim());
    };
    rec.onerror = () => {
      /* mic denied / no-speech / network — end quietly */
    };
    rec.onend = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setRecording(false);
      setCancelArmed(false);
      recRef.current = null;
      if (sentRef.current) return;
      sentRef.current = true;
      const text = (finalRef.current || interimRef.current).trim();
      setInterim("");
      if (text) void sendText(text);
    };

    recRef.current = rec;
    try {
      rec.start();
      setRecording(true);
      setRecSecs(0);
      setCancelArmed(false);
      cancelRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => setRecSecs((s) => s + 1), 1000);
    } catch {
      recRef.current = null;
    }
  }, [recording, busy, sendText]);

  const onMicPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    recStartXRef.current = e.clientX;
    cancelRef.current = false;
    setCancelArmed(false);
    startRecognition();
  };
  const onMicPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!recording) return;
    const canceling = e.clientX - recStartXRef.current < -70;
    if (canceling !== cancelRef.current) {
      cancelRef.current = canceling;
      setCancelArmed(canceling);
    }
  };
  const onMicPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (cancelRef.current) cancelRecognition();
    else stopRecognition();
  };
  const onMicKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (recording) stopRecognition();
      else startRecognition();
    } else if (e.key === "Escape" && recording) {
      e.preventDefault();
      cancelRecognition();
    }
  };

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    const clean = email.trim().toLowerCase();
    if (!EMAIL_RE.test(clean) || emailBusy) {
      setEmailErr(true);
      return;
    }
    setEmailErr(false);
    setEmailBusy(true);
    try {
      const r = await fetch("/api/veridian-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: clean }),
      });
      const d = await r.json().catch(() => ({}));
      if (d?.ok) {
        setTrialOpen(false);
        setEmail("");
        const herId = nextId();
        const reply: string = d?.reply ?? "Thank you — that's all I needed. Where were we?";
        setMsgs((m) => [...m, { id: herId, role: "her", text: reply }]);
        void speakHer(reply, herId);
      } else {
        setEmailErr(true);
      }
    } catch {
      setEmailErr(true);
    } finally {
      setEmailBusy(false);
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
          M
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ fontWeight: 500 }}>Mira</strong>
          <div style={{ fontSize: 12, opacity: 0.9 }}>live demo · hold to talk · remembers you</div>
        </div>
        <button
          type="button"
          className="vvc-voice-toggle"
          onClick={() => setVoiceOn((v) => !v)}
          aria-pressed={voiceOn}
          aria-label={voiceOn ? "Turn her voice off" : "Turn her voice on"}
          title={voiceOn ? "Her voice is on" : "Her voice is off"}
        >
          <span aria-hidden>{voiceOn ? "🔊" : "🔈"}</span>
          <span>{voiceOn ? "Voice on" : "Voice off"}</span>
        </button>
      </div>

      {/* Log */}
      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label="Conversation with the Mira demo"
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
        {msgs.map((m) => (
          <div
            key={m.id}
            className="mira-bot-msg"
            style={
              m.role === "me"
                ? {
                    ...bubbleBase,
                    alignSelf: "flex-end",
                    background: "var(--mira-grad-presence)",
                    color: "#fff",
                    borderBottomRightRadius: 5,
                  }
                : {
                    ...bubbleBase,
                    alignSelf: "flex-start",
                    background: "var(--mira-frost)",
                    color: "var(--mira-ink)",
                    borderBottomLeftRadius: 5,
                  }
            }
          >
            {m.text}
            {m.audioUrl && <VoiceNote src={m.audioUrl} autoplay={m.autoplay} />}
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
            <RecallOrbit size={22} label="Recalling" />
          </div>
        )}

        {/* Free-trial gate — inline email, no card */}
        {trialOpen && (
          <form className="vvc-trial" onSubmit={submitEmail}>
            <div className="vvc-trial-lead">Keep chatting with me — just your email. No card, ever.</div>
            <div className="vvc-trial-row">
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailErr) setEmailErr(false);
                }}
                placeholder="you@example.com"
                aria-label="Your email to keep chatting"
                aria-invalid={emailErr}
                className="vvc-trial-input"
              />
              <button type="submit" className="btn-mira vvc-trial-btn" disabled={emailBusy}>
                {emailBusy ? "…" : "Continue"}
              </button>
            </div>
            {emailErr && (
              <div className="vvc-trial-err" role="alert">
                That email doesn&apos;t look right — mind trying again?
              </div>
            )}
          </form>
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

      {/* Composer — WhatsApp-style: one field, one hero control that morphs
          mic ↔ send. Hold the mic to talk; slide away to cancel. */}
      <form onSubmit={onSubmit} className="vvc-composer">
        <label
          htmlFor="veridian-input"
          className="sr-only"
          style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}
        >
          Ask the Mira demo a question
        </label>

        <div className={`vvc-field ${recording ? "is-rec" : ""} ${cancelArmed ? "is-cancel" : ""}`}>
          {recording ? (
            <div className="vvc-rectray" role="status" aria-live="assertive">
              <span className="vvc-reclive-dot" aria-hidden />
              <span className="vvc-rectime">{fmtTime(recSecs)}</span>
              <div className="vvc-wave" aria-hidden>
                {Array.from({ length: 14 }).map((_, i) => (
                  <i key={i} style={{ animationDelay: `${(i % 7) * 90}ms` }} />
                ))}
              </div>
              <span className="vvc-rechint">
                {cancelArmed ? "Release to cancel" : interim || "‹ slide to cancel · release to send"}
              </span>
            </div>
          ) : (
            <>
              <input
                id="veridian-input"
                value={input}
                maxLength={MSG_MAX_LEN}
                onChange={(e) => setInput(e.target.value)}
                placeholder={supportsMic ? "Hold the mic to talk, or type…" : "Type a message…"}
                autoComplete="off"
              />
              {supportsMic && !input.trim() && (
                <span className="vvc-holdhint" aria-hidden>
                  Hold to talk
                </span>
              )}
            </>
          )}
        </div>

        {supportsMic && !input.trim() ? (
          <button
            type="button"
            className={`vvc-primary vvc-mic-btn ${recording ? "is-rec" : ""} ${cancelArmed ? "is-cancel" : ""}`}
            onPointerDown={onMicPointerDown}
            onPointerMove={onMicPointerMove}
            onPointerUp={onMicPointerUp}
            onPointerCancel={onMicPointerUp}
            onKeyDown={onMicKeyDown}
            onContextMenu={(e) => e.preventDefault()}
            aria-label={
              recording
                ? "Recording — release to send, or slide away to cancel"
                : "Hold to talk, or press Space to start recording"
            }
            aria-pressed={recording}
            disabled={busy}
          >
            <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10a7 7 0 0 0 14 0" />
              <line x1="12" y1="17" x2="12" y2="22" />
              <line x1="8" y1="22" x2="16" y2="22" />
            </svg>
          </button>
        ) : (
          <button
            type="submit"
            className="vvc-primary vvc-send-btn"
            disabled={busy || !input.trim()}
            aria-label="Send message"
          >
            <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2 11 13" />
              <path d="M22 2 15 22l-4-9-9-4 20-7z" />
            </svg>
          </button>
        )}
      </form>

      {/* Certified touch — grounded · verified, in the seal aesthetic */}
      <div className="vvc-certify" aria-label="Mira is grounded and verified — it cannot fabricate">
        <span className="tick" aria-hidden>
          ✓
        </span>
        <span>
          <b>Mira</b> · grounded · verified · cannot fabricate
        </span>
      </div>
    </div>
  );
}
