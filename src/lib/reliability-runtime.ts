/**
 * The web process's handle on the reliability runtime.
 *
 * The runtime itself lives in ops/reliability and is deliberately free of
 * Next, of process.env and of the filesystem. This file is the only place that
 * binds it to the running server: it reads the real environment, keeps ONE
 * instance per process, and starts the poller the first time anybody asks.
 *
 * Polling starts lazily rather than at module load. Next evaluates modules
 * during the build, and a build that opens sockets and writes an incident log
 * is a build that fails on a machine where the services are not reachable.
 */

import { getRuntime } from "../../ops/reliability/runtime.mjs";

let started = false;

/** The process-wide runtime, polling. Safe to call on every request. */
export function reliability() {
  const runtime = getRuntime({ env: process.env });
  if (!started) {
    started = true;
    // start() is idempotent, but the flag keeps a hot path from re-entering it.
    runtime.start();
  }
  return runtime;
}

/** The runtime WITHOUT starting it — for reads that must not begin polling. */
export function reliabilityIdle() {
  return getRuntime({ env: process.env });
}
