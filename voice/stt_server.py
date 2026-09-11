"""Streaming speech-to-text HTTP service using faster-whisper on CPU."""

import json
import logging
import math
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict

import numpy as np
from faster_whisper import WhisperModel

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
STT_MODEL: str = os.environ.get("STT_MODEL", "base.en")
STT_HOST: str = os.environ.get("STT_HOST", "127.0.0.1")
STT_PORT: int = int(os.environ.get("STT_PORT", "8801"))
STT_THREADS: int = int(os.environ.get("STT_THREADS", "8"))
STT_WORKERS: int = int(os.environ.get("STT_WORKERS", "2"))
STT_MAX_BYTES: int = int(os.environ.get("STT_MAX_BYTES", "10_000_000"))

# ---------------------------------------------------------------------------
# Model singleton — loaded once at import time so every worker reuses it
# ---------------------------------------------------------------------------
_model: WhisperModel | None = None
_model_loaded: bool = False


def _load_model() -> WhisperModel:
    """Load the Whisper model (called once in the main process)."""
    print(f"[stt] Loading model '{STT_MODEL}' on CPU with {STT_THREADS} threads...", flush=True)
    model = WhisperModel(
        STT_MODEL,
        device="cpu",
        compute_type="int8",
        cpu_threads=STT_THREADS,
        num_workers=STT_WORKERS,
    )
    print(f"[stt] Model loaded successfully.", flush=True)
    return model


# Eagerly load the model at import time so it is never in the request path.
try:
    _model = _load_model()
    _model_loaded = True
except Exception:
    print(f"[stt] WARNING: model failed to load — server will still start (health will report loaded=false).", flush=True)
    _model = None


# ---------------------------------------------------------------------------
# Request handler
# ---------------------------------------------------------------------------
class _STTHandler(BaseHTTPRequestHandler):
    """Handle one HTTP request per thread."""

    # Silence default stderr request logging — we log our own JSON responses.
    def log_message(self, fmt: str, *args: Any) -> None:  # type: ignore[override]
        sys.stderr.write(f"[stt] {fmt % args}\n")

    # -- helpers -------------------------------------------------------------

    def _json_response(self, status: int, body: Dict[str, Any]) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _read_bytes(self) -> bytes:
        length = int(self.headers.get("Content-Length", 0))
        return self.rfile.read(length)

    # -- GET -----------------------------------------------------------------

    def do_GET(self) -> None:
        if self.path == "/health":
            self._json_response(200, {
                "ok": True,
                "model": STT_MODEL,
                "device": "cpu",
                "loaded": _model_loaded,
            })
        else:
            self._json_response(404, {"error": "not found"})

    # -- POST ----------------------------------------------------------------

    def do_POST(self) -> None:
        if self.path != "/transcribe":
            self._json_response(404, {"error": "not found"})
            return

        try:
            raw = self._read_bytes()
        except Exception as exc:
            self._json_response(500, {"error": f"read failure: {exc}"})
            return

        if len(raw) == 0:
            self._json_response(400, {"error": "empty body"})
            return

        if len(raw) > STT_MAX_BYTES:
            self._json_response(413, {"error": f"body exceeds {STT_MAX_BYTES} bytes"})
            return

        try:
            result = self._transcribe(raw)
            self._json_response(200, result)
        except Exception as exc:
            import traceback
            traceback.print_exc(file=sys.stderr)
            self._json_response(500, {"error": str(exc)})

    # -- catch-all for other methods -----------------------------------------

    def do_PUT(self) -> None:
        self._json_response(404, {"error": "not found"})

    def do_DELETE(self) -> None:
        self._json_response(404, {"error": "not found"})

    def do_PATCH(self) -> None:
        self._json_response(404, {"error": "not found"})

    # -- transcription -------------------------------------------------------

    def _transcribe(self, raw_pcm: bytes) -> Dict[str, Any]:
        """Transcribe raw 16-bit PCM and return the result dict."""
        global _model_loaded

        if _model is None:
            raise RuntimeError("model not loaded at startup")

        # Convert int16 samples to float32 in [-1, 1].
        samples_int16 = np.frombuffer(raw_pcm, dtype=np.int16)
        audio = samples_int16.astype(np.float32) / 32768.0

        duration_ms = int(len(audio) / 16000 * 1000)

        start = time.time()
        segments, info = _model.transcribe(
            audio,
            beam_size=1,
            vad_filter=False,
        )
        wall_seconds = time.time() - start

        text = ""
        for seg in segments:
            text += seg.text
        text = text.strip()

        if duration_ms > 0:
            rtf = wall_seconds / (duration_ms / 1000.0)
        else:
            rtf = wall_seconds  # degenerate, but report something

        return {
            "text": text,
            "durationMs": duration_ms,
            "rtf": round(rtf, 4),
        }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    server = ThreadingHTTPServer((STT_HOST, STT_PORT), _STTHandler)
    print(f"[stt] Listening on {STT_HOST}:{STT_PORT}  model={STT_MODEL}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[stt] Shutting down.", flush=True)
        server.server_close()


if __name__ == "__main__":
    main()
