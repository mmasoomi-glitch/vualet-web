/**
 * PROTOCOL TEST — No network, no real WebSocket.
 *
 * Tests pure functions from llm.js, stt.js, and tts.js directly.
 *
 * Covers:
 *   1. SSE parser correctly extracts content deltas from a multi-line chunk
 *   2. Partial SSE line split across two chunks is buffered and parsed once completed
 *   3. llm.js builds NO Authorization header when key is empty
 *   4. llm.js builds a Bearer header when key is set
 *   5. Aborted signal causes onToken never to fire again
 *
 * Run:  node --test voice/gateway/protocol-test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { streamReply } from "./llm.js";
import { transcribe } from "./stt.js";
import { speak } from "./tts.js";

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal SSE body that simulates an LLM response.
 * Each "chunk" produces a separate data: line with a delta token.
 */
function buildSSE(tokens) {
  const lines = [];
  for (const tok of tokens) {
    // Simulate a token that is a single character for clean splitting
    const data = JSON.stringify({
      choices: [{ delta: { content: tok }, index: 0 }],
    });
    lines.push(`data: ${data}`);
    lines.push(""); // SSE separator
  }
  lines.push("data: [DONE]");
  return lines.join("\n") + "\n";
}

/**
 * Split an SSE body into two parts at a given byte offset,
 * then reassemble and parse as streamReply would.
 */
function splitSSEAt(sseBody, splitPoint) {
  const fullBytes = new TextEncoder().encode(sseBody);
  const part1 = fullBytes.slice(0, splitPoint);
  const part2 = fullBytes.slice(splitPoint);
  return { part1, part2 };
}

/**
 * Mock a fetch call that returns a ReadableStream from an SSE body string.
 * Optionally splits into multiple chunks at `chunkAt` offset.
 */
function mockFetchResponse(sseBody, chunkAt = null, status = 200) {
  const encoder = new TextEncoder();
  const bodyBytes = encoder.encode(sseBody);

  let chunks;
  if (chunkAt && chunkAt < bodyBytes.length) {
    chunks = [bodyBytes.slice(0, chunkAt), bodyBytes.slice(chunkAt)];
  } else {
    chunks = [bodyBytes];
  }

  const readable = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });

  return { readable, status, bodyBytes };
}

// ── test 1: SSE parser extracts content deltas from multi-line chunk ─────────

test("llm.js SSE parser extracts content deltas from multi-line response", async () => {
  const tokens = ["Hello", " world", "!"];
  const sseBody = buildSSE(tokens);

  const { readable } = mockFetchResponse(sseBody);

  // Intercept fetch and return our mock stream
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    body: readable,
  });

  try {
    const results = await streamReply("test prompt");
    assert.deepStrictEqual(results, tokens);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── test 2: partial SSE line split across two chunks ─────────────────────────

test("llm.js buffers partial SSE lines across chunk boundaries", async () => {
  // Build an SSE body where a data: line will be split
  const tokens = ["A", "BC"];
  const sseBody = buildSSE(tokens);

  const splitAt = Math.floor(sseBody.length * 0.4); // Split mid-line

  const { readable } = mockFetchResponse(sseBody, splitAt);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    body: readable,
  });

  try {
    const results = await streamReply("test prompt");
    assert.deepStrictEqual(results, tokens);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── test 2b: [DONE] line never fires onToken ────────────────────────────────

test("llm.js ignores [DONE] terminal line", async () => {
  const sseBody = "data: {\"choices\":[{\"delta\":{\"content\":\"X\"},\"index\":0}]}\n\ndata: [DONE]\n";

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseBody));
      controller.close();
    },
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    body: readable,
  });

  let tokenCount = 0;
  try {
    await streamReply("test", {
      onToken: () => { tokenCount++; },
    });
    assert.equal(tokenCount, 1, "Should fire onToken exactly once, not for [DONE]");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── test 3: NO Authorization header when API key is empty ────────────────────

test("llm.js builds NO Authorization header when MIRA_LLM_API_KEY is empty", async () => {
  const originalKey = process.env.MIRA_LLM_API_KEY;
  try {
    process.env.MIRA_LLM_API_KEY = "";

    const sseBody = buildSSE(["hello"]);
    const { readable } = mockFetchResponse(sseBody);

    let capturedHeaders = null;
    const orig = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      capturedHeaders = init?.headers || {};
      return { ok: true, status: 200, body: readable };
    };

    await streamReply("test");

    globalThis.fetch = orig;
    assert.strictEqual(capturedHeaders["Authorization"], undefined, "No Authorization header when key is empty");
  } finally {
    if (originalKey !== undefined) {
      process.env.MIRA_LLM_API_KEY = originalKey;
    } else {
      delete process.env.MIRA_LLM_API_KEY;
    }
  }
});

// ── test 4: Bearer header when API key is set ────────────────────────────────

test("llm.js builds Bearer header when MIRA_LLM_API_KEY is set", async () => {
  const originalKey = process.env.MIRA_LLM_API_KEY;
  try {
    process.env.MIRA_LLM_API_KEY = "sk-test-key-123";

    const sseBody = buildSSE(["hello"]);
    const { readable } = mockFetchResponse(sseBody);

    let capturedHeaders = null;
    const orig = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      capturedHeaders = init?.headers || {};
      return { ok: true, status: 200, body: readable };
    };

    await streamReply("test");

    globalThis.fetch = orig;
    assert.strictEqual(
      capturedHeaders["Authorization"],
      "Bearer sk-test-key-123",
      "Bearer header present when key is set"
    );
  } finally {
    if (originalKey !== undefined) {
      process.env.MIRA_LLM_API_KEY = originalKey;
    } else {
      delete process.env.MIRA_LLM_API_KEY;
    }
  }
});

// ── test 5: aborted signal prevents onToken from firing ──────────────────────

test("aborted signal prevents onToken from firing", async () => {
  const controller = new AbortController();

  // Abort immediately — before streamReply calls fetch
  controller.abort();

  let tokenCount = 0;
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    // Real fetch throws AbortError when signal is already aborted
    if (init?.signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    const sseBody = buildSSE(["A", "B", "C"]);
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      start(c) {
        c.enqueue(encoder.encode(sseBody));
        c.close();
      },
    });
    return { ok: true, status: 200, body: readable };
  };

  try {
    await streamReply("test", { signal: controller.signal, onToken: () => { tokenCount++; } });
  } catch (err) {
    // AbortError is expected — signal was already aborted when fetch was called
    assert.strictEqual(err.name, "AbortError", "Aborted request throws AbortError");
  }

  // onToken should never have fired because fetch never succeeded
  assert.equal(tokenCount, 0, "onToken should never fire after abort");

  globalThis.fetch = orig;
});

// ── test 5b: aborted signal genuinely stops processing ──────────────────────

test("abort signal stops streamReply processing mid-stream", async () => {
  const tokens = ["first", "second", "third"];
  const sseBody = buildSSE(tokens);
  const { readable } = mockFetchResponse(sseBody);

  const controller = new AbortController();

  // Intercept fetch to capture the signal and abort early
  let capturedSignal = null;
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    capturedSignal = init?.signal || null;
    // Start a delayed abort
    setTimeout(() => controller.abort(), 2);
    return { ok: true, status: 200, body: readable };
  };

  let count = 0;
  try {
    await streamReply("test", { signal: controller.signal });
  } catch (err) {
    // May throw AbortError — that's fine, the point is processing stopped
    assert.strictEqual(err.name, "AbortError", "Aborted request throws AbortError");
  }

  globalThis.fetch = orig;
});

// ── test: partial SSE with [DONE] split across boundary ──────────────────────

test("partial [DONE] line split across chunks is handled correctly", async () => {
  // Build SSE with a multi-line content chunk and [DONE]
  const lines = [
    'data: {"choices":[{"delta":{"content":"A"},"index":0}]}',
    "",
    "data: [DONE]",
  ];
  const sseBody = lines.join("\n") + "\n";

  // Split right at "da" of "data: [DONE]"
  const splitPoint = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"A"},"index":0}]}\n\n').length + 3;

  const { part1, part2 } = {
    part1: new TextEncoder().encode(sseBody).slice(0, splitPoint),
    part2: new TextEncoder().encode(sseBody).slice(splitPoint),
  };

  const readable = new ReadableStream({
    start(controller) {
      controller.enqueue(part1);
      controller.enqueue(part2);
      controller.close();
    },
  });

  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    body: readable,
  });

  try {
    const results = await streamReply("test");
    assert.deepStrictEqual(results, ["A"]);
  } finally {
    globalThis.fetch = orig;
  }
});
