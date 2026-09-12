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
import { emailConfigured, sendMail } from "@/lib/email";
import { kvGet, kvSet, storeConfigured } from "@/lib/store";
import { existsSync, readFileSync } from "fs";

let started = false;

/**
 * Deliver an alert to a human.
 *
 * Email, because it is the one channel that does not depend on the thing being
 * alerted about still working. It never throws: the notifier treats a failed
 * send as un-sent and will retry, which is only correct if the failure gets
 * back to it rather than being swallowed here.
 */
async function sendAlert(message: { subject: string; text: string }): Promise<void> {
  const to = (process.env.MIRA_ALERT_EMAIL || "").trim();
  if (!to) throw new Error("MIRA_ALERT_EMAIL is not set");
  if (!emailConfigured()) throw new Error("SMTP is not configured");
  // Plain text in both slots on purpose: an alert is read on a phone at 3am and
  // has nothing to gain from markup.
  await sendMail(to, message.subject, `<pre>${message.text}</pre>`, message.text);
}

/**
 * Is there anywhere for an alert to actually go?
 *
 * A transport with no destination is worse than no transport: the runtime
 * would report alerting as configured while every message failed, which is the
 * same lie as a monitor that is quietly doing nothing. So the transport is
 * only supplied when it can genuinely deliver, and its absence is reported as
 * absence.
 */
export function alertTransportReady(): boolean {
  return (process.env.MIRA_ALERT_EMAIL || "").trim().length > 0 && emailConfigured();
}

/**
 * The store, as something the reliability probe can interrogate.
 *
 * `durable` deliberately reads the FILE FROM DISK rather than going through
 * kvGet. That is the entire point: store.ts persists inside a try/catch that
 * only logs, so when the disk is full or permissions break, every write still
 * succeeds in memory and kvGet keeps answering correctly — while nothing is
 * actually being kept. Reading the file back is the only way to tell the
 * difference between a working store and one that is silently discarding
 * every paid subscription, session and binding it is handed.
 */
const storeAdapter = {
  configured: () => storeConfigured(),
  tier: () => {
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) return "upstash";
    if (process.env.MIRA_STORE_FILE) return "file";
    return "memory";
  },
  write: (key: string, value: unknown, ttlSeconds?: number) => kvSet(key, value, ttlSeconds),
  read: (key: string) => kvGet<string>(key),
  durable: async (key: string): Promise<boolean> => {
    // On Upstash the read already went to the remote store, so a successful
    // read-back IS the durability proof.
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) return true;

    const file = (process.env.MIRA_STORE_FILE || "").trim();
    if (!file) return false;
    try {
      if (!existsSync(file)) return false;
      // Key presence only. The file holds customer records and none of its
      // values are read, compared or returned.
      return Object.prototype.hasOwnProperty.call(
        JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>,
        key,
      );
    } catch {
      // Unreadable is not durable. Claiming otherwise would be the exact
      // optimism this probe exists to remove.
      return false;
    }
  },
};

/** The process-wide runtime, polling. Safe to call on every request. */
export function reliability() {
  const runtime = getRuntime({
    env: process.env,
    sendAlert: alertTransportReady() ? sendAlert : null,
    storeAdapter,
  });
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
