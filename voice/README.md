# Voice / Speech-to-Text Service

A standalone HTTP service for real-time speech-to-text transcription using
[faster-whisper](https://github.com/SYSTRAN/faster-whisper) running **exclusively on CPU**
(int8 quantisation).  No GPU usage.

## Quick start

### 1. Install dependencies

```bash
pip install -r voice/requirements.txt
```

### 2. Start the server

```bash
python3 voice/stt_server.py
```

By default the server binds to **127.0.0.1:8801** (loopback only — behind a
reverse proxy, no authentication).

### 3. Run the smoke test

In a separate terminal:

```bash
python3 voice/stt_smoke.py
```

The test synthesises a 2-second sine tone, POSTs it to the server, and verifies
the response structure and timing.

## Environment variables

| Variable         | Default        | Description                                                         |
|------------------|----------------|---------------------------------------------------------------------|
| `STT_MODEL`      | `base.en`      | Whisper model identifier (any CTranslate2-supported variant).       |
| `STT_HOST`       | `127.0.0.1`    | Bind address (loopback — not `0.0.0.0`).                            |
| `STT_PORT`       | `8801`         | Bind port.                                                          |
| `STT_THREADS`    | `8`            | Number of CPU threads for inference (`cpu_threads`).                |
| `STT_WORKERS`    | `2`            | Number of worker threads (`num_workers` in WhisperModel).           |
| `STT_MAX_BYTES`  | `10000000`     | Maximum POST body size (10 MB default).                             |

## API

### `GET /health`

Returns service status including whether the model is loaded:

```json
{
  "ok": true,
  "model": "base.en",
  "device": "cpu",
  "loaded": true
}
```

### `POST /transcribe`

- **Content-Type**: any (ignored; expects raw bytes).
- **Body**: raw 16-bit little-endian mono PCM at 16 kHz.
- **Response** (200):

```json
{
  "text": "transcribed text here",
  "durationMs": 2000,
  "rtf": 0.45
}
```

- `durationMs` — audio duration in milliseconds.
- `rtf` — real-time factor (processing wall seconds / audio seconds).
  **RTF below 1.0 means the transcription completed faster than real time.**
  The `0.45` above is an illustrative shape for the field, not a measurement.

- Error responses:
  - `400` — empty body.
  - `413` — body exceeds `STT_MAX_BYTES`.
  - `500` — internal error (with description in JSON body).
  - `404` — unknown endpoint.

## Latency note

> **The real-time factor printed by the smoke test is the ONLY latency figure
> measured so far. It is measured on a synthetic sine tone, not on real speech.
> No end-to-end latency number has been measured yet.**

Do not interpret the smoke test RTF as a production latency benchmark. Actual
latency with real audio may differ.
