# Voice pipeline — measured latency

**Measured 2026-09-11.** Every number here was produced by `voice/bench_e2e.py`
on this machine. Nothing in this file is estimated, extrapolated, or copied from
a vendor's marketing. If a figure is not in this file, it has not been measured
and must not be published.

## How it was measured

Real speech, not a synthetic tone. The benchmark:

1. Asks the production TTS endpoint (`https://mira.vualet.com/api/veridian-voice`,
   ElevenLabs) to speak a sentence, and downloads the mp3.
2. Decodes that mp3 to 16 kHz mono 16-bit PCM with `ffmpeg`.
3. POSTs the PCM to `voice/stt_server.py` (faster-whisper `base.en`, CPU, int8)
   and times the transcription.
4. Streams a completion from vLLM and stops the clock on the **first token
   carrying content**, read incrementally from the SSE stream.

Sentence spoken: *"Remind me what the client's cutoff date was, and whether I
agreed to the revised budget."*

## Hardware

RunPod pod, NVIDIA L40S. The GPU was **fully occupied** throughout by a vLLM
server holding `qwen3-coder` (42 GB of 46 GB used). Speech-to-text therefore ran
entirely on CPU — 256 cores, ~890 GB RAM free.

## Results — four consecutive runs

| Run | audio duration | STT | RTF | time to first token | STT + first token |
|-----|---------------:|----:|----:|--------------------:|------------------:|
| 1 | — | 535.9 ms | 0.0012 | 113.4 ms | **649.3 ms** |
| 2 | 4938.2 ms | 544.0 ms | 0.0012 | 100.9 ms | **644.9 ms** |
| 3 | 4755.4 ms | 561.5 ms | 0.0012 | 97.3 ms | **658.8 ms** |
| 4 | 4598.6 ms | 534.2 ms | 0.0012 | 111.5 ms | **645.7 ms** |

**Range: 644.9 – 658.8 ms.** Transcription of ~4.8 seconds of speech takes about
0.54 s on CPU — a real-time factor of 0.0012, so roughly 800× faster than real
time. Time to first token from the local vLLM is consistently around 100 ms.

Transcription accuracy on this sentence was effectively exact:

> "Remind me what the client's cut-off date was and whether I agreed to the
> revised budget."

## What this number is NOT

**644–659 ms is a lower bound, not the user's experience.** It excludes, in order:

- network time from the user's browser to the server, in both directions;
- microphone capture and frame buffering in the browser;
- **voice-activity endpointing delay** — the machine waits `silenceMs` (default
  700 ms) of silence before it decides the user has finished. On these settings
  that alone is larger than everything measured above;
- text-to-speech synthesis and the time until audio actually starts playing.

A realistic user-perceived figure will be materially higher. It has not been
measured, because the browser client is not yet wired to the gateway.

## Consequences worth recording

**The "under 180 ms" claim that was struck from `/mira/live` was right to be
struck.** The measured floor — on a 256-core machine, with the transcription
cost almost zero — is around 650 ms before any of the excluded costs. The
original number was not achievable and was never measured.

**`qwen3-coder` is the wrong model for spoken replies.** Asked the question
above, it began its answer:

> "Here's a thinking process: 1. **Analyze User Input:** …"

It leaked its reasoning scaffolding into text that would have been read aloud.
It is a coding model and behaves like one. It is fine for the development loop;
it should not be what a customer hears.

## Reproducing

```bash
python3 voice/stt_server.py &                  # wait for /health loaded:true
python3 voice/bench_e2e.py                     # uses the defaults above
```

Override `TTS_URL`, `STT_URL`, `MIRA_LLM_BASE_URL`, `MIRA_LLM_MODEL` and
`MIRA_LLM_API_KEY` as needed. Note that Cloudflare and the RunPod proxy both
reject urllib's default user-agent with a 403, which is why the script sends a
browser one.
