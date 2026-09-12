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

/** The process-wide runtime, polling. Safe to call on every request. */
export function reliability() {
  const runtime = getRuntime({ env: process.env, sendAlert });
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
