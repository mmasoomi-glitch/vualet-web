/**
 * DUPLEX-SESSION TEST — full-duplex voice state machine.
 *
 * Proves the four-state FSM (idle → listening → thinking → speaking) handles
 * every transition, edge-case, and regression described in the spec.
 *
 * Covers:
 *   1.  idle + first true energy frame → listening + startListening
 *   2.  speech shorter than minSpeechMs → back to idle, no endTurn
 *   3.  speech ≥ minSpeechMs + silence ≥ silenceMs → endTurn + thinking
 *   4.  token while thinking → speaking + emitToken
 *   5.  barge-in: sustained user audio ≥ bargeInMs while speaking
 *   6.  late tokens after barge-in are silently dropped
 *   7.  onAssistantDone while speaking → idle; elsewhere → no-op
 *   8.  out-of-order / nonsensical sequences degrade gracefully (no throws)
 *
 * Also specifically verifies:
 *   • A backchannel "mhm" shorter than bargeInMs does NOT interrupt her.
 *   • A sustained interruption DOES trigger barge-in.
 *   • Late tokens after barge-in are dropped (the single worst failure mode).
 *
 * Run: node scripts/duplex-session-test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DuplexSession } from "../src/lib/duplex-session.ts";

// ── helpers ─────────────────────────────────────────────────────────────────

/** Emit N frames of energy=true at consecutive ms offsets. */
function speak(session, frames, atStartMs = 0) {
  const effects = [];
  for (let i = 0; i < frames; i++) {
    effects.push(...session.onUserAudio(true, atStartMs + i));
  }
  return effects;
}

/** Emit N frames of energy=false at consecutive ms offsets. */
function silence(session, frames, atStartMs = 0) {
  const effects = [];
  for (let i = 0; i < frames; i++) {
    effects.push(...session.onUserAudio(false, atStartMs + i));
  }
  return effects;
}

// ── rule 1: idle → listening on first true frame ────────────────────────────

test("rule 1 — idle + first true energy frame → listening + startListening", () => {
  const s = new DuplexSession();
  assert.equal(s.state, "idle");

  const effects = s.onUserAudio(true, 0);
  assert.equal(s.state, "listening");
  assert.deepStrictEqual(effects, [{ type: "startListening" }]);
});

test("rule 1 — idle + false energy frame is a no-op", () => {
  const s = new DuplexSession();
  const effects = s.onUserAudio(false, 0);
  assert.equal(s.state, "idle");
  assert.deepStrictEqual(effects, []);
});

// ── rule 2: sub-minSpeechMs blip returns to idle, no endTurn ────────────────

test("rule 2 — speech shorter than minSpeechMs returns to idle, no endTurn", () => {
  const s = new DuplexSession({ minSpeechMs: 150 });

  // 50 true frames → still below 150
  speak(s, 50, 0);
  assert.equal(s.state, "listening");

  // 50 false frames → speech stopped, total was 50 < 150
  const effects = silence(s, 50, 50);
  assert.equal(s.state, "idle");
  assert.deepStrictEqual(effects, []);
});

// ── rule 3: speech ≥ minSpeechMs + silence → endTurn + thinking ─────────────

test("rule 3 — speech ≥ minSpeechMs followed by silence → endTurn + thinking", () => {
  const s = new DuplexSession({ minSpeechMs: 150, silenceMs: 100 });

  // Build up speech to exactly 150
  speak(s, 150, 0);
  assert.equal(s.state, "listening");

  // Add silence frames
  const effects = silence(s, 100, 150);
  assert.equal(s.state, "thinking");
  assert.ok(effects.some((e) => e.type === "endTurn"));
  const endTurn = effects.find((e) => e.type === "endTurn");
  assert.deepStrictEqual(endTurn, { type: "endTurn", transcriptMs: 150 });
});

test("rule 3 — speech well above minSpeechMs still records exact speech duration", () => {
  const s = new DuplexSession({ minSpeechMs: 150, silenceMs: 100 });

  // 300 ms of speech
  speak(s, 300, 0);

  const effects = silence(s, 100, 300);
  assert.equal(s.state, "thinking");
  const endTurn = effects.find((e) => e.type === "endTurn");
  assert.deepStrictEqual(endTurn, { type: "endTurn", transcriptMs: 300 });
});

// ── rule 4: token while thinking → speaking + emitToken ─────────────────────

test("rule 4 — onAssistantToken while thinking moves to speaking + emitToken", () => {
  const s = new DuplexSession({ minSpeechMs: 150, silenceMs: 100 });
  speak(s, 150, 0);
  silence(s, 100, 150);
  assert.equal(s.state, "thinking");

  const effects = s.onAssistantToken("Hello", 0);
  assert.equal(s.state, "speaking");
  assert.deepStrictEqual(effects, [{ type: "emitToken", text: "Hello" }]);
});

test("rule 4 — further tokens while speaking emitToken and keep state", () => {
  const s = new DuplexSession({ minSpeechMs: 150, silenceMs: 100 });
  speak(s, 150, 0);
  silence(s, 100, 150);

  s.onAssistantToken("Hello", 0);
  assert.equal(s.state, "speaking");

  const effects = s.onAssistantToken(" world", 1);
  assert.equal(s.state, "speaking");
  assert.deepStrictEqual(effects, [{ type: "emitToken", text: " world" }]);
});

// ── rule 5: barge-in on sustained audio ≥ bargeInMs ─────────────────────────

test("rule 5 — sustained user audio ≥ bargeInMs while speaking triggers barge-in", () => {
  const s = new DuplexSession({ minSpeechMs: 100, silenceMs: 100, bargeInMs: 120 });

  // Enter speaking state
  speak(s, 100, 0);
  silence(s, 100, 100);
  s.onAssistantToken("I'm talking now", 0);
  assert.equal(s.state, "speaking");

  // 120 consecutive true frames while speaking
  const effects = speak(s, 120, 0);
  assert.equal(s.state, "listening");
  assert.ok(effects.some((e) => e.type === "cancelGeneration"));
  assert.ok(effects.some((e) => e.type === "stopPlayback"));
  const cancel = effects.find((e) => e.type === "cancelGeneration");
  assert.deepStrictEqual(cancel, { type: "cancelGeneration", reason: "barge-in" });
  const stop = effects.find((e) => e.type === "stopPlayback");
  assert.deepStrictEqual(stop, { type: "stopPlayback" });
});

// ── rule 6: late tokens after barge-in are dropped ──────────────────────────

test("rule 6 — late tokens after barge-in are silently dropped", () => {
  const s = new DuplexSession({ minSpeechMs: 100, silenceMs: 100, bargeInMs: 120 });

  // Enter speaking
  speak(s, 100, 0);
  silence(s, 100, 100);
  s.onAssistantToken("Starting", 0);
  assert.equal(s.state, "speaking");

  // Barge-in
  speak(s, 120, 0);
  assert.equal(s.state, "listening");

  // Late token arrives — should be dropped, not change state
  const effects = s.onAssistantToken(" late", 200);
  assert.equal(s.state, "listening"); // state unchanged
  assert.deepStrictEqual(effects, []); // no effect emitted
});

test("rule 6 — late tokens after barge-in never sneak into thinking", () => {
  const s = new DuplexSession({ minSpeechMs: 100, silenceMs: 100, bargeInMs: 120 });

  speak(s, 100, 0);
  silence(s, 100, 100);
  s.onAssistantToken("start", 0);
  speak(s, 120, 0); // barge-in → listening
  assert.equal(s.state, "listening");

  // Multiple late tokens, then a real endTurn to thinking
  const late1 = s.onAssistantToken("late1", 0);
  const late2 = s.onAssistantToken("late2", 1);
  assert.deepStrictEqual(late1, []);
  assert.deepStrictEqual(late2, []);
  assert.equal(s.state, "listening");

  // Now user speaks a real turn to get back to thinking
  speak(s, 100, 10);
  silence(s, 100, 110);
  assert.equal(s.state, "thinking");

  // Only now should a token be accepted
  const ok = s.onAssistantToken("real token", 210);
  assert.deepStrictEqual(ok, [{ type: "emitToken", text: "real token" }]);
  assert.equal(s.state, "speaking");
});

// ── rule 5 (specific): backchannel "mhm" shorter than bargeInMs does NOT interrupt ──

test("backchannel 'mhm' < bargeInMs does NOT interrupt assistant", () => {
  const s = new DuplexSession({ minSpeechMs: 100, silenceMs: 100, bargeInMs: 120 });

  speak(s, 100, 0);
  silence(s, 100, 100);
  s.onAssistantToken("I keep talking", 0);
  assert.equal(s.state, "speaking");

  // User says "mhm" for 50 ms (well below 120 threshold)
  const effects = speak(s, 50, 0);
  assert.equal(s.state, "speaking"); // still speaking!
  assert.deepStrictEqual(effects, []); // no barge-in effects
});

test("backchannel 'mhm' — true then false below threshold", () => {
  const s = new DuplexSession({ minSpeechMs: 100, silenceMs: 100, bargeInMs: 120 });

  speak(s, 100, 0);
  silence(s, 100, 100);
  s.onAssistantToken("keep going", 0);
  assert.equal(s.state, "speaking");

  // 80 ms of true, then false — still below 120
  const effects = speak(s, 80, 0);
  assert.equal(s.state, "speaking");
  assert.deepStrictEqual(effects, []);
});

// ── rule 7: onAssistantDone ────────────────────────────────────────────────

test("rule 7 — onAssistantDone while speaking → idle", () => {
  const s = new DuplexSession({ minSpeechMs: 100, silenceMs: 100 });

  speak(s, 100, 0);
  silence(s, 100, 100);
  s.onAssistantToken("done", 0);
  assert.equal(s.state, "speaking");

  const effects = s.onAssistantDone(0);
  assert.equal(s.state, "idle");
  assert.deepStrictEqual(effects, []);
});

test("rule 7 — onAssistantDone while not speaking is a no-op", () => {
  const s = new DuplexSession({ silenceMs: 100 });

  // idle
  assert.deepStrictEqual(s.onAssistantDone(0), []);
  assert.equal(s.state, "idle");

  // listening
  s.onUserAudio(true, 0);
  assert.equal(s.state, "listening");
  assert.deepStrictEqual(s.onAssistantDone(1), []);
  assert.equal(s.state, "listening");

  // thinking
  s.reset();
  speak(s, 150, 0);
  silence(s, 100, 150);
  assert.equal(s.state, "thinking");
  assert.deepStrictEqual(s.onAssistantDone(0), []);
  assert.equal(s.state, "thinking");
});

// ── rule 8: out-of-order / nonsensical sequences degrade gracefully ──────────

test("rule 8 — out-of-order events never throw", () => {
  const s = new DuplexSession();

  // Multiple resets should not throw
  s.reset();
  s.reset();
  assert.equal(s.state, "idle");

  // Token before endTurn (while idle) is a no-op
  assert.deepStrictEqual(s.onAssistantToken("early", 0), []);
  assert.equal(s.state, "idle");

  // onAssistantDone in idle is a no-op
  assert.deepStrictEqual(s.onAssistantDone(0), []);
  assert.equal(s.state, "idle");
});

test("rule 8 — multiple consecutive resets", () => {
  const s = new DuplexSession({ minSpeechMs: 100, silenceMs: 100 });
  speak(s, 100, 0);
  silence(s, 100, 100);
  assert.equal(s.state, "thinking");

  s.reset();
  assert.equal(s.state, "idle");

  s.onUserAudio(true, 0);
  assert.equal(s.state, "listening");

  s.reset();
  assert.equal(s.state, "idle");
});

// ── reset ───────────────────────────────────────────────────────────────────

test("reset clears all state back to idle", () => {
  const s = new DuplexSession({ minSpeechMs: 100, silenceMs: 100 });

  speak(s, 100, 0);
  silence(s, 100, 100);
  s.onAssistantToken("token", 0);
  assert.equal(s.state, "speaking");

  s.reset();
  assert.equal(s.state, "idle");

  // Late token after reset is still a no-op
  assert.deepStrictEqual(s.onAssistantToken("post-reset", 0), []);
  assert.equal(s.state, "idle");
});

// ── custom defaults ─────────────────────────────────────────────────────────

test("custom constructor options are respected", () => {
  const s = new DuplexSession({
    bargeInMs: 50,
    silenceMs: 200,
    minSpeechMs: 50,
  });

  speak(s, 50, 0); // hits minSpeechMs=50

  const effects = silence(s, 200, 50);
  assert.equal(s.state, "thinking");
  const endTurn = effects.find((e) => e.type === "endTurn");
  assert.deepStrictEqual(endTurn, { type: "endTurn", transcriptMs: 50 });

  // Now enter speaking and test barge-in with custom threshold
  s.onAssistantToken("talk", 0);
  assert.equal(s.state, "speaking");

  // 50 true frames should trigger barge-in with bargeInMs=50
  const bargeEffects = speak(s, 50, 0);
  assert.equal(s.state, "listening");
  assert.ok(bargeEffects.some((e) => e.type === "cancelGeneration"));
});
