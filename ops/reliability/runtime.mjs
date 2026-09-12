// Assistant reliability — the composition root.
//
// Everything else in this directory is pure or injectable. This is the one
// place that knows about the filesystem, the environment and the clock, and it
// wires the probes, the poller, the incident log and the router into a single
// object the rest of the process can ask questions of.
//
// Every dependency is still injectable, so this file is testable too.

import fs from 'node:fs';
import path from 'node:path';

import { probeAssistant, probeInference, probeWhatsApp, probeOpenRouterKey } from './probes.mjs';
import { createPoller } from './poller.mjs';
import { createIncidentLog } from './incidents.mjs';
import { chooseProvider } from './router.mjs';

/** Worst first. */
const SEVERITY_ORDER = ['OFFLINE', 'FAILOVER_ACTIVE', 'DEGRADED', 'RECOVERING', 'UNKNOWN', 'HEALTHY'];

const DEFAULT_SELF_URL = 'http://127.0.0.1:3021';
const MAX_ALERTS = 50;
const MAX_LOG_LINES = 10000;

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function resolveServices(env) {
  const e = env && typeof env === 'object' ? env : {};
  const services = [];

  // The end-to-end assistant check is the entire point of this subsystem, so
  // it is never conditional on configuration.
  services.push({
    name: 'assistant',
    kind: 'assistant',
    url: trimmed(e.MIRA_SELF_URL) || DEFAULT_SELF_URL,
    model: null,
  });

  const llm = trimmed(e.MIRA_LLM_BASE_URL);
  if (llm) {
    services.push({
      name: 'inference',
      kind: 'inference',
      url: llm,
      model: trimmed(e.MIRA_LLM_MODEL) || 'default',
    });
  }

  // THE MODEL ITSELF MUST BE WATCHED, and on this deployment it is reached
  // through a paid API rather than a self-hosted pod. The assistant probe
  // deliberately answers from the knowledge base to avoid spending a customer
  // call on monitoring, which means nothing else calls the model at all —
  // without this, the provider could be failing and nobody would know.
  //
  // It checks the KEY, not generation: a revoked key and exhausted credit are
  // the failures that actually happen, and neither costs anything to detect.
  const openRouter = trimmed(e.OPENROUTER_API_KEY);
  if (!llm && openRouter) {
    services.push({
      name: 'inference',
      kind: 'provider_key',
      url: trimmed(e.OPENROUTER_BASE_URL) || 'https://openrouter.ai/api/v1',
      model: null,
    });
  }

  const whatsapp = trimmed(e.MIRA_WHATSAPP_HEALTH_URL);
  if (whatsapp) {
    services.push({ name: 'whatsapp', kind: 'whatsapp', url: whatsapp, model: null });
  }

  return services;
}

/**
 * Which providers the assistant route can actually reach.
 *
 * The route's own resolver falls back to OpenRouter when MIRA_LLM_BASE_URL is
 * absent, so OpenRouter IS the primary on a deployment with no self-hosted pod.
 * Mapping `primary` to the self-hosted URL alone would mark such a deployment
 * permanently degraded and show every visitor a backup-system notice while the
 * assistant was working perfectly.
 *
 * `secondary` therefore means a DISTINCT second provider exists to fail over
 * to, which is only true when both are configured. With one LLM configured,
 * failover goes to the knowledge base, because there is nowhere else to go.
 */
export function resolveProviders(env) {
  const e = env && typeof env === 'object' ? env : {};
  const selfHosted = trimmed(e.MIRA_LLM_BASE_URL).length > 0;
  const openRouter = trimmed(e.OPENROUTER_API_KEY).length > 0;
  return {
    primary: selfHosted || openRouter,
    secondary: selfHosted && openRouter,
    // The grounded knowledge base is compiled in and cannot be unconfigured.
    kb: true,
  };
}

export function makeFileIo(fsImpl = fs) {
  return {
    appendLine(filePath, line) {
      const dir = path.dirname(filePath);
      if (dir && dir !== '.') fsImpl.mkdirSync(dir, { recursive: true });
      fsImpl.appendFileSync(filePath, `${line}\n`);
    },

    readLines(filePath) {
      let text;
      try {
        text = fsImpl.readFileSync(filePath, 'utf8');
      } catch (err) {
        // A log that has not been written yet is not an error.
        if (err && err.code === 'ENOENT') return [];
        throw err;
      }
      const lines = text.split(/\r?\n/);
      while (lines.length > 0 && lines[lines.length - 1].trim().length === 0) lines.pop();
      return lines;
    },

    replaceAll(filePath, lines) {
      // Temp then rename, the same durability pattern the project's store uses:
      // a crash mid-prune must never leave a half-written history behind.
      const tmp = `${filePath}.tmp`;
      fsImpl.writeFileSync(tmp, lines.length > 0 ? `${lines.join('\n')}\n` : '');
      fsImpl.renameSync(tmp, filePath);
    },
  };
}

/** The worst state present, or UNKNOWN when there is nothing to judge. */
function worstState(states) {
  let worst = null;
  for (const state of states) {
    const rank = SEVERITY_ORDER.indexOf(state);
    if (rank === -1) continue;
    if (worst === null || rank < SEVERITY_ORDER.indexOf(worst)) worst = state;
  }
  return worst === null ? 'UNKNOWN' : worst;
}

export function createRuntime(options = {}) {
  const {
    env = {},
    logPath = (env && env.MIRA_RELIABILITY_LOG) || 'data/reliability.jsonl',
    io = makeFileIo(),
    clock = () => Date.now(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    // Injectable so the wiring can be tested without touching the network.
    fetchImpl = undefined,
  } = options;

  const services = resolveServices(env);
  const providers = resolveProviders(env);
  const incidentLog = createIncidentLog({ filePath: logPath, io, maxLines: MAX_LOG_LINES });

  const alerts = [];
  let sequence = 0;
  /** Event ids must be unique within a millisecond, hence the counter. */
  const nextId = (atMs) => `ev_${atMs}_${sequence++}`;

  const pollerServices = services.map((svc) => ({
    name: svc.name,
    // A CLOSURE, not a call. The clock is read per probe, so every result is
    // stamped when it actually ran rather than when the runtime was built.
    probe: () => {
      const opts = { nowMs: clock() };
      // Undefined leaves the probe on the global fetch, which is what runs in
      // production; a test supplies its own.
      if (fetchImpl) opts.fetchImpl = fetchImpl;
      if (svc.kind === 'inference') return probeInference(svc.url, svc.model, opts);
      if (svc.kind === 'provider_key') return probeOpenRouterKey(svc.url, env.OPENROUTER_API_KEY, opts);
      if (svc.kind === 'whatsapp') return probeWhatsApp(svc.url, opts);
      return probeAssistant(svc.url, opts);
    },
  }));

  const poller = createPoller({
    services: pollerServices,
    clock,
    setTimer,
    clearTimer,
    onEvent: (event) => {
      // ONLY transitions are persisted. A probe every 45 seconds forever would
      // fill the disk with noise and bury the handful of events that matter.
      if (!event || event.type !== 'transition') return;
      incidentLog
        .record({
          id: nextId(event.atMs),
          atMs: event.atMs,
          service: event.service,
          type: 'transition',
          from: event.from,
          to: event.to,
          state: event.to,
          reason: event.reason,
          incidentId: event.incidentId,
        })
        .catch(() => {});
    },
    onAlert: (alert, serviceName, tracker) => {
      const atMs = tracker && typeof tracker.stateSince === 'number' ? tracker.stateSince : clock();
      alerts.push({ ...alert, service: serviceName, atMs });
      if (alerts.length > MAX_ALERTS) alerts.shift();
      incidentLog
        .record({
          id: nextId(atMs),
          atMs,
          service: serviceName,
          type: 'alert',
          state: tracker ? tracker.state : null,
          reason: `${alert.severity}: ${alert.title}`,
          incidentId: tracker ? tracker.incidentId : null,
          detail: { severity: alert.severity, title: alert.title },
        })
        // A log write must never break the poller that was reporting the fault.
        .catch(() => {});
    },
  });

  function status() {
    const snapshot = poller.snapshot();
    const trackers = Object.values(snapshot);
    const assistant = snapshot.assistant;
    return {
      atMs: clock(),
      overall: worstState(trackers.map((t) => t && t.state)),
      services: snapshot,
      route: chooseProvider({ state: assistant ? assistant.state : 'UNKNOWN', providers }),
    };
  }

  return {
    start: poller.start,
    stop: poller.stop,
    isRunning: poller.isRunning,
    snapshot: poller.snapshot,
    pollOnce: poller.pollOnce,
    services,
    providers,
    status,
    recentAlerts: (limit = 20) => alerts.slice(-limit).reverse(),
    incidents: (limit) => incidentLog.incidents(limit),
    events: (limit) => incidentLog.list(limit),
    prune: () => incidentLog.prune(),
  };
}

let singleton = null;

export function getRuntime(options) {
  if (!singleton) singleton = createRuntime(options);
  return singleton;
}

export function resetRuntime() {
  if (singleton) {
    singleton.stop();
    singleton = null;
  }
}
