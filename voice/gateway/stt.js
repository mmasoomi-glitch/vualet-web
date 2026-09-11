const STT_URL = process.env.STT_URL || "http://127.0.0.1:8801/transcribe";

/**
 * POST raw PCM bytes to the STT service and return the transcript text.
 *
 * @param {Uint8Array} pcmBuffer — 16 kHz little-endian mono PCM samples
 * @param {AbortSignal|null} [signal] — optional abort signal
 * @returns {Promise<{ text: string }>}
 */
export async function transcribe(pcmBuffer, signal = null) {
  const res = await fetch(STT_URL, {
    method: "POST",
    headers: { "Content-Type": "audio/vnd.wave" },
    body: pcmBuffer,
    signal,
  });

  if (!res.ok) {
    throw new Error(`STT ${res.status}: ${res.statusText}`);
  }

  return res.json();
}
