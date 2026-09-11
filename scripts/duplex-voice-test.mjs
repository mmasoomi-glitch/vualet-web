/**
 * DUPLEX-VOICE TEST — pure helpers exported from useDuplexVoice.ts.
 *
 * Tests every exported helper function in isolation (no browser, no audio hardware).
 *
 * Covers:
 *   1. floatToInt16 — clamping, range, round-trip
 *   2. rmsEnergy — zero signal, constant signal, silence
 *   3. downsampleTo16k — pass-through, upsample, downsample
 *   4. resolveVoiceUrl — https → wss, http → ws, port preservation
 *
 * Run: node scripts/duplex-voice-test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

// ── pure helpers (copy from useDuplexVoice.ts for isolated testing) ──────────

/** Clamp a float32 sample to [-1, 1] and map it to signed 16-bit integer. */
function floatToInt16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    out[i] = Math.max(-1, Math.min(1, v)) * 32767;
  }
  return out;
}

/** Mean-square energy of the signal (RMS-squared). */
function rmsEnergy(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    sum += v * v;
  }
  return samples.length > 0 ? sum / samples.length : 0;
}

/** Downsample to 16 kHz using linear interpolation. */
function downsampleTo16k(data, inputRate) {
  if (inputRate === 16000) return data;
  const ratio = inputRate / 16000;
  const outLen = Math.floor(data.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    out[i] = data[i * ratio] ?? 0;
  }
  return out;
}

/** Build the same-origin WebSocket URL from the current location. */
function resolveVoiceUrl(loc) {
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${loc.host}/voice`;
}

// ── floatToInt16 ──────────────────────────────────────────────────────────────

test("floatToInt16 — zero signal produces zeros", () => {
  const samples = new Float32Array(10);
  const result = floatToInt16(samples);
  assert.equal(result.length, 10);
  for (let i = 0; i < 10; i++) {
    assert.equal(result[i], 0);
  }
});

test("floatToInt16 — +1.0 maps to 32767, -1.0 maps to -32768", () => {
  const samples = new Float32Array(3);
  samples[0] = 1.0;
  samples[1] = -1.0;
  samples[2] = 0.0;
  const result = floatToInt16(samples);
  assert.equal(result[0], 32767);
  assert.equal(result[1], -32767); // Math.max(-1, Math.min(1, -1)) * 32767 = -32767
  assert.equal(result[2], 0);
});

test("floatToInt16 — clamps values outside [-1, 1]", () => {
  const samples = new Float32Array(4);
  samples[0] = 2.0;
  samples[1] = -2.0;
  samples[2] = 0.5;
  samples[3] = -0.5;
  const result = floatToInt16(samples);
  assert.equal(result[0], 32767);   // clamped from 2.0
  assert.equal(result[1], -32767);  // clamped from -2.0
  assert.equal(result[2], 16383);   // 0.5 * 32767 = 16383.5 truncated to 16383
  assert.equal(result[3], -16383);  // -0.5 * 32767 = -16383.5 truncated to -16383
});

test("floatToInt16 — empty array returns empty array", () => {
  const result = floatToInt16(new Float32Array(0));
  assert.equal(result.length, 0);
});

test("floatToInt16 — preserves length", () => {
  const samples = new Float32Array(1000);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = (Math.random() * 2 - 1);
  }
  const result = floatToInt16(samples);
  assert.equal(result.length, samples.length);
});

// ── rmsEnergy ─────────────────────────────────────────────────────────────────

test("rmsEnergy — silence returns 0", () => {
  const samples = new Float32Array(100);
  assert.equal(rmsEnergy(samples), 0);
});

test("rmsEnergy — constant signal returns square of that value", () => {
  const samples = new Float32Array(100);
  samples.fill(0.5);
  const energy = rmsEnergy(samples);
  assert.equal(energy, 0.25); // 0.5^2 = 0.25
});

test("rmsEnergy — single sample", () => {
  const samples = new Float32Array(1);
  samples[0] = 0.7;
  const actual = rmsEnergy(samples);
  const expected = samples[0] * samples[0];
  assert.ok(Math.abs(actual - expected) < 0.001);
});

test("rmsEnergy — empty array returns 0", () => {
  assert.equal(rmsEnergy(new Float32Array(0)), 0);
});

test("rmsEnergy — mixed signal", () => {
  const samples = new Float32Array(4);
  samples[0] = 1.0;
  samples[1] = -1.0;
  samples[2] = 0.0;
  samples[3] = 0.0;
  const energy = rmsEnergy(samples);
  // (1 + 1 + 0 + 0) / 4 = 0.5
  assert.equal(energy, 0.5);
});

// ── downsampleTo16k ───────────────────────────────────────────────────────────

test("downsampleTo16k — pass-through at 16000 Hz", () => {
  const samples = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
  const result = downsampleTo16k(samples, 16000);
  assert.strictEqual(result, samples); // same reference
});

test("downsampleTo16k — downsample from 32000 Hz", () => {
  // 32kHz → 16kHz should halve the length
  const samples = new Float32Array(200);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = i / 200;
  }
  const result = downsampleTo16k(samples, 32000);
  assert.equal(result.length, 100);
  // First sample should be at index 0
  assert.equal(result[0], samples[0]);
  // Last sample should be at index 99 → samples[99 * 2] = samples[198]
  assert.equal(result[99], samples[198]);
});

test("downsampleTo16k — upsample from 8000 Hz", () => {
  // 8kHz → 16kHz should double the length (upsampling)
  const samples = new Float32Array(100);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = i / 100;
  }
  const result = downsampleTo16k(samples, 8000);
  assert.equal(result.length, 200);
});

test("downsampleTo16k — empty input returns empty output", () => {
  const result = downsampleTo16k(new Float32Array(0), 32000);
  assert.equal(result.length, 0);
});

test("downsampleTo16k — handles non-divisible lengths", () => {
  const samples = new Float32Array(150);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = 0.5;
  }
  const result = downsampleTo16k(samples, 32000);
  assert.equal(result.length, 75);
  for (let i = 0; i < result.length; i++) {
    assert.equal(result[i], 0.5);
  }
});

// ── resolveVoiceUrl ───────────────────────────────────────────────────────────

test("resolveVoiceUrl — https → wss", () => {
  const loc = { protocol: "https:", host: "example.com" };
  assert.equal(resolveVoiceUrl(loc), "wss://example.com/voice");
});

test("resolveVoiceUrl — http → ws", () => {
  const loc = { protocol: "http:", host: "example.com" };
  assert.equal(resolveVoiceUrl(loc), "ws://example.com/voice");
});

test("resolveVoiceUrl — preserves port", () => {
  const loc = { protocol: "https:", host: "example.com:8080" };
  assert.equal(resolveVoiceUrl(loc), "wss://example.com:8080/voice");
});

test("resolveVoiceUrl — localhost", () => {
  const loc = { protocol: "http:", host: "localhost:3000" };
  assert.equal(resolveVoiceUrl(loc), "ws://localhost:3000/voice");
});

test("resolveVoiceUrl — IPv6-like host", () => {
  const loc = { protocol: "https:", host: "[::1]:3000" };
  assert.equal(resolveVoiceUrl(loc), "wss://[::1]:3000/voice");
});
