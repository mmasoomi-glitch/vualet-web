"use client";

import { useState, useRef, useEffect } from "react";
import { DuplexSession } from "@/lib/duplex-session";

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ── pure helpers (tested in isolation, no browser needed) ─────────────────── */

/** Clamp a float32 sample to [-1, 1] and map it to signed 16-bit integer. */
export function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    out[i] = Math.max(-1, Math.min(1, v)) * 32767;
  }
  return out;
}

/** Mean-square energy of the signal (RMS-squared). */
export function rmsEnergy(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    sum += v * v;
  }
  return samples.length > 0 ? sum / samples.length : 0;
}

/** Downsample to 16 kHz by nearest-sample decimation.
 *  The index MUST be floored: browsers commonly run at 44100 Hz, giving a
 *  fractional ratio (44100/16000 = 2.75625). A fractional index into a
 *  Float32Array is `undefined`, which `?? 0` would turn into pure silence. */
export function downsampleTo16k(
  data: Float32Array,
  inputRate: number,
): Float32Array {
  if (inputRate === 16000) return data; // pass-through when already 16 kHz
  const ratio = inputRate / 16000;
  const outLen = Math.floor(data.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    out[i] = data[Math.floor(i * ratio)] ?? 0;
  }
  return out;
}

/** Build the same-origin WebSocket URL from the current location. */
export function resolveVoiceUrl(loc: { protocol: string; host: string }): string {
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${loc.host}/voice`;
}

/* ── types ─────────────────────────────────────────────────────────────────── */

export type DuplexVoiceStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export interface DuplexVoiceOptions {
  url?: string;
  energyThreshold?: number;
  bargeInMs?: number;
}

export interface UseDuplexVoiceReturn {
  status: DuplexVoiceStatus;
  transcript: string;
  reply: string;
  error: string | null;
  start(): Promise<void>;
  stop(): void;
  isSupported: boolean;
}

/* ── worklet source ────────────────────────────────────────────────────────── */

/**
 * Minimal worklet that forwards raw Float32 audio frames to the main thread.
 * Built as a Blob URL so no extra public asset is required.
 */
function buildWorkletUrl(): string {
  const src = `
    class Forwarder extends AudioWorkletProcessor {
      process(inputs) {
        const input = inputs[0];
        if (input && input.length > 0) {
          this.port.postMessage({
            message: "audio",
            data: new Float32Array(input[0]),
          });
        }
        return true;
      }
    }
    registerProcessor("forwarder", Forwarder);
  `;
  const blob = new Blob([src], { type: "application/javascript" });
  return URL.createObjectURL(blob);
}

/* ── hook ──────────────────────────────────────────────────────────────────── */

export function useDuplexVoice(
  opts?: DuplexVoiceOptions,
): UseDuplexVoiceReturn {
  // ── runtime support check ───────────────────────────────────────────────
  // Echo cancellation is NOT optional here — without it the microphone hears
  // Mira's own voice through the speakers and the barge-in detector fires
  // on her, interrupting her constantly.
  const isSupported = (() => {
    if (typeof window === "undefined") return false;
    if (!window.AudioWorklet) return false;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia)
      return false;
    if (typeof WebSocket === "undefined") return false;
    return true;
  })();

  // ── state ───────────────────────────────────────────────────────────────
  const [status, setStatus] = useState<DuplexVoiceStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);

  // ── mutable refs (avoids stale closures in event handlers) ──────────────
  const duplexRef = useRef<DuplexSession | null>(null);       // barge-in FSM
  const wsRef = useRef<WebSocket | null>(null);
  const acRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const mediaSrcRef = useRef<MediaSource | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const queueRef = useRef<Uint8Array[]>([]);
  const playRef = useRef(false);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const activeRef = useRef(false);
  const stoppedRef = useRef(false);
  const turnRef = useRef(0);
  const workletUrlRef = useRef<string | null>(null);

  // ── clean up everything ────────────────────────────────────────────────
  function close() {
    try {
      if (activeRef.current) {
        activeRef.current = false;
        stoppedRef.current = false;
      }
    } catch {
      /* best-effort */
    }

    // Drain and discard queued audio for this turn
    queueRef.current = [];

    if (mediaSrcRef.current) {
      try {
        const ms = mediaSrcRef.current;
        if (ms.readyState === "open") ms.endOfStream();
      } catch {
        /* ignore — source may already be closed */
      }
      mediaSrcRef.current = null;
    }

    // Revoke the worklet Blob URL once on teardown
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    // Stop playback
    if (audioElRef.current) {
      try {
        audioElRef.current.pause();
        audioElRef.current.removeAttribute("src");
        audioElRef.current.load();
      } catch {
        /* ignore */
      }
      audioElRef.current = null;
      playRef.current = false;
    }

    // Close tracks
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      }
      streamRef.current = null;
    }

    // Close audio graph
    if (acRef.current) {
      acRef.current.close().catch(() => {
        /* ignore */
      });
      acRef.current = null;
    }

    // Disconnect worklet
    try {
      nodeRef.current?.disconnect();
      nodeRef.current = null;
    } catch {
      /* ignore */
    }

    // Close WebSocket
    if (wsRef.current) {
      try {
        wsRef.current.send(JSON.stringify({ type: "bye" }));
      } catch {
        /* socket may already be closing */
      }
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    // Stop duplex session
    const d = duplexRef.current;
    if (d) {
      d.reset();
      duplexRef.current = null;
    }
  }

  // ── start ───────────────────────────────────────────────────────────────
  async function start() {
    if (activeRef.current) return; // idempotent
    if (!isSupported) {
      setError("Voice is not supported in this browser");
      setStatus("error");
      return;
    }

    close();

    const d = new DuplexSession({
      bargeInMs: opts?.bargeInMs ?? 120,
      silenceMs: 700,
      minSpeechMs: 150,
    });
    duplexRef.current = d;

    const url = opts?.url ?? resolveVoiceUrl(window.location);
    let ws: WebSocket | null = null;

    activeRef.current = true;
    stoppedRef.current = false;

    try {
      setStatus("connecting");
      setError(null);

      // ── WebSocket ───────────────────────────────────────────────────
      ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        ws!.onopen = () => {
          if (!activeRef.current) {
            reject(new Error("Stopped during connect"));
            return;
          }
          ws!.send(JSON.stringify({ type: "hello" }));
          resolve();
        };
        ws!.onerror = () => {
          reject(new Error("WebSocket connection failed"));
        };
        ws!.onclose = (ev: CloseEvent) => {
          if (!activeRef.current) {
            reject(new Error("Stopped during connect"));
          } else {
            reject(new Error("Connection closed before ready"));
          }
        };
      });

      // ── message handler (set after successful connection) ───────────
      ws!.onmessage = async (ev: MessageEvent) => {
        if (!activeRef.current) return;
        if (stoppedRef.current) return;

        if (typeof ev.data === "string") {
          let msg: any;
          try {
            msg = JSON.parse(ev.data);
          } catch {
            return; // ignore non-JSON text
          }

          switch (msg.type) {
            case "ready": {
              // Server is ready; status will be set by VAD logic
              break;
            }

            case "transcript": {
              if (msg.text) {
                setTranscript(msg.text);
              }
              break;
            }

            case "token": {
              if (msg.text) {
                const effects = d.onAssistantToken(msg.text, performance.now());
                for (const e of effects) {
                  if (e.type === "emitToken") {
                    setReply((prev: string) => prev + e.text);
                  }
                }
              }
              break;
            }

            case "cancel": {
              // Idempotent barge-in cancel from the server — also stops
              // local playback so the client doesn't wait for the audio
              // to finish.
              try {
                if (audioElRef.current) audioElRef.current.pause();
              } catch {
                /* ignore */
              }
              playRef.current = false;
              break;
            }

            case "done": {
              d.onAssistantDone(0);
              setStatus("idle");
              setReply("");
              setTranscript("");
              break;
            }

            case "error": {
              if (msg.message) {
                setError(msg.message);
                setStatus("error");
                close();
              }
              break;
            }
          }
          return;
        }

        // ── binary: audio/mpeg chunks ─────────────────────────────────
        if (ev.data instanceof ArrayBuffer || ev.data instanceof Blob) {
          const buf = ev.data instanceof ArrayBuffer
            ? new Uint8Array(ev.data)
            : new Uint8Array(await new Response(ev.data).arrayBuffer());
          const tId = turnRef.current; // snapshot current turn

          // Only enqueue chunks for the current turn (discard stale)
          if (activeRef.current && !stoppedRef.current && tId === turnRef.current) {
            queueRef.current.push(buf);
            tryPlayCurrentTurn();
          }
        }
      };

      ws!.onclose = (ev: CloseEvent) => {
        if (!activeRef.current) return;
        if (!stoppedRef.current) {
          const reason = ev.code === 1006 ? "Connection lost" : "Disconnected";
          setStatus(reason === "Connection lost" ? "error" : "idle");
          if (reason === "Connection lost") setError(reason);
        }
      };

      ws!.onerror = () => {
        if (!activeRef.current) return;
        if (!stoppedRef.current) {
          setError("WebSocket error");
          setStatus("error");
        }
      };

      // ── Audio capture ───────────────────────────────────────────────
      // Echo cancellation is NOT optional — without it the mic hears Mira
      // through the speakers and the barge-in detector fires on her,
      // interrupting her constantly.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const sampleRate = 16000; // server expects 16 kHz PCM
      const ctx = new AudioContext({ sampleRate });
      acRef.current = ctx;

      // Safari ignores the sampleRate hint — verify at runtime
      const actualRate = ctx.sampleRate;
      let sourceNode: MediaStreamAudioSourceNode;
      let nextNode: AudioNode;

      if (actualRate !== sampleRate) {
        // Create a ScriptProcessorNode for resampling (the modern replacement,
        // AudioWorklet, is used for the main processing tap below).
        const resampler = ctx.createScriptProcessor(4096, 1, 1);
        const ratio = actualRate / sampleRate;

        resampler.onaudioprocess = (e: AudioProcessingEvent) => {
          const inBuf = e.inputBuffer.getChannelData(0);
          const outBuf = e.outputBuffer.getChannelData(0);
          for (let i = 0; i < outBuf.length; i++) {
            outBuf[i] = inBuf[Math.floor(i * ratio)] ?? 0;
          }
        };

        sourceNode = ctx.createMediaStreamSource(stream);
        sourceNode.connect(resampler);
        nextNode = resampler;
      } else {
        sourceNode = ctx.createMediaStreamSource(stream);
        nextNode = sourceNode;
      }

      // ── AudioWorkletNode for the main processing tap ────────────────
      let workletUrl: string;
      if (workletUrlRef.current) {
        workletUrl = workletUrlRef.current;
      } else {
        workletUrl = buildWorkletUrl();
        blobUrlRef.current = workletUrl;
        workletUrlRef.current = workletUrl;
      }

      await ctx.audioWorklet.addModule(workletUrl);
      const worklet = new AudioWorkletNode(ctx, "forwarder");
      nodeRef.current = worklet;

      worklet.port.onmessage = (ev: MessageEvent) => {
        if (!activeRef.current) return;

        if (ev.data?.message !== "audio") return;

        const frame = ev.data.data as Float32Array;

        // Downsample if the browser changed the rate mid-flight
        let pcm = frame;
        if (ctx.sampleRate !== 16000) {
          pcm = downsampleTo16k(frame, ctx.sampleRate);
        }

        // Convert to int16 PCM for transmission
        const int16 = floatToInt16(pcm);
        const binary = new Uint8Array(int16.buffer);

        // Send PCM binary frame over WebSocket
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(binary);
        }

        // ── VAD: detect speech locally ────────────────────────────────
        const thr = opts?.energyThreshold ?? 0.015;
        const energy = rmsEnergy(frame);
        const speaking = energy > thr;
        const now = performance.now(); // monotonic clock, never jumps

        const effects = d.onUserAudio(speaking, now);
        for (const e of effects) {
          if (e.type === "startListening") {
            setStatus("listening");
            setReply("");
          }
          if (e.type === "cancelGeneration" || e.type === "stopPlayback") {
            // LOCAL barge-in: stop playback immediately without waiting for
            // the server's cancel message — a network round trip is exactly
            // the delay that makes an assistant feel deaf.
            try {
              if (audioElRef.current) audioElRef.current.pause();
            } catch {
              /* ignore */
            }
            playRef.current = false;
          }
          if (e.type === "emitToken") {
            setReply((prev: string) => prev + e.text);
          }
        }

        // Send VAD text frame (one per frame while speaking or listening)
        if (speaking || d.state === "listening") {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(
              JSON.stringify({ type: "vad", speaking, atMs: now }),
            );
          }
        }

        // End turn when silence detected after speech ≥ minSpeechMs
        for (const e of effects) {
          if (e.type === "endTurn") {
            setStatus("thinking");
          }
        }
      };

      // Wire the graph: source → worklet → destination
      nextNode.connect(worklet);
      worklet.connect(ctx.destination);

      setStatus("listening");
    } catch (e: any) {
      // Never throw from here — surface via error state
      if (e?.name !== "AbortError" && e?.message !== "Stopped during connect" && e?.message !== "Connection closed before ready") {
        setError(e?.message ?? "Start failed");
        setStatus("error");
      }
      close();
    }
  }

  // ── stop ──────────────────────────────────────────────────────────────────
  function stop() {
    stoppedRef.current = true;

    // Stop playback and discard queued audio for this turn
    try {
      if (audioElRef.current) {
        audioElRef.current.pause();
        audioElRef.current.removeAttribute("src");
        audioElRef.current.load();
      }
    } catch {
      /* ignore */
    }
    playRef.current = false;
    queueRef.current = [];

    close();

    // Reset state for next session
    setStatus("idle");
    setReply("");
  }

  // ── play helper (MediaSource or Blob fallback) ───────────────────────────

  async function tryPlayCurrentTurn() {
    // Don't start new playback if already playing or if we've stopped
    if (playRef.current || !activeRef.current || stoppedRef.current) return;
    if (queueRef.current.length === 0) return;

    const chunks = queueRef.current;
    queueRef.current = []; // drain the queue
    turnRef.current++; // mark this turn; later chunks belong to a new turn

    try {
      await playAudioChunks(chunks);
    } catch {
      // Playback error — don't crash the hook
      playRef.current = false;
    }
  }

  async function playAudioChunks(chunks: Uint8Array[]) {
    // ── MediaSource path (preferred) for streaming playback ─────────────
    if (MediaSource.isTypeSupported("audio/mpeg")) {
      const ms = new MediaSource();
      mediaSrcRef.current = ms;

      const audio = document.createElement("audio");
      audio.volume = 1;
      audio.preload = "none";
      audio.src = URL.createObjectURL(ms);
      audioElRef.current = audio;

      const sourceBuffer = await new Promise<SourceBuffer>((resolve, reject) => {
        ms.onsourceopen = () => {
          try {
            const sb = ms.addSourceBuffer("audio/mpeg");
            resolve(sb);
          } catch {
            reject(new Error("Failed to add sourceBuffer"));
          }
        };
      });

      audio.onended = () => {
        playRef.current = false;
        audioElRef.current = null;
      };

      // Feed all chunks into the source buffer
      const blob = new Blob(chunks as BlobPart[], { type: "audio/mpeg" });
      const arrayBuf = await blob.arrayBuffer();
      sourceBuffer.appendBuffer(arrayBuf);

      playRef.current = true;
      await audio.play().catch(() => {
        // Autoplay blocked — don't error, just don't play
        playRef.current = false;
      });

      // End the media source after a reasonable window so playback stops
      setTimeout(() => {
        try {
          if (ms.readyState === "open") {
            ms.endOfStream();
          }
        } catch {
          /* ignore */
        }
      }, 5000);
      return;
    }

    // ── Blob fallback for browsers that don't support audio/mpeg ────────
    const blob = new Blob(chunks as BlobPart[], { type: "audio/mpeg" });
    const audio = document.createElement("audio");
    audio.src = URL.createObjectURL(blob);
    audioElRef.current = audio;

    audio.onended = () => {
      playRef.current = false;
      audioElRef.current = null;
      if (audio.src) URL.revokeObjectURL(audio.src);
    };

    playRef.current = true;
    await audio.play().catch(() => {
      playRef.current = false;
      audioElRef.current = null;
    });
  }

  // ── effect: start on mount if active ────────────────────────────────────

  useEffect(() => {
    // Start is idempotent and user-gesture gated by the caller.
    // We don't auto-start here; the caller invokes start() explicitly.
    return () => {
      close();
    };
  }, []);

  // ── return ───────────────────────────────────────────────────────────────
  return { status, transcript, reply, error, start, stop, isSupported };
}
