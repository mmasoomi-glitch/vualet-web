# Mira Voice Gateway

A Node.js WebSocket sidecar service for Mira's full-duplex voice pipeline. It sits between the browser client and the voice back-end (STT, LLM, TTS), managing the conversation state machine and streaming audio in both directions.

## How it works

The gateway maintains a per-connection state machine (`DuplexSession`) that transitions between four states:

| State | Meaning |
|-------|---------|
| `idle` | Waiting for user to speak |
| `listening` | Recording user audio, tracking voice activity |
| `thinking` | Sent transcript to STT, waiting for LLM |
| `speaking` | Streaming LLM tokens and TTS audio to the client |

When the user interrupts (speaks) while the assistant is speaking, a **barge-in** is detected: the in-flight LLM and TTS requests are aborted immediately, and the gateway transitions back to `listening`.

## Wire protocol

All communication is over WebSocket. The server is bound to loopback by default — nginx (or another reverse proxy) handles the external connection.

### Client → Server, TEXT frames (JSON)

Each TEXT frame is a JSON object with a `type` field.

| Type | Fields | Meaning |
|------|--------|---------|
| `hello` | — | Start of session. Server responds with `{type:"ready"}`. |
| `vad` | `speaking: bool`, `atMs: number` | Voice-activity frame. `atMs` is the client's monotonic clock in milliseconds. |
| `bye` | — | End of session / flush buffer. |

### Client → Server, BINARY frames

Raw 16-bit little-endian mono PCM at 16 kHz. Each binary frame is appended to the current utterance buffer. Only valid after a `hello` frame has been received.

### Server → Client, TEXT frames (JSON)

| Type | Fields | Meaning |
|------|--------|---------|
| `ready` | — | Sent once after `hello`. Session is active. |
| `transcript` | `text: string` | The transcribed user utterance. |
| `token` | `text: string` | A single streamed LLM token. |
| `cancel` | `reason: "barge-in"` | Stop playback immediately — user interrupted. |
| `done` | — | Assistant turn finished naturally. |
| `error` | `message: string` | An error occurred; session is still usable. |

### Server → Client, BINARY frames

`audio/mpeg` chunks of the TTS-spoken reply. Sent while the server is in `speaking` state.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VOICE_HOST` | `127.0.0.1` | Host to bind the WebSocket server to. Loopback by default — use a reverse proxy for external access. |
| `VOICE_PORT` | `8802` | Port to bind the WebSocket server to. |
| `VOICE_MAX_PCM_BYTES` | `10000000` | Maximum total buffered PCM bytes per utterance (10 MB). Excess is dropped to prevent memory runaway. |
| `STT_URL` | `http://127.0.0.1:8801/transcribe` | URL of the STT (speech-to-text) service. Expects raw PCM POST, returns `{text: string}`. |
| `TTS_URL` | `http://127.0.0.1:3000/api/veridian-voice` | URL of the TTS (text-to-speech) service. Expects JSON `{text}`, streams `audio/mpeg`. HTTP 204 is treated as success (client falls back to browser speech). |
| `MIRA_LLM_BASE_URL` | `http://127.0.0.1:8000` | Base URL for the LLM service. Appended with `/chat/completions`. |
| `MIRA_LLM_MODEL` | `meta-llama/Llama-3.1-8B-Instruct` | Model name sent in the LLM request. |
| `MIRA_LLM_API_KEY` | *(empty)* | OpenAI-compatible API key. When **empty**, no `Authorization` header is sent (required for self-hosted vLLM). When **set**, `Bearer <key>` is sent. |

## Running

```bash
cd voice/gateway
npm install
npm start
```

The server logs a single line on startup:

```
Mira Voice Gateway listening on 127.0.0.1:8802
```

## Nginx configuration (example)

```nginx
location /voice/ {
    proxy_pass http://127.0.0.1:8802;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

## Testing

```bash
npm test
```

This runs `protocol-test.mjs` which tests the pure parsing and streaming logic **without any network or real WebSocket connections**.

## Latency

**No end-to-end latency has been measured for this service.** Unmeasured latency figures have not been published or implied.
