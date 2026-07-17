import { NextResponse } from "next/server";

/**
 * Veridian demo — VOICE OUTPUT (text-to-speech). POST { text } → her voice as
 * audio/mpeg, produced by ElevenLabs.
 *
 * GRACEFUL BY DESIGN — this route NEVER 500s the chat:
 *  - If ELEVENLABS_API_KEY is unset, or ElevenLabs errors/times out, it returns
 *    204 No Content. The client then falls back to the browser's built-in
 *    speechSynthesis, so the visitor still hears a voice.
 *  - Input text is capped; there is a per-IP rate limit AND a global daily cap
 *    (same pattern as veridian-demo) so public traffic can never drain the key.
 *  - No key is ever hardcoded — it comes only from process.env.
 */
export const runtime = "nodejs";

const VOICE_ID = "wwtvnX9zOFeUiNVujtdX";
const MODEL_ID = "eleven_multilingual_v2";
const TEXT_MAX_LEN = 700; // cap TTS input size
const RATE_LIMIT = 30; // requests
const RATE_WINDOW_MS = 60_000; // per minute per IP

// Global daily cap on TTS calls across all visitors. Beyond it we return 204 and
// the client uses browser speech, so the ElevenLabs key can never be drained.
// In-memory counter keyed to the UTC date (resets at midnight / on redeploy).
const GLOBAL_DAILY_CAP = Number(process.env.VERIDIAN_VOICE_DAILY_CAP || 1500);

const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (v.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(k);
    }
  }
  return arr.length > RATE_LIMIT;
}

let dayKey = "";
let dayCount = 0;
function reserveDailyCall(): boolean {
  const k = new Date().toISOString().slice(0, 10);
  if (k !== dayKey) {
    dayKey = k;
    dayCount = 0;
  }
  if (dayCount >= GLOBAL_DAILY_CAP) return false;
  dayCount += 1;
  return true;
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

/** 204 = "no audio available" — the client falls back to browser speech. */
function noAudio(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export async function POST(req: Request) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return noAudio(); // no key → browser speechSynthesis fallback

  if (rateLimited(clientIp(req))) return noAudio();
  if (!reserveDailyCall()) return noAudio();

  const body = await req.json().catch(() => ({}));
  let text = String(body?.text ?? "").trim();
  if (!text) return noAudio();
  if (text.length > TEXT_MAX_LEN) text = text.slice(0, TEXT_MAX_LEN);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": key,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: MODEL_ID,
          voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true },
        }),
        signal: controller.signal,
        cache: "no-store",
      },
    );

    if (!res.ok || !res.body) {
      console.error("[veridian-voice] upstream", res.status);
      return noAudio();
    }

    const audio = await res.arrayBuffer();
    if (!audio.byteLength) return noAudio();

    return new NextResponse(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[veridian-voice] error:", err);
    return noAudio();
  } finally {
    clearTimeout(timeout);
  }
}

// Only POST is supported.
export async function GET() {
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
}
