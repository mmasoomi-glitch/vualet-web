import test from "node:test";
import assert from "node:assert/strict";
import { DuplexSession } from "../src/lib/duplex-session.ts";

const FRAME_MS = 20;

function speak(session, durationMs, startMs = 0, frameMs = FRAME_MS) {
  const frames = Math.round(durationMs / frameMs);
  const effects = [];
  for (let i = 0; i < frames; i++) {
    const atMs = startMs + i * frameMs;
    effects.push(...session.onUserAudio(true, atMs));
  }
  return effects;
}

function silence(session, durationMs, startMs = 0, frameMs = FRAME_MS) {
  const frames = Math.round(durationMs / frameMs);
  const effects = [];
  for (let i = 0; i < frames; i++) {
    const atMs = startMs + i * frameMs;
    effects.push(...session.onUserAudio(false, atMs));
  }
  return effects;
}

function nextMs(startMs, durationMs, frameMs = FRAME_MS) {
  return startMs + Math.round(durationMs / frameMs) * frameMs;
}

test("1. idle -> listening on first speech frame emits startListening", () => {
  const s = new DuplexSession({ minSpeechMs: 100, silenceMs: 200, bargeInMs: 120 });
  const eff = speak(s, 20, 0);
  assert.ok(eff.some(e => e.type === "startListening"), "Expected startListening effect");
  assert.equal(s.state, "listening", "State should be listening");
});

test("2. Short blip (40ms speech + 300ms silence) ends idle, no endTurn", () => {
  const s = new DuplexSession({ minSpeechMs: 100, silenceMs: 200, bargeInMs: 120 });
  let t = 0;
  speak(s, 40, t); t = nextMs(t, 40);
  const eff = silence(s, 300, t); t = nextMs(t, 300);
  assert.equal(s.state, "idle", "State should be idle after blip");
  assert.ok(!eff.some(e => e.type === "endTurn"), "Blip should NOT emit endTurn");
});

test("3. Full turn (200ms speech + 300ms silence) -> thinking, endTurn with transcriptMs ~200", () => {
  const s = new DuplexSession({ minSpeechMs: 100, silenceMs: 200, bargeInMs: 120 });
  let t = 0;
  speak(s, 200, t); t = nextMs(t, 200);
  const eff = silence(s, 300, t); t = nextMs(t, 300);
  assert.equal(s.state, "thinking", "State should be thinking");
  const et = eff.find(e => e.type === "endTurn");
  assert.ok(et, "EndTurn should be emitted");
  assert.ok(Math.abs(et.transcriptMs - 200) <= FRAME_MS, `transcriptMs was ${et.transcriptMs}ms, expected about 200ms`);
});

test("4. Token while thinking -> speaking, emitToken; second token keeps speaking", () => {
  const s = new DuplexSession({ minSpeechMs: 100, silenceMs: 200, bargeInMs: 120 });
  let t = 0;
  speak(s, 200, t); t = nextMs(t, 200);
  silence(s, 300, t); t = nextMs(t, 300);
  assert.equal(s.state, "thinking", "Should be thinking");
  const eff1 = s.onAssistantToken("hi", t);
  assert.equal(s.state, "speaking", "State should be speaking");
  assert.ok(eff1.some(e => e.type === "emitToken"), "First token should emitToken");
  const eff2 = s.onAssistantToken(" world", t + 10);
  assert.equal(s.state, "speaking", "State should remain speaking");
  assert.ok(eff2.some(e => e.type === "emitToken"), "Second token should emitToken");
});

test("5. Backchannel (60ms energy) while speaking leaves state speaking, no cancelGeneration", () => {
  const s = new DuplexSession({ minSpeechMs: 100, silenceMs: 200, bargeInMs: 120 });
  let t = 0;
  speak(s, 200, t); t = nextMs(t, 200);
  silence(s, 300, t); t = nextMs(t, 300);
  s.onAssistantToken("hi", t); t = nextMs(t, 0);
  assert.equal(s.state, "speaking", "Should be speaking");
  const eff = speak(s, 60, t); t = nextMs(t, 60);
  assert.equal(s.state, "speaking", "State should remain speaking for short backchannel");
  assert.ok(!eff.some(e => e.type === "cancelGeneration"), "No cancelGeneration for short backchannel");
});

test("6. Barge-in (260ms energy) while speaking -> listening, emits cancelGeneration and stopPlayback", () => {
  const s = new DuplexSession({ minSpeechMs: 100, silenceMs: 200, bargeInMs: 120 });
  let t = 0;
  speak(s, 200, t); t = nextMs(t, 200);
  silence(s, 300, t); t = nextMs(t, 300);
  s.onAssistantToken("hi", t); t = nextMs(t, 0);
  assert.equal(s.state, "speaking", "Should be speaking");
  const eff = speak(s, 260, t); t = nextMs(t, 260);
  assert.equal(s.state, "listening", "State should be listening after barge-in");
  assert.ok(eff.some(e => e.type === "cancelGeneration" && e.reason === "barge-in"), "Should emit cancelGeneration with reason barge-in");
  assert.ok(eff.some(e => e.type === "stopPlayback"), "Should emit stopPlayback");
});

test("7. Late tokens after barge-in return empty array, state remains listening", () => {
  const s = new DuplexSession({ minSpeechMs: 100, silenceMs: 200, bargeInMs: 120 });
  let t = 0;
  speak(s, 200, t); t = nextMs(t, 200);
  silence(s, 300, t); t = nextMs(t, 300);
  s.onAssistantToken("hi", t); t = nextMs(t, 0);
  speak(s, 260, t); t = nextMs(t, 260);
  assert.equal(s.state, "listening", "State should be listening");
  const eff = s.onAssistantToken("late", t);
  assert.equal(eff.length, 0, "Late token should return empty array");
  assert.equal(s.state, "listening", "State should remain listening");
});

test("8. After barge-in, fresh turn -> thinking, then token -> speaking", () => {
  const s = new DuplexSession({ minSpeechMs: 100, silenceMs: 200, bargeInMs: 120 });
  let t = 0;
  speak(s, 200, t); t = nextMs(t, 200);
  speak(s, 260, t); t = nextMs(t, 260);
  assert.equal(s.state, "listening", "Should be listening after barge-in");
  speak(s, 200, t); t = nextMs(t, 200);
  silence(s, 300, t); t = nextMs(t, 300);
  assert.equal(s.state, "thinking", "Should be thinking after fresh turn");
  const eff = s.onAssistantToken("new", t);
  assert.equal(s.state, "speaking", "Should be speaking after token");
  assert.ok(eff.some(e => e.type === "emitToken"), "Should emitToken");
});

test("9. onAssistantDone while speaking -> idle; while idle/listening returns empty", () => {
  const s = new DuplexSession({ minSpeechMs: 100, silenceMs: 200, bargeInMs: 120 });
  let t = 0;
  speak(s, 200, t); t = nextMs(t, 200);
  silence(s, 300, t); t = nextMs(t, 300);
  s.onAssistantToken("hi", t); t = nextMs(t, 0);
  assert.equal(s.state, "speaking", "Should be speaking");
  const eff1 = s.onAssistantDone(t);
  assert.equal(s.state, "idle", "State should be idle after done");
  assert.equal(eff1.length, 0, "onAssistantDone should emit no effects, got " + JSON.stringify(eff1));
  const eff2 = s.onAssistantDone(t + 10);
  assert.equal(eff2.length, 0, "Done while idle should return empty");
  assert.equal(s.state, "idle", "State should remain idle");
  speak(s, 20, t + 20); t = nextMs(t + 20, 20);
  assert.equal(s.state, "listening", "Should be listening");
  const eff3 = s.onAssistantDone(t + 30);
  assert.equal(eff3.length, 0, "Done while listening should return empty");
  assert.equal(s.state, "listening", "State should remain listening");
});

test("10. reset() mid-turn -> idle immediately; subsequent blip emits no endTurn", () => {
  const s = new DuplexSession({ minSpeechMs: 100, silenceMs: 200, bargeInMs: 120 });
  let t = 0;
  speak(s, 200, t); t = nextMs(t, 200);
  s.reset();
  assert.equal(s.state, "idle", "State should be idle after reset");
  speak(s, 40, t); t = nextMs(t, 40);
  const effBlip = silence(s, 300, t); t = nextMs(t, 300);
  assert.equal(s.state, "idle", "State should be idle after reset blip");
  assert.ok(!effBlip.some(e => e.type === "endTurn"), "Reset blip should NOT emit endTurn");
});

test("11. Large clock jump (500ms silence) closes turn -> thinking", () => {
  const s = new DuplexSession({ minSpeechMs: 100, silenceMs: 200, bargeInMs: 120 });
  let t = 0;
  speak(s, 200, t); t = nextMs(t, 200);
  const eff = silence(s, 500, t); t = nextMs(t, 500);
  assert.equal(s.state, "thinking", "State should be thinking after large silence jump");
  const et = eff.find(e => e.type === "endTurn");
  assert.ok(et, "EndTurn should be emitted");
  assert.ok(Math.abs(et.transcriptMs - 200) <= FRAME_MS, `transcriptMs was ${et.transcriptMs}ms, expected about 200ms`);
});

test("12. Non-monotonic clock does not throw, transcriptMs is non-negative", () => {
  const s = new DuplexSession({ minSpeechMs: 100, silenceMs: 200, bargeInMs: 120 });
  let t = 0;
  speak(s, 200, t); t = nextMs(t, 200);
  silence(s, 300, t); t = nextMs(t, 300);
  assert.equal(s.state, "thinking", "Should be thinking");
  const eff = silence(s, 10, t - 50);
  assert.ok(!eff.some(e => e.type === "endTurn" && e.transcriptMs < 0), "transcriptMs should not be negative");
});
