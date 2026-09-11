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

  // ── user-audio bookkeeping (timestamp-based) ────────────────────────────
  private _speechStartMs: number | null = null;
  private _silenceStartMs: number | null = null;
  private _speechDurationMs: number = 0;
  private _hasMinSpeech: boolean = false;

  // ── barge-in bookkeeping (timestamp-based) ──────────────────────────────
  private _bargeStartMs: number | null = null;

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

    // Rule 1: From idle, a first frame with energy true → listening, emits startListening.
    if (this._state === "idle") {
      if (!energyAboveThreshold) return effects; // spurious noise — stay idle
      this._state = "listening";
      this._speechStartMs = atMs;
      this._silenceStartMs = null;
      this._speechDurationMs = 0;
      this._hasMinSpeech = false;
      effects.push({ type: "startListening" });
      return effects;
    }

    // Rule 2 & 3: Listening state logic.
    if (this._state === "listening") {
      if (energyAboveThreshold) {
        // Speech is active.
        // If we were in a silence gap, a new speech burst starts.
        if (this._silenceStartMs !== null) {
          this._silenceStartMs = null;
        }
        // Start a new speech run only if one isn't already open.
        if (this._speechStartMs === null) {
          this._speechStartMs = atMs;
          this._speechDurationMs = 0;
          this._hasMinSpeech = false;
        }
        return effects;
      }

      // Energy went false.
      if (this._speechStartMs !== null) {
        // A speech burst just ended. Calculate its duration.
        const duration = Math.max(0, atMs - this._speechStartMs);
        this._speechDurationMs = duration;

        if (duration < this._minSpeechMs) {
          // Rule 2: Spurious blip. Return to idle.
          this._state = "idle";
          this._speechStartMs = null;
          this._silenceStartMs = null;
          this._speechDurationMs = 0;
          this._hasMinSpeech = false;
          return effects;
        }

        // Speech was long enough. Mark it as valid and start silence timer.
        this._hasMinSpeech = true;
        this._silenceStartMs = atMs;
        // Close the speech run so subsequent silent frames don't reset silenceStartMs.
        this._speechStartMs = null;
      }

      // If we have valid speech, check for silence closure.
      if (this._hasMinSpeech && this._silenceStartMs !== null) {
        const silenceDuration = Math.max(0, atMs - this._silenceStartMs);
        if (silenceDuration >= this._silenceMs) {
          // Rule 3: Silence closed the turn.
          effects.push({ type: "endTurn", transcriptMs: this._speechDurationMs });
          this._state = "thinking";
          this._speechStartMs = null;
          this._silenceStartMs = null;
          this._speechDurationMs = 0;
          this._hasMinSpeech = false;
        }
      }
      return effects;
    }

    // Rule 5: Speaking state: check for barge-in.
    if (this._state === "speaking") {
      if (energyAboveThreshold) {
        // Barge-in energy detected.
        if (this._bargeStartMs === null) {
          this._bargeStartMs = atMs;
        } else {
          const bargeDuration = Math.max(0, atMs - this._bargeStartMs);
          if (bargeDuration >= this._bargeInMs) {
            // Rule 5: Barge-in threshold reached.
            effects.push(
              { type: "cancelGeneration", reason: "barge-in" },
              { type: "stopPlayback" },
              { type: "startListening" }
            );
            this._state = "listening";
            this._bargeStartMs = null;
            this._speechStartMs = atMs;
            this._silenceStartMs = null;
            this._speechDurationMs = 0;
            this._hasMinSpeech = false;
            return effects;
          }
        }
      } else {
        // Energy dropped during potential barge-in. Reset barge timer.
        this._bargeStartMs = null;
      }
      return effects;
    }

    // Thinking: user audio is a no-op.
    return effects;
  }

  onAssistantToken(text: string, atMs: number): Effect[] {
    const effects: Effect[] = [];

    // Rule 4: First token while thinking → speaking, emits emitToken.
    if (this._state === "thinking") {
      this._state = "speaking";
      this._bargeStartMs = null;
      effects.push({ type: "emitToken", text });
      return effects;
    }

    // Rule 4: Subsequent tokens while speaking.
    if (this._state === "speaking") {
      effects.push({ type: "emitToken", text });
      return effects;
    }

    // Rule 6: After barge-in (state is "listening") or idle, late tokens are discarded.
    return effects;
  }

  onAssistantDone(atMs: number): Effect[] {
    const effects: Effect[] = [];

    // Rule 7: Natural end of assistant turn.
    if (this._state === "speaking") {
      this._state = "idle";
      this._bargeStartMs = null;
      return effects;
    }

    // Rule 7: No-op if not speaking.
    return effects;
  }

  reset(): void {
    // Rule 8: Back to idle, clearing all buffers.
    this._state = "idle";
    this._speechStartMs = null;
    this._silenceStartMs = null;
    this._speechDurationMs = 0;
    this._hasMinSpeech = false;
    this._bargeStartMs = null;
  }
}
