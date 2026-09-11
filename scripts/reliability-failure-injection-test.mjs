// Assistant reliability — FAILURE INJECTION.
//
// Every other test in this set checks one module. This one wires the REAL
// probes, the REAL state machine, the REAL poller, the REAL router and the
// REAL incident log together and then breaks things on purpose, because the
// four-day outage was not caused by any single component being wrong. Each
// piece did what it was told. Nobody had checked what they did together.
//
// Only two things are fake: fetch and the clock.

import test from "node:test";
import assert from "node:assert/strict";
import { createRuntime } from "../ops/reliability/runtime.mjs";
import { shouldAttemptRecovery, chooseProvider } from "../ops/reliability/router.mjs";

const ENV = {
  MIRA_SELF_URL: "http://127.0.0.1:3021",
  MIRA_LLM_BASE_URL: "http://pod:8000/v1",
  MIRA_LLM_MODEL: "forge-ai",
  MIRA_WHATSAPP_HEALTH_URL: "http://127.0.0.1:8790/healthz",
  OPENROUTER_API_KEY: "sk-test",
};

/** A world whose responses the test rewrites at will. */
function world(env = ENV) {
  const lines = [];
  let now = 0;
  // Default: everything answers correctly.
  let responder = () => ({ status: 200, body: JSON.stringify({ reply: "hello", trialGate: false }) });

  const rt = createRuntime({
    env,
    logPath: "data/injection.jsonl",
    io: {
      appendLine: async (_p, line) => {
        lines.push(line);
      },
      readLines: async () => [...lines],
      replaceAll: async (_p, next) => {
        lines.length = 0;
        lines.push(...next);
      },
    },
    clock: () => now,
    setTimer: () => 0,
    clearTimer: () => {},
    fetchImpl: async (url) => {
      const r = responder(String(url));
      if (r instanceof Error) throw r;
      return { status: r.status, text: async () => r.body };
    },
  });

  return {
    rt,
    lines,
    respond: (fn) => {
      responder = fn;
    },
    advance: (ms) => {
      now += ms;
    },
    at: () => now,
  };
}

const OK_ASSISTANT = JSON.stringify({ reply: "Mira can do that for you.", trialGate: false });
const OK_INFERENCE = JSON.stringify({ choices: [{ message: { content: "OK" } }] });
const OK_WHATSAPP = JSON.stringify({ ok: true, linked: 2, total: 2, pending: 0, stale: 0 });

/** Everything healthy. */
function healthy(url) {
  if (url.includes("8790")) return { status: 200, body: OK_WHATSAPP };
  if (url.includes("chat/completions")) return { status: 200, body: OK_INFERENCE };
  return { status: 200, body: OK_ASSISTANT };
}

async function pollAll(w, times = 1) {
  for (let i = 0; i < times; i++) {
    for (const s of w.rt.services) await w.rt.pollOnce(s.name);
    w.advance(1000);
  }
}

/* ── the outage that actually happened ─────────────────────────────────── */

test("INJECT: the gateway is alive and every customer is disconnected", async () => {
  const w = world();
  w.respond((url) =>
    url.includes("8790")
      ? // A 200. The process is up. The port answers. Nobody is connected.
        { status: 200, body: JSON.stringify({ ok: true, linked: 0, total: 3, pending: 3, stale: 0 }) }
      : healthy(url),
  );

  await pollAll(w);
  const snap = w.rt.snapshot();
  assert.equal(
    snap.whatsapp.state,
    "DEGRADED",
    "THIS IS THE FOUR-DAY OUTAGE. A liveness check that trusted the 200 reported this as healthy for four days",
  );
  assert.equal(snap.whatsapp.lastError, "no linked devices", "and it names the real condition");
  assert.equal(snap.assistant.state, "RECOVERING", "the healthy services are unaffected");
});

test("INJECT: the gateway signals unhealth with a 503 and the body still counts", async () => {
  const w = world();
  w.respond((url) =>
    url.includes("8790")
      ? { status: 503, body: JSON.stringify({ ok: false, linked: 0, total: 3, pending: 3, stale: 0 }) }
      : healthy(url),
  );

  await pollAll(w);
  const t = w.rt.snapshot().whatsapp;
  assert.equal(t.state, "DEGRADED", "the outage is caught");
  assert.equal(
    t.lastError,
    "no linked devices",
    "treating a non-200 as merely unreachable would have thrown away the count that identified the outage",
  );
});

/* ── things that return 200 and are still broken ───────────────────────── */

test("INJECT: the assistant returns 200 with an empty reply", async () => {
  const w = world();
  w.respond((url) =>
    url.includes("8790") || url.includes("chat/completions")
      ? healthy(url)
      : { status: 200, body: JSON.stringify({ reply: "", trialGate: false }) },
  );

  await pollAll(w);
  assert.equal(
    w.rt.snapshot().assistant.state,
    "DEGRADED",
    "A 200 IS NOT HEALTH. An assistant that answers with nothing is exactly what a customer complains about",
  );
});

test("INJECT: the assistant returns a 200 HTML error page", async () => {
  const w = world();
  w.respond((url) =>
    url.includes("8790") || url.includes("chat/completions")
      ? healthy(url)
      : { status: 200, body: "<html><body>502 Bad Gateway</body></html>" },
  );

  await pollAll(w);
  const t = w.rt.snapshot().assistant;
  assert.equal(t.state, "DEGRADED", "a proxy error page is not a reply");
  assert.equal(t.lastError, "empty reply", "and it is reported as the absence of an answer");
});

test("INJECT: inference returns a completion with no content", async () => {
  const w = world();
  w.respond((url) =>
    url.includes("chat/completions")
      ? { status: 200, body: JSON.stringify({ choices: [{ message: {} }] }) }
      : healthy(url),
  );

  await pollAll(w);
  assert.equal(w.rt.snapshot().inference.state, "DEGRADED", "an empty completion is not a working model");
});

test("INJECT: a timeout is reported as a timeout, not a mystery", async () => {
  const w = world();
  const abort = new Error("aborted");
  abort.name = "AbortError";
  w.respond((url) => (url.includes("8790") ? abort : healthy(url)));

  await pollAll(w);
  assert.equal(w.rt.snapshot().whatsapp.lastError, "timeout", "an operator needs to know it hung, not just that it failed");
});

test("INJECT: a connection refused never escapes the worker", async () => {
  const w = world();
  w.respond(() => new Error("ECONNREFUSED"));
  // The assertion is that this resolves at all: a throwing probe inside a
  // timer callback would be an unhandled rejection that kills the monitor.
  await pollAll(w);
  for (const name of ["assistant", "inference", "whatsapp"]) {
    assert.equal(w.rt.snapshot()[name].state, "DEGRADED", `${name} recorded the failure rather than crashing`);
  }
});

/* ── the whole chain: outage, failover, alert, incident, recovery ──────── */

test("INJECT: a full outage opens an incident, fails over, and closes on recovery", async () => {
  const w = world();
  w.respond((url) => (url.includes("8790") || url.includes("chat/completions") ? healthy(url) : new Error("down")));

  // Three failures with a fallback available is the failover threshold.
  await pollAll(w, 3);
  const failed = w.rt.snapshot().assistant;
  assert.ok(
    failed.state === "FAILOVER_ACTIVE" || failed.state === "OFFLINE",
    `three failures must escalate past DEGRADED, got ${failed.state}`,
  );
  assert.ok(failed.incidentId, "an incident is opened and given an id");

  const alerts = w.rt.recentAlerts();
  assert.ok(alerts.length > 0, "A DEVELOPER IS TOLD. Nobody should learn this from a customer");
  assert.ok(alerts.some((a) => a.service === "assistant"), "and told which service");

  // The router moves traffic off the broken primary.
  const route = chooseProvider({ state: failed.state, providers: w.rt.providers });
  assert.notEqual(route.target, "primary", "traffic leaves the broken provider");
  assert.ok(route.userNotice, "and the customer is given something honest to read");

  // Now it comes back. Past the cooldown, and three successes to clear.
  w.advance(120000);
  w.respond(healthy);
  await pollAll(w, 4);

  const recovered = w.rt.snapshot().assistant;
  assert.equal(recovered.state, "HEALTHY", "the service returns to healthy");
  assert.equal(recovered.incidentId, null, "and the incident is no longer current");

  const incidents = await w.rt.incidents(10);
  const incident = incidents.find((i) => i.incidentId === failed.incidentId);
  assert.ok(incident, "the incident is in the history");
  assert.equal(
    incident.resolved,
    true,
    "THE INCIDENT CLOSES. An incident history where nothing ever resolves cannot tell you how long anything lasted",
  );
  assert.ok(incident.durationMs > 0, "and it has a real duration");
  assert.equal(incident.service, "assistant", "attributed to the right service");
});

/* ── anti-oscillation ──────────────────────────────────────────────────── */

test("INJECT: a flapping service does not flap the customer experience", async () => {
  const w = world();
  let up = false;
  w.respond((url) => {
    if (url.includes("8790") || url.includes("chat/completions")) return healthy(url);
    up = !up;
    return up ? { status: 200, body: OK_ASSISTANT } : new Error("down");
  });

  await pollAll(w, 10);

  const notices = new Set();
  for (let i = 0; i < 5; i++) {
    await w.rt.pollOnce("assistant");
    notices.add(chooseProvider({ state: w.rt.snapshot().assistant.state, providers: w.rt.providers }).userNotice);
  }
  assert.ok(
    notices.size <= 2,
    `a service alternating up and down produced ${notices.size} different customer messages; hysteresis exists so a visitor is not told a new story every few seconds`,
  );
});

test("INJECT: one lucky probe does not declare victory", async () => {
  const w = world();
  w.respond((url) => (url.includes("8790") || url.includes("chat/completions") ? healthy(url) : new Error("down")));
  await pollAll(w, 5);
  assert.equal(w.rt.snapshot().assistant.state, "OFFLINE", "five failures with no fallback is offline");

  w.advance(120000);
  w.respond(healthy);
  await w.rt.pollOnce("assistant");
  assert.equal(
    w.rt.snapshot().assistant.state,
    "RECOVERING",
    "a single success after an outage is a hint, not a recovery",
  );
});

/* ── bounded recovery under a permanently dead provider ────────────────── */

test("INJECT: a provider that never comes back stops being retried forever", async () => {
  let tracker = { state: "OFFLINE", recoveryAttempts: 0, lastFailureAt: 0, incidentId: "inc_dead" };
  let now = 0;
  let attempts = 0;

  // Simulate the recovery loop against a provider that is never coming back.
  for (let i = 0; i < 50; i++) {
    const verdict = shouldAttemptRecovery(tracker, undefined, now);
    if (verdict.attempt) {
      attempts++;
      tracker = { ...tracker, recoveryAttempts: tracker.recoveryAttempts + 1, lastFailureAt: now };
    }
    now += 60 * 60 * 1000; // an hour between ticks, so backoff is never the limit
  }

  assert.equal(
    attempts,
    6,
    "RECOVERY IS BOUNDED. Retrying a dead provider forever burns money on the paid fallback and hides the fault behind a self-healing illusion that never heals",
  );
  const final = shouldAttemptRecovery(tracker, undefined, now);
  assert.equal(final.attempt, false, "it has given up");
  assert.ok(final.reason.toLowerCase().includes("human"), "and says so in the words an operator needs");
});

/* ── the log survives the things that break logs ───────────────────────── */

test("INJECT: a disk that refuses writes does not stop the monitor", async () => {
  const rt = createRuntime({
    env: ENV,
    logPath: "data/injection.jsonl",
    io: {
      appendLine: async () => {
        throw new Error("ENOSPC: no space left on device");
      },
      readLines: async () => [],
      replaceAll: async () => {},
    },
    clock: () => 0,
    setTimer: () => 0,
    clearTimer: () => {},
    fetchImpl: async () => {
      throw new Error("down");
    },
  });

  // Every transition here tries to write and every write fails.
  for (let i = 0; i < 3; i++) await rt.pollOnce("assistant");

  assert.equal(
    rt.snapshot().assistant.state,
    "OFFLINE",
    "the state machine escalated all the way through a failing disk; a full disk must not blind the monitor as well",
  );
  assert.ok(rt.recentAlerts().length > 0, "and alerts still reached memory even though none reached disk");
});

test("INJECT: a corrupt history still reads", async () => {
  const lines = ['{"id":"a","atMs":1,"service":"assistant","incidentId":"inc_1","to":"OFFLINE"}', "{tor"];
  const rt = createRuntime({
    env: ENV,
    logPath: "data/injection.jsonl",
    io: {
      appendLine: async (_p, l) => lines.push(l),
      readLines: async () => [...lines],
      replaceAll: async () => {},
    },
    clock: () => 0,
    setTimer: () => 0,
    clearTimer: () => {},
    fetchImpl: async () => {
      throw new Error("down");
    },
  });

  const incidents = await rt.incidents(10);
  assert.equal(incidents.length, 1, "the readable incident survives the torn line");
  assert.equal(incidents[0].incidentId, "inc_1", "and it is the right one");
});
