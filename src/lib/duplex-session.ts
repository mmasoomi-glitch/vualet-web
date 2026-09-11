/**
 * FULL-DUPLEX SESSION STATE MACHINE — CORE ONLY.
 *
 * No audio capture, WebRTC, WebSocket, microphone, or network code. Pure,
 * synchronous, fully testable with no browser and no audio hardware.
 *
 * The caller drives the machine by feeding events (voice-activity frames,
 * LLM tokens, turn-completion); the class decides transitions and emits
 * effect objects. The caller supplies the clock by passing a millisecond
 * timestamp into every event method, so tests are fully deterministic.
 *
 * Run:  npx tsc --noEmit          (must pass)
 *       node scripts/duplex-session-test.mjs   (must print pass count)
 */

// ── types ───────────────────────────────────────────────────────────────────

/** One of the four mutually-exclusive states. */
export type SessionState = "idle" | "listening" | "thinking" | "speaking";

/** Effects the caller must act on (route audio, push tokens, stop playback…). */
export type Effect =
  | { type: "startListening" }
  | { type: "endTurn"; transcriptMs: number }
  | { type: "cancelGeneration"; reason: "barge-in" }
  | { type: "stopPlayback" }
  | { type: "emitToken"; text: string };

// ── options ─────────────────────────────────────────────────────────────────

export interface DuplexSessionOptions {
  /** Minimum consecutive user-speech ms before a barge-in is recognised. */
  bargeInMs?: number;
  /** Silent-ms gap that closes a turn (only counted after speech ≥ minSpeechMs). */
  silenceMs?: number;
  /** Speech-ms below which a blip is discarded as spurious. */
  minSpeechMs?: number;
}

const DEFAULT_BARGE_IN_MS = 120;
const DEFAULT_SILENCE_MS = 700;
const DEFAULT_MIN_SPEECH_MS = 150;

// ── class ───────────────────────────────────────────────────────────────────

export class DuplexSession {
  private _state: SessionState = "idle";

  private _bargeInMs: number;
  private _silenceMs: number;
  private _minSpeechMs: number;

  // ── user-audio bookkeeping ──────────────────────────────────────────────
  private _energyActive = false;          // does current true streak span atMs?
  private _energyMs = 0;                  // ms of true in the current streak
  private _speechDurationMs = 0;          // total speech duration when silence ends
  private _hasMinSpeech = false;          // did speech cross minSpeechMs threshold?
  private _silenceCounterMs = 0;          // consecutive false-ms (listening only)

  // ── barge-in bookkeeping ────────────────────────────────────────────────
  private _bargeCounterMs = 0;            // consecutive true-ms while speaking
  private _generationActive = false;      // tokens until endTurn (or barge-in) are valid

  // ── constructed once, driven by events ──────────────────────────────────

  constructor(opts?: DuplexSessionOptions) {
    this._bargeInMs = opts?.bargeInMs ?? DEFAULT_BARGE_IN_MS;
    this._silenceMs = opts?.silenceMs ?? DEFAULT_SILENCE_MS;
    this._minSpeechMs = opts?.minSpeechMs ?? DEFAULT_MIN_SPEECH_MS;
  }

  get state(): SessionState {
    return this._state;
  }

  // ── public event methods ────────────────────────────────────────────────

  onUserAudio(energyAboveThreshold: boolean, atMs: number): Effect[] {
    const effects: Effect[] = [];

    if (this._state === "idle") {
      if (!energyAboveThreshold) return effects; // spurious noise — stay idle
      this._state = "listening";
      this._energyActive = true;
      this._energyMs = 1; // atMs is passed in; each frame is 1 ms
      effects.push({ type: "startListening" });
      return effects;
    }

    if (this._state === "listening") {
      if (energyAboveThreshold) {
        this._energyActive = true;
        this._energyMs++;
        // Track total speech duration — only mark threshold crossed
        if (!this._hasMinSpeech && this._energyMs >= this._minSpeechMs) {
          this._hasMinSpeech = true;
        }
        return effects;
      }

      // energy went false
      if (this._energyActive) {
        // Speech just stopped. Check if we had enough.
        this._energyActive = false;
        if (this._energyMs < this._minSpeechMs) {
          // Rule 2 — spurious blip, return to idle
          this._state = "idle";
          this._silenceCounterMs = 0;
          this._hasMinSpeech = false;
          this._energyMs = 0;
          return effects;
        }
        // Speech >= minSpeechMs — lock in the actual speech duration
        this._speechDurationMs = this._energyMs;
      }

      // Accumulate silence once speech crossed minSpeechMs
      if (this._hasMinSpeech && !this._energyActive) {
        this._silenceCounterMs++;
        if (this._silenceCounterMs >= this._silenceMs) {
          // Rule 3 — silence closed the turn with actual speech duration
          effects.push({ type: "endTurn", transcriptMs: this._speechDurationMs });
          this._state = "thinking";
        }
        // If silence not yet long enough, stay in listening (user may resume)
        return effects;
      }
      return effects;
    }

    // ── speaking state: check for barge-in ────────────────────────────────
    if (this._state === "speaking") {
      if (energyAboveThreshold) {
        this._bargeCounterMs++;
        if (this._bargeCounterMs >= this._bargeInMs) {
          // Rule 1 + Rule 5 — barge-in detected, transition to listening
          effects.push(
            { type: "cancelGeneration", reason: "barge-in" },
            { type: "stopPlayback" },
            { type: "startListening" }
          );
          this._state = "listening";
          this._generationActive = false;
          this._bargeCounterMs = 0;
          this._energyActive = true;
          this._energyMs = 1;
          this._silenceCounterMs = 0;
          this._hasMinSpeech = false;
          this._speechDurationMs = 0;
          return effects;
        }
      } else {
        // Brief pause while speaking — reset barge-in counter (must be continuous)
        if (this._bargeCounterMs > 0) {
          this._bargeCounterMs = 0;
        }
      }
      return effects;
    }

    // thinking: user audio is a no-op
    return effects;
  }

  onAssistantToken(text: string, atMs: number): Effect[] {
    const effects: Effect[] = [];

    if (this._state === "thinking") {
      // Rule 4 — first token moves us to speaking and emits the token
      this._state = "speaking";
      this._generationActive = true;
      this._bargeCounterMs = 0;
      effects.push({ type: "emitToken", text });
      return effects;
    }

    if (this._state === "speaking") {
      // Subsequent tokens while speaking — just emit, keep state
      if (this._generationActive) {
        effects.push({ type: "emitToken", text });
      }
      return effects;
    }

    // Rule 6 — late tokens after barge-in (state is "listening") are dropped
    // Any out-of-order / nonsensical sequence is a no-op (Rule 8)
    return effects;
  }

  onAssistantDone(atMs: number): Effect[] {
    const effects: Effect[] = [];

    if (this._state === "speaking") {
      // Rule 7 — natural end of assistant turn
      this._state = "idle";
      this._generationActive = false;
      this._bargeCounterMs = 0;
      return effects;
    }

    // Rule 7 — no-op if not speaking (Rule 8 — degrade gracefully)
    return effects;
  }

  reset(): void {
    // Rule 8 — back to idle, clearing all buffers
    this._state = "idle";
    this._energyActive = false;
    this._energyMs = 0;
    this._silenceCounterMs = 0;
    this._bargeCounterMs = 0;
    this._generationActive = false;
  }
}
