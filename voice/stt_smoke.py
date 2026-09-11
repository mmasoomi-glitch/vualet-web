#!/usr/bin/env python3
"""Smoke test for stt_server.py — no microphone or audio file needed.

Synthesises ~2 s of a 440 Hz sine tone at 16 kHz as raw int16 PCM,
posts it to the running server, and asserts the response structure.
"""

import json
import math
import os
import struct
import sys
import time
import urllib.request
import urllib.error

# ---------------------------------------------------------------------------
# Config (must match server defaults)
# ---------------------------------------------------------------------------
BASE_URL = f"http://{os.environ.get('STT_HOST', '127.0.0.1')}:{os.environ.get('STT_PORT', '8801')}"
DURATION_S = 2.0
SAMPLE_RATE = 16000
FREQ_HZ = 440  # musical A4


def build_pcm() -> bytes:
    """Return a 2-second, 16 kHz, mono, 16-bit PCM byte stream (sine tone)."""
    n_samples = int(SAMPLE_RATE * DURATION_S)
    buf = bytearray()
    for i in range(n_samples):
        sample = int(0.5 * 32767 * math.sin(2.0 * math.pi * FREQ_HZ * i / SAMPLE_RATE))
        buf += struct.pack("<h", sample)  # little-endian signed 16-bit
    return bytes(buf)


def main() -> int:
    # Allow override of server URL
    global BASE_URL
    BASE_URL = os.environ.get("STT_SERVER_URL", BASE_URL)

    pcm = build_pcm()
    url = f"{BASE_URL}/transcribe"

    print(f"[smoke] POST {url}  ({len(pcm)} bytes, {DURATION_S:.1f}s tone)", flush=True)

    try:
        req = urllib.request.Request(
            url,
            data=pcm,
            headers={"Content-Type": "application/octet-stream"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            status = resp.status
            body_raw = resp.read()
    except urllib.error.HTTPError as exc:
        print(f"[smoke] HTTP {exc.code}: {exc.read().decode()}", flush=True)
        return 1
    except OSError as exc:
        print(f"[smoke] Network error: {exc}", flush=True)
        return 1

    # --- assertions --------------------------------------------------------
    ok = 0
    fail = 0

    # 1. HTTP 200
    if status == 200:
        print("PASS  HTTP 200", flush=True)
    else:
        print(f"FAIL  expected HTTP 200, got {status}", flush=True)
        fail += 1
        return fail

    # 2. Valid JSON
    try:
        result = json.loads(body_raw)
    except json.JSONDecodeError as exc:
        print(f"FAIL  not valid JSON: {exc}", flush=True)
        return 1

    # 3. Required keys
    for key in ("text", "durationMs", "rtf"):
        if key in result:
            print(f"PASS  key '{key}' present = {result[key]!r}", flush=True)
        else:
            print(f"FAIL  missing key '{key}'", flush=True)
            fail += 1

    # 4. durationMs within 10% of 2000
    if "durationMs" in result:
        dm = result["durationMs"]
        if abs(dm - 2000) <= 200:
            print(f"PASS  durationMs={dm} within 10% of 2000", flush=True)
        else:
            print(f"FAIL  durationMs={dm} NOT within 10% of 2000", flush=True)
            fail += 1

    # 5. Print measured RTF
    if "rtf" in result:
        print(f"\n  =====  Measured RTF: {result['rtf']:.4f}  =====", flush=True)
        print("      RTF < 1.0 means transcription faster than real time.", flush=True)
    else:
        print("\n  =====  RTF not available =====", flush=True)
        fail += 1

    return fail


if __name__ == "__main__":
    import os
    sys.exit(main())
