const TTS_URL = process.env.TTS_URL || "http://127.0.0.1:3000/api/veridian-voice";

/**
 * POST text to the TTS service and stream audio/mpeg chunks to onChunk.
 * Resolves normally on HTTP 204 (no ElevenLabs key configured) — client falls back to browser speech.
 *
 * @param {string} text — text to speak
 * @param {object} opts
 * @param {AbortSignal|null} [opts.signal]
 * @param {function(Uint8Array): void} [opts.onChunk] — receives each audio chunk
 * @returns {Promise<void>}
 */
export async function speak(text, { signal = null, onChunk = null } = {}) {
  const res = await fetch(TTS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  });

  if (res.status === 204) {
    // No ElevenLabs key — resolve without emitting chunks; client falls back to browser speech
    return;
  }

  if (!res.ok) {
    throw new Error(`TTS ${res.status}: ${res.statusText}`);
  }

  const reader = res.body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (onChunk) onChunk(new Uint8Array(value));
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}
