import { WebSocketServer } from "ws";
import { DuplexSession } from "../../src/lib/duplex-session.ts";
import { transcribe } from "./stt.js";
import { streamReply } from "./llm.js";
import { speak } from "./tts.js";

const VOICE_HOST = process.env.VOICE_HOST || "127.0.0.1";
const VOICE_PORT = parseInt(process.env.VOICE_PORT || "8802", 10);
const VOICE_MAX_PCM_BYTES = parseInt(process.env.VOICE_MAX_PCM_BYTES || "10000000", 10);

/**
 * Send a JSON text frame to the WebSocket client, with crash guard.
 */
function sendJSON(ws, obj) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(obj));
  }
}

/**
 * Process the current utterance buffer: transcribe → LLM → TTS → stream back.
 */
async function processUtterance(ws, session, pcmBuffer, llmAbort) {
  try {
    // 1. Transcribe
    const { text } = await transcribe(pcmBuffer, llmAbort.signal);

    if (!text) {
      sendJSON(ws, { type: "done" });
      return;
    }

    sendJSON(ws, { type: "transcript", text });

    // 2. LLM stream
    const tokens = await streamReply(text, {
      signal: llmAbort.signal,
      onToken: (t) => {
        sendJSON(ws, { type: "token", text: t });
      },
    });

    // 3. TTS — concatenate all token text
    const fullText = tokens.join("");
    if (fullText) {
      await speak(fullText, {
        signal: llmAbort.signal,
        onChunk: (chunk) => {
          if (ws.readyState === 1) {
            ws.send(chunk);
          }
        },
      });
    }

    sendJSON(ws, { type: "done" });
  } catch (err) {
    if (err.name === "AbortError") return;
    sendJSON(ws, { type: "error", message: err.message });
  }
}

const wss = new WebSocketServer({ host: VOICE_HOST, port: VOICE_PORT });

console.log(`Mira Voice Gateway listening on ${VOICE_HOST}:${VOICE_PORT}`);

wss.on("connection", (rawSocket) => {
  const ws = rawSocket;
  const session = new DuplexSession();
  let helloDone = false;

  // Per-connection utterance buffer
  let pcmBuffer = new Uint8Array(0);
  let pcmSize = 0;

  // Abort controller for the current in-flight LLM+TTS pipeline
  let llmAbort = null;

  // Track whether we're currently processing an utterance
  let processing = false;

  // Move this inside the handler so it closes over session, llmAbort, processing, pcmBuffer, pcmSize
  function handleEffects(effects) {
    for (const effect of effects) {
      switch (effect.type) {
        case "startListening":
          break;

        case "endTurn": {
          if (processing && llmAbort) {
            llmAbort.abort();
            llmAbort = null;
          }

          if (pcmSize > 0) {
            const buf = pcmBuffer;
            pcmBuffer = new Uint8Array(0);
            pcmSize = 0;

            llmAbort = new AbortController();
            processing = true;

            processUtterance(ws, session, buf, llmAbort).then(() => {
              processing = false;
              llmAbort = null;
            });
          }
          break;
        }

        case "cancelGeneration": {
          sendJSON(ws, { type: "cancel", reason: "barge-in" });

          if (llmAbort) {
            llmAbort.abort();
            llmAbort = null;
          }
          processing = false;

          pcmBuffer = new Uint8Array(0);
          pcmSize = 0;
          break;
        }

        case "stopPlayback":
          break;

        case "emitToken":
          break;
      }
    }
  }

  ws.on("message", (data) => {
    try {
      if (data instanceof ArrayBuffer) {
        data = Buffer.from(data);
      }

      if (data instanceof Buffer) {
        if (data.byteLength === 0) return;

        if (!helloDone) {
          console.log("[ws] binary frame before hello — dropping");
          return;
        }

        const frame = data;

        // Overflow guard
        if (pcmSize + frame.byteLength > VOICE_MAX_PCM_BYTES) {
          const excess = pcmSize + frame.byteLength - VOICE_MAX_PCM_BYTES;
          if (excess >= pcmSize) {
            pcmBuffer = new Uint8Array(0);
            pcmSize = 0;
          } else {
            const trimmed = pcmBuffer.subarray(excess);
            pcmBuffer = new Uint8Array(trimmed.length + frame.byteLength);
            pcmBuffer.set(trimmed);
            pcmBuffer.set(frame, trimmed.length);
            pcmSize = VOICE_MAX_PCM_BYTES;
          }
        } else {
          const old = pcmBuffer;
          pcmBuffer = new Uint8Array(pcmSize + frame.byteLength);
          pcmBuffer.set(old);
          pcmBuffer.set(frame, pcmSize);
          pcmSize += frame.byteLength;
        }

        // A binary frame means "here are some audio bytes" — NOT "the user is
        // speaking". The client does its own voice-activity detection and
        // reports it in `vad` messages, which are the single authority. Driving
        // the state machine from here would assert speech during silence (the
        // client streams PCM continuously) AND would mix Date.now() epoch
        // milliseconds into a clock the client keeps in performance.now().
        return;
      }

      // Text frames — JSON
      if (!helloDone) {
        console.log("[ws] text frame before hello — dropping");
        return;
      }

      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        console.log("[ws] malformed JSON — ignoring");
        return;
      }

      if (typeof msg !== "object" || !msg.type) {
        console.log("[ws] text frame missing type — ignoring");
        return;
      }

      const type = msg.type;

      if (type === "hello") {
        sendJSON(ws, { type: "ready" });
        helloDone = true;
        return;
      }

      if (type === "vad") {
        // No Date.now() fallback: the client's clock is performance.now(), and
        // substituting epoch milliseconds would poison every duration the state
        // machine computes. A malformed frame is dropped instead.
        if (!Number.isFinite(msg.atMs)) {
          console.log("[ws] vad message missing or invalid atMs — ignoring");
          return;
        }
        const speaking = !!msg.speaking;
        const atMs = msg.atMs;
        const effects = session.onUserAudio(speaking, atMs);
        handleEffects(effects);
        return;
      }

      if (type === "bye") {
        if (processing && llmAbort) {
          llmAbort.abort();
          llmAbort = null;
        }
        if (pcmSize > 0 && !processing) {
          const buf = pcmBuffer;
          pcmBuffer = new Uint8Array(0);
          pcmSize = 0;

          llmAbort = new AbortController();
          processing = true;

          processUtterance(ws, session, buf, llmAbort).then(() => {
            processing = false;
            llmAbort = null;
          });
        }
        return;
      }

      console.log(`[ws] unknown message type "${type}" — ignoring`);
    } catch (err) {
      console.log(`[ws] error processing message: ${err.message}`);
    }
  });

  ws.on("close", () => {
    if (llmAbort) llmAbort.abort();
    session.reset();
  });

  ws.on("error", (err) => {
    console.log(`[ws] connection error: ${err.message}`);
  });
});
