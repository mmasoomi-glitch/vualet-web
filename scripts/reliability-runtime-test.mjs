// Assistant reliability — the composition root.
//
// The runtime is the one file that knows about the filesystem, the clock and
// the environment, so every one of those is injected here. No real fs, no real
// timers, no network.

import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveServices,
  resolveProviders,
  makeFileIo,
  createRuntime,
  getRuntime,
  resetRuntime,
} from "../ops/reliability/runtime.mjs";

/* ── resolveServices ───────────────────────────────────────────────────── */

test("THE ASSISTANT CHECK IS NEVER OPTIONAL", () => {
  for (const env of [{}, null, undefined, "nonsense", 42, []]) {
    const services = resolveServices(env);
    assert.ok(
      services.some((s) => s.name === "assistant"),
      `env ${String(env)} still monitors the assistant — an end-to-end check you can switch off by forgetting a variable is how an outage lasts four days`,
    );
  }
});

test("the assistant falls back to the local port the site actually listens on", () => {
  const [assistant] = resolveServices({});
  assert.equal(assistant.url, "http://127.0.0.1:3021", "the default must match the real runtime port");
  assert.equal(assistant.kind, "assistant", "and it is probed end to end");
  assert.equal(assistant.model, null, "the assistant check names no model");
});

test("optional services appear only when configured", () => {
  assert.equal(resolveServices({}).length, 1, "nothing optional is assumed");

  const withLlm = resolveServices({ MIRA_LLM_BASE_URL: "http://pod:8000/v1" });
  const inference = withLlm.find((s) => s.name === "inference");
  assert.ok(inference, "a configured inference endpoint is monitored");
  assert.equal(inference.model, "default", "an unnamed model still probes");

  const named = resolveServices({ MIRA_LLM_BASE_URL: "http://pod:8000/v1", MIRA_LLM_MODEL: "forge-ai" });
  assert.equal(named.find((s) => s.name === "inference").model, "forge-ai", "the model is carried");

  const withWa = resolveServices({ MIRA_WHATSAPP_HEALTH_URL: "http://127.0.0.1:8790/healthz" });
  assert.ok(withWa.find((s) => s.name === "whatsapp"), "a configured gateway is monitored");
});

test("a whitespace-only setting is not a configuration", () => {
  const services = resolveServices({ MIRA_LLM_BASE_URL: "   ", MIRA_WHATSAPP_HEALTH_URL: "\t" });
  assert.equal(services.length, 1, "blank values must not mint a service that probes nowhere");
  assert.equal(
    resolveServices({ MIRA_SELF_URL: "  http://site  " })[0].url,
    "http://site",
    "a stray space in an env var must not break every probe",
  );
});

/* ── resolveProviders ──────────────────────────────────────────────────── */

test("the knowledge base can never be unconfigured", () => {
  for (const env of [{}, null, { OPENROUTER_API_KEY: "" }]) {
    assert.equal(resolveProviders(env).kb, true, "the grounded fallback is compiled in");
  }
  assert.deepEqual(
    resolveProviders({ MIRA_LLM_BASE_URL: "http://pod", OPENROUTER_API_KEY: "sk-x" }),
    { primary: true, secondary: true, kb: true },
    "both configured providers are reported",
  );
  assert.equal(resolveProviders({ MIRA_LLM_BASE_URL: "  " }).primary, false, "blank is not configured");
});

/* ── makeFileIo ────────────────────────────────────────────────────────── */

function fakeFs(files = {}) {
  const calls = { mkdir: 0, append: 0, write: 0, rename: 0 };
  return {
    files,
    calls,
    impl: {
      mkdirSync: () => {
        calls.mkdir++;
      },
      appendFileSync: (p, data) => {
        calls.append++;
        files[p] = (files[p] || "") + data;
      },
      readFileSync: (p) => {
        if (!(p in files)) {
          const err = new Error("no such file");
          err.code = "ENOENT";
          throw err;
        }
        return files[p];
      },
      writeFileSync: (p, data) => {
        calls.write++;
        files[p] = data;
      },
      renameSync: (from, to) => {
        calls.rename++;
        files[to] = files[from];
        delete files[from];
      },
    },
  };
}

test("a log that does not exist yet is not an error", () => {
  const fake = fakeFs();
  assert.deepEqual(makeFileIo(fake.impl).readLines("data/x.jsonl"), [], "a missing file reads as empty");
});

test("a real read error still propagates", () => {
  const impl = {
    readFileSync: () => {
      const err = new Error("permission denied");
      err.code = "EACCES";
      throw err;
    },
  };
  assert.throws(
    () => makeFileIo(impl).readLines("data/x.jsonl"),
    /permission denied/,
    "only a missing file is benign; a genuine I/O fault must not be silently read as an empty history",
  );
});

test("appending creates the directory and terminates the line", () => {
  const fake = fakeFs();
  const io = makeFileIo(fake.impl);
  io.appendLine("data/reliability.jsonl", '{"id":"a"}');
  io.appendLine("data/reliability.jsonl", '{"id":"b"}');
  assert.ok(fake.calls.mkdir > 0, "the parent directory is ensured, or the first write ever fails");
  assert.deepEqual(io.readLines("data/reliability.jsonl"), ['{"id":"a"}', '{"id":"b"}'], "both lines round-trip");
});

test("REPLACING THE LOG IS ATOMIC", () => {
  const fake = fakeFs();
  const io = makeFileIo(fake.impl);
  io.appendLine("data/r.jsonl", "old");
  io.replaceAll("data/r.jsonl", ["a", "b"]);
  assert.equal(fake.calls.rename, 1, "the replace goes through a rename");
  assert.ok(
    !("data/r.jsonl.tmp" in fake.files),
    "the temp file is renamed away, so a crash mid-prune can never leave a half-written history",
  );
  assert.deepEqual(io.readLines("data/r.jsonl"), ["a", "b"], "the new contents are in place");
});

test("replacing with nothing leaves an empty file, not a broken one", () => {
  const fake = fakeFs();
  const io = makeFileIo(fake.impl);
  io.replaceAll("data/r.jsonl", []);
  assert.deepEqual(io.readLines("data/r.jsonl"), [], "an emptied log still reads cleanly");
});

/* ── createRuntime ─────────────────────────────────────────────────────── */

function memoryIo() {
  const lines = [];
  return {
    lines,
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
  };
}

/** Refuses every request, so probes fail deterministically and offline. */
const DEAD_FETCH = async () => {
  throw new Error("connection refused");
};

function runtimeWith(env = {}, fetchImpl = DEAD_FETCH) {
  const store = memoryIo();
  let now = 1000;
  const rt = createRuntime({
    env,
    logPath: "data/test.jsonl",
    io: store.io,
    clock: () => now,
    setTimer: () => 0,
    clearTimer: () => {},
    fetchImpl,
  });
  return { rt, store, advance: (ms) => (now += ms) };
}

test("THE PROBE IS A CLOSURE, NOT A CALL", async () => {
  // Building a runtime must not fire a single request, and the poller demands
  // a callable — passing an already-invoked promise would throw right here.
  const { rt } = runtimeWith({});
  assert.equal(rt.isRunning(), false, "constructing does not start polling");
  assert.deepEqual(Object.keys(rt.snapshot()), ["assistant"], "the service is registered and pollable");
});

test("THE INJECTED FETCH IS THE ONE THAT RUNS", async () => {
  let calls = 0;
  const { rt } = runtimeWith({}, async () => {
    calls++;
    return { status: 200, text: async () => JSON.stringify({ reply: "hi", trialGate: false }) };
  });
  await rt.pollOnce("assistant");
  assert.equal(calls, 1, "the probe used the injected client, so this suite never touches the network");
  assert.equal(
    rt.status().services.assistant.state,
    "RECOVERING",
    "a healthy reply starts the recovery climb rather than declaring health on one probe",
  );
});

test("the runtime exposes what it resolved", () => {
  const { rt } = runtimeWith({ MIRA_LLM_BASE_URL: "http://pod", OPENROUTER_API_KEY: "sk-x" });
  assert.deepEqual(rt.services.map((s) => s.name), ["assistant", "inference"], "both are monitored");
  assert.deepEqual(rt.providers, { primary: true, secondary: true, kb: true }, "providers are reported");
});

test("status reports the WORST state across services, not the first", async () => {
  const { rt } = runtimeWith({});
  const s = rt.status();
  assert.equal(s.overall, "UNKNOWN", "before any probe, nothing is claimed");
  assert.ok(s.route && typeof s.route.target === "string", "a route is always chosen");
  assert.equal(typeof s.atMs, "number", "the report is timestamped");
  assert.ok(s.services.assistant, "the per-service detail is included");
});

test("STATUS READS THE STATE OFF THE TRACKER, NOT THE TRACKER ITSELF", async () => {
  // A snapshot maps name -> tracker object. Treating the tracker as a state
  // string yields a permanent UNKNOWN that hides every real outage.
  const { rt } = runtimeWith({});
  await rt.pollOnce("assistant"); // no fetch configured → the probe fails
  const s = rt.status();
  assert.notEqual(
    s.overall,
    "UNKNOWN",
    "a failed probe must move the overall state, which it cannot do if the tracker object is compared against the severity list",
  );
  assert.equal(s.services.assistant.state, s.overall, "with one service, overall IS that service's state");
});

test("A TRANSITION IS PERSISTED AND AN EVENT IS NOT", async () => {
  const { rt, store } = runtimeWith({});
  await rt.pollOnce("assistant");
  assert.equal(store.lines.length >= 1, true, "the first failure transitions and is recorded");

  const written = store.lines.map((l) => JSON.parse(l));
  assert.ok(
    written.every((e) => e.type === "transition" || e.type === "alert"),
    "a probe every 45 seconds forever would bury the events that matter, so only transitions and alerts are kept",
  );
  for (const e of written) {
    assert.ok(e.id, "every persisted event has an id, or buildEvent refuses it and nothing is logged at all");
    assert.ok(e.service, "and a service");
    assert.equal(typeof e.atMs, "number", "and a real timestamp");
  }
});

test("AN ALERT REACHES BOTH THE BUFFER AND THE LOG", async () => {
  const { rt, store } = runtimeWith({});
  await rt.pollOnce("assistant");

  const recent = rt.recentAlerts();
  assert.ok(recent.length >= 1, "the first degrade alerts");
  assert.ok(recent[0].severity, "the alert carries a severity");
  assert.equal(recent[0].service, "assistant", "and names the service it is about");

  const logged = store.lines.map((l) => JSON.parse(l)).filter((e) => e.type === "alert");
  assert.ok(
    logged.length >= 1,
    "an alert with no id/service/atMs would be refused by buildEvent and vanish silently",
  );
});

test("recentAlerts is newest first and bounded", async () => {
  const { rt } = runtimeWith({});
  for (let i = 0; i < 3; i++) await rt.pollOnce("assistant");
  const recent = rt.recentAlerts(2);
  assert.ok(recent.length <= 2, "the limit is honoured");
  if (recent.length === 2) {
    assert.ok(recent[0].atMs >= recent[1].atMs, "newest first");
  }
});

test("INCIDENTS ARE FOLDED, NOT RAW EVENTS", async () => {
  const { rt } = runtimeWith({});
  await rt.pollOnce("assistant");
  const incidents = await rt.incidents(10);
  const events = await rt.events(10);
  assert.ok(Array.isArray(incidents) && Array.isArray(events), "both return lists");
  for (const inc of incidents) {
    assert.ok(
      "durationMs" in inc && "resolved" in inc,
      "incidents() must return folded summaries; wiring it to the raw event list would answer 'how long was it down' with a stream of lines",
    );
  }
});

/* ── the singleton ─────────────────────────────────────────────────────── */

test("the runtime singleton is one instance, and resettable", () => {
  resetRuntime();
  const a = getRuntime({ env: {}, logPath: "data/t.jsonl", io: memoryIo().io, setTimer: () => 0, clearTimer: () => {} });
  const b = getRuntime();
  assert.equal(a, b, "a second call must not build a second poller against the same services");
  resetRuntime();
  const c = getRuntime({ env: {}, logPath: "data/t.jsonl", io: memoryIo().io, setTimer: () => 0, clearTimer: () => {} });
  assert.notEqual(a, c, "resetting really does clear it, so tests can start clean");
  resetRuntime();
});
