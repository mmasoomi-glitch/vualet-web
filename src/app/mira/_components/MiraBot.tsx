"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import RecallOrbit from "./RecallOrbit";

/* Minimal Web Speech API surface (not in the default DOM lib). */
type SRAlternative = { transcript: string };
type SRResult = ArrayLike<SRAlternative> & { isFinal: boolean };
interface SREvent {
  resultIndex: number;
  results: ArrayLike<SRResult>;
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VN_BARS = [6, 11, 15, 9, 18, 12, 8, 16, 11, 19, 10, 14];

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function VoiceNote({ src, autoplay }: { src: string; autoplay?: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [dur, setDur] = useState(0);
  const [cur, setCur] = useState(0);

  useEffect(() => {
    if (!autoplay) return;
    audioRef.current?.play().then(() => setPlaying(true)).catch(() => {});
  }, [autoplay]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().then(() => setPlaying(true)).catch(() => {});
    else {
      a.pause();
      setPlaying(false);
    }
  }, []);

  const litBars = dur > 0 ? Math.round((cur / dur) * VN_BARS.length) : 0;

  return (
    <div className={`mbv-vn ${playing ? "is-playing" : ""}`}>
      <button type="button" className="mbv-vn-play" onClick={toggle} aria-label={playing ? "Pause voice reply" : "Play voice reply"}>
        {playing ? "❚❚" : "▶"}
      </button>
      <div className="mbv-vn-wave" aria-hidden>
        {VN_BARS.map((h, i) => (
          <i key={i} style={{ height: h, opacity: playing ? (i < litBars ? 1 : 0.42) : 0.6 }} />
        ))}
      </div>
      <span className="mbv-vn-time">{fmtTime(playing || cur ? cur : dur)}</span>
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

export default function MiraBot() {
  const [open, setOpen] = useState(false);
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
  const [msgs, setMsgs] = useState<Msg[]>([
    { id: 0, role: "her", text: "Hi, I'm Mira. Hold the mic and talk to me, or type — I'm here. Turn my voice on and I'll reply out loud." },
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
    if (!voiceOn && typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, [voiceOn]);

  useEffect(() => {
    setSupportsMic(getSR() !== null);
    const urls = urlsRef.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, open, trialOpen]);

  const nextId = () => idRef.current++;

  const browserSpeak = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";
      window.speechSynthesis.speak(u);
    } catch {
      /* nice-to-have */
    }
  }, []);

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
        /* fall through */
      }
      if (voiceOnRef.current) browserSpeak(text);
    },
    [browserSpeak],
  );

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;
      setInterim("");
      setMsgs((m) => [...m, { id: nextId(), role: "me", text }]);
      setInput("");
      setBusy(true);
      try {
        const r = await fetch("/api/veridian-demo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        });
        const d = await r.json().catch(() => ({}));
        const reply: string = d?.reply ?? "Sorry, I lost that for a second — try again?";
        const herId = nextId();
        setMsgs((m) => [...m, { id: herId, role: "her", text: reply }]);
        if (d?.trialGate) setTrialOpen(true);
        void speakHer(reply, herId);
      } catch {
        setMsgs((m) => [...m, { id: nextId(), role: "her", text: "I couldn't reach the line just now — please try again." }]);
      } finally {
        setBusy(false);
      }
    },
    [busy, speakHer],
  );

  /* press-and-talk */
  const stopRec = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
  }, []);

  const cancelRec = useCallback(() => {
    cancelRef.current = true;
    sentRef.current = true;
    finalRef.current = "";
    interimRef.current = "";
    setInterim("");
    try {
      recRef.current?.abort();
    } catch {
      /* ignore */
    }
  }, []);

  const startRec = useCallback(() => {
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
    rec.onerror = () => {};
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
      if (text) void send(text);
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
  }, [recording, busy, send]);

  const onMicDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    recStartXRef.current = e.clientX;
    cancelRef.current = false;
    setCancelArmed(false);
    startRec();
  };
  const onMicMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!recording) return;
    const canceling = e.clientX - recStartXRef.current < -60;
    if (canceling !== cancelRef.current) {
      cancelRef.current = canceling;
      setCancelArmed(canceling);
    }
  };
  const onMicUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (cancelRef.current) cancelRec();
    else stopRec();
  };
  const onMicKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (recording) stopRec();
      else startRec();
    } else if (e.key === "Escape" && recording) {
      e.preventDefault();
      cancelRec();
    }
  };

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    const clean = email.trim().toLowerCase();
    if (!EMAIL_RE.test(clean) || emailBusy) return;
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
        const reply: string = d?.reply ?? "Thank you — where were we?";
        setMsgs((m) => [...m, { id: herId, role: "her", text: reply }]);
        void speakHer(reply, herId);
      }
    } catch {
      /* leave the field open to retry */
    } finally {
      setEmailBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="mira-bot-fab" onClick={() => setOpen(true)} aria-label="Ask Mira">
        <span className="av" aria-hidden="true">M</span>
        Ask Mira
      </button>
    );
  }

  return (
    <div className="mira-bot-panel" role="dialog" aria-label="Chat with Mira">
      <div className="mira-bot-head">
        <span className="av" aria-hidden="true">M</span>
        <div style={{ flex: 1 }}>
          <strong style={{ fontWeight: 500 }}>Mira</strong>
          <div style={{ fontSize: 12, opacity: 0.85 }}>online · hold to talk</div>
        </div>
        <button
          type="button"
          className="mbv-voice-toggle"
          onClick={() => setVoiceOn((v) => !v)}
          aria-pressed={voiceOn}
          aria-label={voiceOn ? "Turn her voice off" : "Turn her voice on"}
          title={voiceOn ? "Voice on" : "Voice off"}
        >
          {voiceOn ? "🔊" : "🔈"}
        </button>
        <button
          onClick={() => setOpen(false)}
          aria-label="Close"
          style={{ width: 32, height: 32, display: "grid", placeItems: "center", background: "transparent", border: "none", color: "#fff", fontSize: 22, cursor: "pointer", lineHeight: 1 }}
        >
          ×
        </button>
      </div>

      <div className="mira-bot-log" ref={logRef}>
        {msgs.map((m) => (
          <div key={m.id} className={`mira-bot-msg ${m.role}`}>
            {m.text}
            {m.audioUrl && <VoiceNote src={m.audioUrl} autoplay={m.autoplay} />}
          </div>
        ))}
        {busy && (
          <div className="mira-bot-msg her" style={{ opacity: 0.9, padding: "10px 14px" }}>
            <RecallOrbit size={20} label="Recalling" />
          </div>
        )}
        {trialOpen && (
          <form className="mbv-trial" onSubmit={submitEmail}>
            <div className="mbv-trial-lead">Keep chatting — just your email. No card, ever.</div>
            <div className="mbv-trial-row">
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                aria-label="Your email to keep chatting"
              />
              <button type="submit" disabled={emailBusy} aria-label="Continue">
                {emailBusy ? "…" : "→"}
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="mira-bot-foot">
        <div className={`mbv-field ${recording ? "is-rec" : ""} ${cancelArmed ? "is-cancel" : ""}`}>
          {recording ? (
            <div className="mbv-rectray" role="status" aria-live="assertive">
              <span className="mbv-reclive-dot" aria-hidden />
              <span className="mbv-rectime">{fmtTime(recSecs)}</span>
              <div className="mbv-wave" aria-hidden>
                {Array.from({ length: 10 }).map((_, i) => (
                  <i key={i} style={{ animationDelay: `${(i % 5) * 90}ms` }} />
                ))}
              </div>
              <span className="mbv-rechint">
                {cancelArmed ? "Release to cancel" : interim || "‹ slide to cancel"}
              </span>
            </div>
          ) : (
            <>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send(input)}
                placeholder={supportsMic ? "Hold the mic, or type…" : "Type a message…"}
                aria-label="Message Mira"
              />
              {supportsMic && !input.trim() && (
                <span className="mbv-holdhint" aria-hidden>
                  Hold to talk
                </span>
              )}
            </>
          )}
        </div>

        {supportsMic && !input.trim() ? (
          <button
            type="button"
            className={`mbv-primary mbv-mic-btn ${recording ? "is-rec" : ""} ${cancelArmed ? "is-cancel" : ""}`}
            onPointerDown={onMicDown}
            onPointerMove={onMicMove}
            onPointerUp={onMicUp}
            onPointerCancel={onMicUp}
            onKeyDown={onMicKey}
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
            type="button"
            className="mbv-primary mbv-send-btn"
            onClick={() => send(input)}
            aria-label="Send"
            disabled={busy || !input.trim()}
          >
            <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2 11 13" />
              <path d="M22 2 15 22l-4-9-9-4 20-7z" />
            </svg>
          </button>
        )}
      </div>

      <div className="mbv-certify" aria-label="Mira is grounded and verified — it cannot fabricate">
        <span className="tick" aria-hidden>
          ✓
        </span>
        <span>
          <b>Mira</b> · grounded · verified
        </span>
      </div>
    </div>
  );
}
