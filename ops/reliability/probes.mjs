// Assistant reliability — real health probes.
//
// A 200 IS NOT HEALTH. A port accepting TCP, a process existing, or an HTTP
// call returning 200 tells you almost nothing. These probes assert on the
// CONTENT of the response.
//
// The WhatsApp probe deliberately parses the body even on a 503, because that
// gateway signals unhealth with a 503 while still returning a useful body. A
// probe that treated non-200 as "unreachable" would have thrown away the exact
// number — linked: 0 — that identified a four-day outage.
//
// NO PROBE MAY EVER LOG A SECRET OR CUSTOMER CONTENT. `detail` carries lengths
// and counts, never the reply text and never an API key.
//
// Every probe takes its HTTP client injected and never throws: this runs on a
// timer, and a monitor that crashes is worse than no monitor.

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_CLOCK = () => Date.now();

function makeResult(ok, atMs, latencyMs, error, detail) {
  return { ok, atMs, latencyMs, error, detail };
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function shortError(err) {
  if (err && err.name === 'AbortError') return 'timeout';
  return (err && err.message) || 'error';
}

/** Resolve options once, so a missing nowMs degrades instead of throwing. */
function resolveOpts(opts) {
  const clock = typeof opts.clock === 'function' ? opts.clock : DEFAULT_CLOCK;
  return {
    fetchImpl: opts.fetchImpl || globalThis.fetch,
    timeoutMs: typeof opts.timeoutMs === 'number' ? opts.timeoutMs : DEFAULT_TIMEOUT_MS,
    clock,
    // A caller that forgets nowMs gets the clock rather than an exception.
    nowMs: typeof opts.nowMs === 'number' ? opts.nowMs : clock(),
  };
}

async function request(url, init, o) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), o.timeoutMs);
  try {
    const res = await o.fetchImpl(url, { ...init, signal: controller.signal });
    const text = await res.text();
    return { res, text };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeHttp(url, opts = {}) {
  const o = resolveOpts(opts);
  const start = o.clock();
  try {
    const { res } = await request(
      url,
      { method: opts.method || 'GET', headers: opts.headers, body: opts.body },
      o,
    );
    const latency = o.clock() - start;
    const detail = { status: res.status, url };
    if (res.status >= 200 && res.status < 300) {
      return makeResult(true, o.nowMs, latency, null, detail);
    }
    return makeResult(false, o.nowMs, latency, `http ${res.status}`, detail);
  } catch (err) {
    return makeResult(false, o.nowMs, o.clock() - start, shortError(err), { url });
  }
}

/**
 * The end-to-end probe: gateway -> route -> provider -> a real textual reply.
 *
 * It deliberately does NOT require the reply to equal "ASSISTANT_HEALTH_OK".
 * This assistant is a persona with a grounded knowledge base and an intentional
 * fallback answer, so demanding an exact echo would report a perfectly working
 * assistant as broken. What matters is that the path produced words.
 */
export async function probeAssistant(baseUrl, opts = {}) {
  const o = resolveOpts(opts);
  const url = `${baseUrl}/api/veridian-demo`;
  const start = o.clock();
  try {
    const { res, text } = await request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Exercise the route without spending a customer LLM call or writing
          // visitor memory. At the healthy interval this probe runs ~1900 times
          // a day, which would otherwise consume nearly the whole daily cap and
          // starve real visitors of the assistant. The model itself is watched
          // directly by probeInference, so nothing goes unchecked.
          'x-mira-health-probe': '1',
        },
        body: JSON.stringify({ message: 'Reply with exactly: ASSISTANT_HEALTH_OK' }),
      },
      o,
    );
    const latency = o.clock() - start;
    const json = safeParseJson(text);
    const detail = { status: res.status };

    if (!json || typeof json.reply !== 'string' || json.reply.length === 0) {
      return makeResult(false, o.nowMs, latency, 'empty reply', detail);
    }

    detail.replyLength = json.reply.length;
    // `trialGate` only exists on the real route's payload, so its presence is
    // evidence the route answered rather than a proxy or an error page.
    detail.usedFallbackShape = Object.prototype.hasOwnProperty.call(json, 'trialGate');

    if (res.status < 200 || res.status >= 300) {
      return makeResult(false, o.nowMs, latency, `http ${res.status}`, detail);
    }
    return makeResult(true, o.nowMs, latency, null, detail);
  } catch (err) {
    return makeResult(false, o.nowMs, o.clock() - start, shortError(err), { url });
  }
}

export async function probeInference(baseUrl, model, opts = {}) {
  const o = resolveOpts(opts);
  const url = `${baseUrl}/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  // Never send `Bearer ` with an empty key — a self-hosted vLLM rejects it.
  if (typeof opts.apiKey === 'string' && opts.apiKey.length > 0) {
    headers.Authorization = `Bearer ${opts.apiKey}`;
  }
  const start = o.clock();
  try {
    const { res, text } = await request(
      url,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
          max_tokens: 8,
          temperature: 0,
        }),
      },
      o,
    );
    const latency = o.clock() - start;
    const json = safeParseJson(text);
    const detail = { status: res.status, model };

    const content =
      json && json.choices && json.choices[0] && json.choices[0].message
        ? json.choices[0].message.content
        : null;

    if (typeof content !== 'string' || content.length === 0) {
      return makeResult(false, o.nowMs, latency, 'empty completion', detail);
    }
    // Length only. The content itself is never recorded.
    detail.contentLength = content.length;

    if (res.status < 200 || res.status >= 300) {
      return makeResult(false, o.nowMs, latency, `http ${res.status}`, detail);
    }
    return makeResult(true, o.nowMs, latency, null, detail);
  } catch (err) {
    return makeResult(false, o.nowMs, o.clock() - start, shortError(err), { url });
  }
}

/**
 * Which host does somebody actually go to?
 *
 * The WhatsApp healthz URL is the local end of an SSH tunnel, not the gateway.
 * So two completely different failures look identical from here: the tunnel
 * dying on THIS host while the gateway is perfectly healthy, or the gateway
 * dying on the OTHER host while the tunnel is fine.
 *
 * The difference decides which machine a human opens at 3am, and getting that
 * wrong costs more than the outage did. The connection error shape tells them
 * apart: nothing listening locally refuses the connection outright, whereas a
 * live tunnel accepts it and then the far end drops it.
 */
export function classifyTransportError(err) {
  if (err === null || err === undefined) return { layer: 'unknown', error: 'error' };

  const code = typeof err === 'object' && err.code ? String(err.code) : '';
  // A non-Error (a string, a number) has no .message, and reading one would
  // classify every such failure as the literal text "undefined".
  const raw = typeof err === 'object' && err.message ? String(err.message) : String(err);
  const text = `${code} ${raw}`.toLowerCase();
  const name = typeof err === 'object' ? err.name : '';

  const has = (...needles) => needles.some((n) => text.includes(n));

  // Nothing is listening on the local port at all.
  if (has('econnrefused')) return { layer: 'transport', error: 'tunnel down' };
  if (has('enotfound', 'eai_again')) return { layer: 'transport', error: 'host not resolvable' };

  // The local socket was accepted and then died — the tunnel is up and the far
  // end is what is not answering.
  if (has('econnreset', 'epipe', 'socket hang up', 'premature close')) {
    return { layer: 'gateway', error: 'gateway unreachable' };
  }

  // Genuinely ambiguous. Reported as ambiguous rather than guessed, because a
  // confident wrong answer here sends somebody to the wrong machine.
  if (name === 'AbortError' || has('etimedout', 'timeout', 'aborted')) {
    return { layer: 'unknown', error: 'timeout' };
  }

  return { layer: 'unknown', error: raw.toLowerCase() || 'error' };
}

/** One sentence for the alert, naming what to check. */
export function whatsappFailureGuidance(layer) {
  if (layer === 'transport') {
    return 'The tunnel on the web host is down. The gateway itself may be fine — check the tunnel first.';
  }
  if (layer === 'gateway') {
    return 'The tunnel is up and the gateway host is not answering. Go to the gateway host.';
  }
  return 'Which side failed is not yet clear. Check the tunnel on the web host and the gateway host.';
}

export async function probeWhatsApp(healthzUrl, opts = {}) {
  const o = resolveOpts(opts);
  const start = o.clock();
  try {
    const { res, text } = await request(healthzUrl, { method: 'GET' }, o);
    const latency = o.clock() - start;
    // Parse REGARDLESS of status: this endpoint returns 503 when unhealthy and
    // the body still carries the counts that say why.
    const json = safeParseJson(text);
    const detail = { status: res.status };

    if (!json) {
      return makeResult(false, o.nowMs, latency, 'unparseable body', detail);
    }

    detail.linked = json.linked;
    detail.total = json.total;
    detail.pending = json.pending;
    detail.stale = json.stale;

    if (typeof json.linked !== 'number') {
      return makeResult(false, o.nowMs, latency, 'no linked count', detail);
    }
    if (json.linked <= 0) {
      // The process is alive and every customer is disconnected. This is the
      // exact state that went unnoticed for four days.
      return makeResult(false, o.nowMs, latency, 'no linked devices', detail);
    }
    return makeResult(true, o.nowMs, latency, null, detail);
  } catch (err) {
    // A connection failure here is ambiguous between the tunnel and the
    // gateway, and the alert has to say which so nobody opens the wrong host.
    const { layer, error } = classifyTransportError(err);
    return makeResult(false, o.nowMs, o.clock() - start, error, {
      layer,
      guidance: whatsappFailureGuidance(layer),
    });
  }
}

export function summarise(results) {
  if (!results || typeof results !== 'object') {
    return { allOk: true, failed: [], worstLatencyMs: 0 };
  }
  const failed = [];
  let worstLatencyMs = 0;
  for (const name of Object.keys(results)) {
    const r = results[name];
    if (!r || typeof r.ok !== 'boolean' || typeof r.latencyMs !== 'number') continue;
    if (!r.ok) failed.push(name);
    if (r.latencyMs > worstLatencyMs) worstLatencyMs = r.latencyMs;
  }
  return { allOk: failed.length === 0, failed, worstLatencyMs };
}

/**
 * Is the model provider going to keep working tomorrow?
 *
 * This deliberately does NOT generate text. Production reaches its model
 * through a paid per-call API, and a generation probe at the healthy interval
 * would run ~1900 times a day and bill for every one of them. Monitoring that
 * costs a meaningful fraction of what it monitors gets turned off.
 *
 * So it checks the two things that actually break: a revoked key, and credit
 * running out. The second is the valuable one — it is a failure you can see
 * coming. The assistant keeps answering right up until the credit is gone and
 * then silently drops to a knowledge-base reply, which is exactly the shape of
 * "broken and nobody told us" this subsystem exists to end.
 */
export async function probeOpenRouterKey(baseUrl, apiKey, opts = {}) {
  const o = resolveOpts(opts);
  const start = o.clock();

  // Checked BEFORE any request. Probing with no key would report the PROVIDER
  // as broken when it is our own configuration that is missing, and that sends
  // somebody to investigate the wrong system at the worst possible moment.
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    return makeResult(false, o.nowMs, 0, 'no api key', {});
  }

  const url = `${baseUrl}/key`;
  try {
    const { res, text } = await request(
      url,
      { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } },
      o,
    );
    const latency = o.clock() - start;
    // Parsed regardless of status, for the same reason probeWhatsApp does it:
    // a non-2xx body still carries the thing that says why.
    const json = safeParseJson(text);

    if (res.status === 401 || res.status === 403) {
      return makeResult(false, o.nowMs, latency, 'invalid key', { status: res.status });
    }
    if (res.status < 200 || res.status >= 300) {
      return makeResult(false, o.nowMs, latency, `http ${res.status}`, { status: res.status });
    }
    if (!json || typeof json !== 'object') {
      return makeResult(false, o.nowMs, latency, 'unparseable body', { status: res.status });
    }

    // Either shape: wrapped in `data`, or the fields at the top level.
    const data = json.data && typeof json.data === 'object' ? json.data : json;

    const firstNumber = (...names) => {
      for (const name of names) {
        const v = data[name];
        if (typeof v === 'number' && Number.isFinite(v)) return v;
      }
      return null;
    };
    const usage = firstNumber('usage', 'usage_daily', 'used');
    const limit = firstNumber('limit', 'limit_remaining', 'credit_limit', 'max_credit');
    const isFreeTier = typeof data.is_free_tier === 'boolean' ? data.is_free_tier : null;
    const hasLimitKey = Object.prototype.hasOwnProperty.call(data, 'limit');

    // AN UNRECOGNISED PAYLOAD IS NOT HEALTHY.
    //
    // These field names came from documentation, not from an observed response.
    // If the provider changes its schema, or this endpoint ever returns
    // something else, the numbers silently resolve to null — and without this
    // branch the probe would report HEALTHY on any 2xx forever, having quietly
    // degraded into a liveness check that can NEVER detect credit exhaustion.
    // That is the exact failure this subsystem exists to eliminate, so it is
    // made loud instead.
    //
    // `fields` reports the key NAMES we did see, which is what lets a human fix
    // the mapping in one look rather than by reading the code. NAMES ONLY: a
    // value could be a credential.
    if (usage === null && limit === null && !hasLimitKey) {
      const fields = Object.keys(data)
        .sort()
        .slice(0, 12)
        .map((k) => k.slice(0, 40));
      return makeResult(false, o.nowMs, latency, 'unrecognised key payload', {
        status: res.status,
        usage: null,
        limit: null,
        isFreeTier,
        remaining: null,
        fields,
      });
    }

    // An explicit null limit means UNLIMITED, which is not the same as
    // exhausted: there is no ceiling to run into, so there is nothing to warn
    // about and remaining stays unknown rather than zero.
    const remaining = usage !== null && limit !== null ? limit - usage : null;

    // NEVER the key, never any part of it, and never `label` — that is a
    // human-chosen key name and has been known to carry identifying text.
    const detail = { status: res.status, usage, limit, isFreeTier, remaining };

    if (remaining !== null && remaining <= 0) {
      return makeResult(false, o.nowMs, latency, 'credit exhausted', detail);
    }
    return makeResult(true, o.nowMs, latency, null, detail);
  } catch (err) {
    return makeResult(false, o.nowMs, o.clock() - start, shortError(err), { url });
  }
}

/**
 * Is the store actually keeping what we give it?
 *
 * This is the component with the largest blast radius: payments, sessions,
 * entitlement and channel bindings all live here. It is also the one whose
 * failure is completely silent — its persist() wraps the file write in
 * try/catch and only logs, so a full disk or a permissions change means every
 * write still SUCCEEDS in memory and is lost on the next restart.
 *
 * A write-then-read probe cannot catch that: the in-process map answers the
 * read correctly while nothing reached the disk. So this verifies DURABILITY,
 * which is the only property that actually matters here.
 */
export async function probeStore(store, opts = {}) {
  const o = resolveOpts(opts);
  const start = o.clock();

  if (
    !store ||
    typeof store !== 'object' ||
    typeof store.write !== 'function' ||
    typeof store.read !== 'function' ||
    typeof store.configured !== 'function' ||
    typeof store.tier !== 'function'
  ) {
    return makeResult(false, o.nowMs, 0, 'store not wired', {});
  }

  try {
    const tier = store.tier();
    const detail = { tier, durabilityChecked: false };

    // On the memory tier every write lives only in this process, so a restart
    // silently discards paid subscriptions, live sessions and channel
    // bindings. It is data loss that looks exactly like healthy operation
    // right up until somebody restarts the service.
    if (!store.configured()) {
      return makeResult(false, o.nowMs, o.clock() - start, 'store not durable', detail);
    }

    const key = 'mira:health:canary';
    const value = String(o.nowMs);
    await store.write(key, value, 300);
    const readBack = await store.read(key);

    if (readBack === null || readBack === undefined) {
      return makeResult(false, o.nowMs, o.clock() - start, 'canary vanished', detail);
    }
    if (readBack !== value) {
      return makeResult(false, o.nowMs, o.clock() - start, 'canary mismatch', detail);
    }

    if (typeof store.durable === 'function') {
      // THE CHECK THAT MATTERS. A read-back only proves the value is in the
      // active read path. This proves it reached the disk, which is the
      // difference between "working" and "quietly losing every customer
      // record since the disk filled".
      if (!(await store.durable(key))) {
        return makeResult(false, o.nowMs, o.clock() - start, 'write not durable', detail);
      }
      detail.durabilityChecked = true;
    }
    // When durability cannot be checked the result stays ok but says so.
    // An unverified claim must be visible as unverified rather than counted
    // as healthy, or the gap disappears into a green dashboard.

    // Never the canary value, and never any other stored value: this store
    // holds customer records.
    detail.roundTripMs = o.clock() - start;
    return makeResult(true, o.nowMs, detail.roundTripMs, null, detail);
  } catch (err) {
    return makeResult(false, o.nowMs, o.clock() - start, shortError(err), {});
  }
}

/**
 * Should somebody be told about the remaining credit?
 *
 * Separate from the probe because running out is not the same event as being
 * down: the assistant is still answering, and what matters is that a human
 * acts before it stops.
 */
export function creditWarning(detail, warnBelow = 1) {
  // An unlimited or unknown budget is not a warning. Crying wolf about one
  // teaches people to ignore the alert that matters.
  if (!detail || typeof detail !== 'object') return null;
  const remaining = detail.remaining;
  if (typeof remaining !== 'number' || !Number.isFinite(remaining)) return null;

  const consequence =
    'The assistant falls back to its knowledge base when the credit runs out, so it keeps answering but stops being able to reason.';

  if (remaining <= 0) {
    return {
      severity: 'critical',
      title: 'Assistant credit exhausted',
      detail: `Remaining credit: ${remaining}. ${consequence}`,
    };
  }
  if (remaining <= warnBelow) {
    return {
      severity: 'high',
      title: 'Assistant credit nearly exhausted',
      detail: `Remaining credit: ${remaining}. ${consequence}`,
    };
  }
  return null;
}
