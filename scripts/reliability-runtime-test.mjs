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
import { chooseProvider } from "../ops/reliability/router.mjs";

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
    "with a pod AND a paid key there is a real provider and a real fallback",
  );
});

test("A HOSTED-ONLY DEPLOYMENT IS NOT PERMANENTLY DEGRADED", () => {
  // This is production today: no self-hosted pod, an OpenRouter key. The
  // assistant route falls back to OpenRouter as its PRIMARY in that case.
  const providers = resolveProviders({ OPENROUTER_API_KEY: "sk-live" });
  assert.equal(
    providers.primary,
    true,
    "OpenRouter is the primary when no pod is configured; calling it secondary would show every visitor a backup-system notice while the assistant worked perfectly",
  );
  assert.equal(
    providers.secondary,
    false,
    "with one LLM configured there is no distinct provider to fail over to",
  );

  const route = chooseProvider({ state: "HEALTHY", providers });
  assert.equal(route.target, "primary", "a healthy hosted-only deployment serves from primary");
  assert.equal(route.degraded, false, "and is NOT degraded");
  assert.equal(route.userNotice, null, "so a visitor is told nothing at all");
});

test("with one provider, failover goes to the knowledge base", () => {
  const providers = resolveProviders({ OPENROUTER_API_KEY: "sk-live" });
  const route = chooseProvider({ state: "OFFLINE", providers });
  assert.equal(route.target, "kb", "there is nowhere else to go");
  assert.ok(route.userNotice, "and the visitor is told general knowledge is briefly gone");
});

test("nothing configured is genuinely KB-only", () => {
  const providers = resolveProviders({});
  assert.equal(providers.primary, false, "no LLM at all means no primary");
  assert.equal(chooseProvider({ state: "HEALTHY", providers }).target, "kb", "only the KB remains");
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

/* ── the production shape: paid provider, no self-hosted pod ───────────── */

test("THE MODEL IS MONITORED ON A HOSTED-ONLY DEPLOYMENT", () => {
  // This is production: no MIRA_LLM_BASE_URL, an OpenRouter key. The assistant
  // probe answers from the KB to avoid spending a customer call, so without
  // this the model has nothing watching it at all.
  const services = resolveServices({ OPENROUTER_API_KEY: "sk-live" });
  const inference = services.find((s) => s.name === "inference");

  assert.ok(
    inference,
    "the provider could have been failing and nobody would have known — the assistant probe deliberately never calls it",
  );
  assert.equal(inference.kind, "provider_key", "checked by key and credit, not by generating text");
  assert.equal(inference.url, "https://openrouter.ai/api/v1", "at the provider's base");
});

test("A SELF-HOSTED POD IS STILL PROBED BY GENERATION, NOT BY KEY", () => {
  // A pod costs nothing per call, so there it is worth proving the model
  // actually produces words rather than merely that a credential is valid.
  const services = resolveServices({ MIRA_LLM_BASE_URL: "http://pod:8000/v1", OPENROUTER_API_KEY: "sk-live" });
  const inference = services.filter((s) => s.name === "inference");

  assert.equal(inference.length, 1, "exactly one inference service, never two");
  assert.equal(inference[0].kind, "inference", "the free pod is generation-probed");
  assert.equal(inference[0].url, "http://pod:8000/v1", "at the pod");
});

test("with no model configured at all there is nothing to monitor", () => {
  const services = resolveServices({});
  assert.equal(services.find((s) => s.name === "inference"), undefined, "and none is invented");
  assert.ok(services.find((s) => s.name === "assistant"), "while the assistant check is never optional");
});

test("THE PROVIDER PROBE IS WIRED TO A REAL CALL", async () => {
  let seen = null;
  const store = memoryIo();
  let now = 1000;
  const rt = createRuntime({
    env: { OPENROUTER_API_KEY: "sk-live-SECRET" },
    logPath: "data/test.jsonl",
    io: store.io,
    clock: () => now,
    setTimer: () => 0,
    clearTimer: () => {},
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return {
        status: 200,
        text: async () => JSON.stringify({ data: { label: "k", usage: 1, limit: 10, is_free_tier: false } }),
      };
    },
  });

  const tracker = await rt.pollOnce("inference");
  assert.ok(/\/key$/.test(seen.url), `the probe hits the key endpoint, got ${seen.url}`);
  assert.equal(seen.init.method, "GET", "and never posts a completion, which would be billable");
  assert.equal(tracker.state, "RECOVERING", "a healthy key starts the recovery climb");

  const logged = JSON.stringify(store.lines);
  assert.ok(!logged.includes("sk-live-SECRET"), "and the key never reaches the incident log");
});

/* ── the judge's REQUIRED_ACTIONS: alerts must reach a human ───────────── */

test("A STATE ALERT ACTUALLY REACHES THE TRANSPORT", async () => {
  const delivered = [];
  const store = memoryIo();
  let now = 1000;
  const rt = createRuntime({
    env: {},
    logPath: "data/test.jsonl",
    io: store.io,
    clock: () => now,
    setTimer: () => 0,
    clearTimer: () => {},
    fetchImpl: async () => {
      throw new Error("down");
    },
    sendAlert: async (m) => void delivered.push(m),
  });

  await rt.pollOnce("assistant");
  assert.ok(
    delivered.length > 0,
    "an alert that only ever reaches a ring buffer is an alert nobody receives — the judge rejected exactly that",
  );
  assert.ok(/assistant/.test(delivered[0].subject), "and it names the service");
});

test("CREDIT WARNING IS ACTUALLY INVOKED, NOT MERELY DEFINED", async () => {
  const delivered = [];
  const store = memoryIo();
  let now = 1000;
  const rt = createRuntime({
    env: { OPENROUTER_API_KEY: "sk-live" },
    logPath: "data/test.jsonl",
    io: store.io,
    clock: () => now,
    setTimer: () => 0,
    clearTimer: () => {},
    // A healthy key with almost nothing left: the provider still answers 200.
    fetchImpl: async () => ({
      status: 200,
      text: async () => JSON.stringify({ data: { usage: 99.5, limit: 100, is_free_tier: false } }),
    }),
    sendAlert: async (m) => void delivered.push(m),
  });

  const tracker = await rt.pollOnce("inference");
  assert.equal(tracker.state, "RECOVERING", "the provider is still healthy — that is the whole problem");

  const warning = delivered.find((m) => /credit/i.test(m.subject));
  assert.ok(
    warning,
    "credit is not a state transition: the provider reports healthy all the way down to zero, so a warning driven by transitions would arrive one poll too late",
  );
  assert.ok(/HIGH/.test(warning.subject), "and it is urgent enough to act on");
  assert.ok(/knowledge base/i.test(warning.text), "and says what the customer will actually experience");
});

test("AN UNRECOGNISED PROVIDER PAYLOAD IS LOUD, NOT SILENTLY HEALTHY", async () => {
  const store = memoryIo();
  let now = 1000;
  const rt = createRuntime({
    env: { OPENROUTER_API_KEY: "sk-live" },
    logPath: "data/test.jsonl",
    io: store.io,
    clock: () => now,
    setTimer: () => 0,
    clearTimer: () => {},
    // The provider changed its schema. Field names no longer match.
    fetchImpl: async () => ({
      status: 200,
      text: async () => JSON.stringify({ data: { spend: 4, ceiling: 10, tier: "pro" } }),
    }),
  });

  const tracker = await rt.pollOnce("inference");
  assert.equal(
    tracker.state,
    "DEGRADED",
    "without this the probe degrades into a liveness check that can NEVER detect credit exhaustion, and nobody would ever know",
  );
  assert.equal(tracker.lastError, "unrecognised key payload", "and it names the problem");
});

test("WITHOUT A TRANSPORT, NOTHING PRETENDS TO HAVE BEEN SENT", async () => {
  const store = memoryIo();
  const rt = createRuntime({
    env: {},
    logPath: "data/test.jsonl",
    io: store.io,
    clock: () => 1000,
    setTimer: () => 0,
    clearTimer: () => {},
    fetchImpl: async () => {
      throw new Error("down");
    },
  });

  await rt.pollOnce("assistant");
  assert.deepEqual(
    rt.notifications(),
    { sentInWindow: 0, trackedKeys: 0, configured: false },
    "an unconfigured transport must report itself as unconfigured rather than as quietly working",
  );
});
