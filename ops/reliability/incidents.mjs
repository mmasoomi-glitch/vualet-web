// Assistant reliability — the incident history.
//
// A customer-facing assistant was dead for four days and afterwards nobody
// could say when it broke, how long it was down, or what it did in between.
// This is the record that answers those questions.
//
// It is APPEND-ONLY, one JSON object per line, matching the .jsonl convention
// already used elsewhere in this project. A history you can rewrite is not a
// history.
//
// redactDetail is a HARD SECURITY BOUNDARY: an incident log is read by humans,
// shipped around, and kept for a long time. Nothing sensitive may enter it.
//
// All I/O is injected. This module never touches the filesystem itself.

const REDACT_KEYS = [
  'key',
  'token',
  'secret',
  'password',
  'auth',
  'cookie',
  'jid',
  'phone',
  'email',
  'credential',
];

/** Worst first. */
const SEVERITY_ORDER = ['OFFLINE', 'FAILOVER_ACTIVE', 'DEGRADED', 'RECOVERING', 'UNKNOWN', 'HEALTHY'];

const MAX_VALUE_LENGTH = 200;

export function redactDetail(detail) {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return {};

  const out = {};
  for (const key of Object.keys(detail)) {
    const lower = key.toLowerCase();
    // The KEY is kept so an operator can see that something was withheld
    // rather than wondering whether it was ever recorded.
    if (REDACT_KEYS.some((word) => lower.includes(word))) {
      out[key] = '[redacted]';
      continue;
    }

    const value = detail[key];
    if (value === null) {
      out[key] = null;
    } else if (typeof value === 'string') {
      // A probe body or a model reply must never be dumped in wholesale.
      out[key] = value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}…` : value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    } else {
      // Nesting is not stored: the log stays one flat line per event, and an
      // object could smuggle a secret past the key check above.
      out[key] = '[omitted]';
    }
  }
  return out;
}

export function buildEvent(input) {
  if (!input || typeof input !== 'object') {
    return { ok: false, reason: 'An event needs an input object.' };
  }
  const { id, atMs, service, type, from, to, state, reason, incidentId, detail } = input;

  // Without an id, a service and a real timestamp an event cannot be
  // correlated with anything later, which is the only reason to keep it.
  if (typeof id !== 'string' || id.trim().length === 0) {
    return { ok: false, reason: 'An event needs an id.' };
  }
  if (typeof service !== 'string' || service.trim().length === 0) {
    return { ok: false, reason: 'An event needs a service.' };
  }
  if (typeof atMs !== 'number' || !Number.isFinite(atMs)) {
    return { ok: false, reason: 'An event needs a finite atMs.' };
  }

  return {
    ok: true,
    event: {
      id,
      atMs,
      service,
      type: type || 'event',
      from: from ?? null,
      to: to ?? null,
      state: state ?? null,
      reason: reason ?? null,
      incidentId: incidentId ?? null,
      detail: redactDetail(detail),
    },
  };
}

export function serialiseEvent(event) {
  try {
    // A raw line break inside a string would tear the line in two and corrupt
    // every record after it. U+2028 and U+2029 are in the class because
    // JSON.stringify does NOT escape them, yet plenty of readers treat them
    // as line endings.
    return JSON.stringify(event).replace(/[\n\r\u2028\u2029]/g, '');
  } catch {
    return `{"id":${JSON.stringify((event && event.id) || 'unknown')},"atMs":${
      event && Number.isFinite(event.atMs) ? event.atMs : 0
    },"serialiseError":true}`;
  }
}

/** A torn final line is expected after a crash, so a bad line is skipped, not fatal. */
export function parseLine(line) {
  if (typeof line !== 'string' || line.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(line);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function foldIncidents(events) {
  if (!Array.isArray(events) || events.length === 0) return [];

  const groups = new Map();
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const id = event.incidentId;
    if (!id) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(event);
  }

  const summaries = [];
  for (const [incidentId, group] of groups) {
    let startedAtMs = Infinity;
    let endedAtMs = -Infinity;
    // Starts null rather than 'UNKNOWN': UNKNOWN outranks HEALTHY in the
    // severity order, so seeding it there would report an incident that only
    // ever saw HEALTHY events as UNKNOWN.
    let worstState = null;
    let resolved = false;

    for (const event of group) {
      if (typeof event.atMs === 'number' && Number.isFinite(event.atMs)) {
        if (event.atMs < startedAtMs) startedAtMs = event.atMs;
        if (event.atMs > endedAtMs) endedAtMs = event.atMs;
      }
      // Recovery is a TRANSITION to healthy. A probe that merely reports a
      // healthy state mid-incident does not close it.
      if (event.to === 'HEALTHY') resolved = true;

      for (const candidate of [event.to, event.state]) {
        const rank = SEVERITY_ORDER.indexOf(candidate);
        if (rank === -1) continue;
        if (worstState === null || rank < SEVERITY_ORDER.indexOf(worstState)) worstState = candidate;
      }
    }

    if (startedAtMs === Infinity) startedAtMs = 0;
    if (endedAtMs === -Infinity) endedAtMs = 0;

    summaries.push({
      incidentId,
      service: group[0] && group[0].service ? group[0].service : null,
      startedAtMs,
      endedAtMs,
      durationMs: endedAtMs - startedAtMs,
      worstState: worstState === null ? 'UNKNOWN' : worstState,
      eventCount: group.length,
      opened: !resolved,
      resolved,
    });
  }

  return summaries.sort((a, b) => b.startedAtMs - a.startedAtMs);
}

export function createIncidentLog(options) {
  const { filePath, io, maxLines = 5000 } = options || {};

  // Startup. Failing loudly here is correct; failing quietly would mean a
  // monitor that believes it is recording history and is not.
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    throw new Error('createIncidentLog requires a filePath.');
  }
  if (
    !io ||
    typeof io.appendLine !== 'function' ||
    typeof io.readLines !== 'function' ||
    typeof io.replaceAll !== 'function'
  ) {
    throw new Error('createIncidentLog requires io with appendLine, readLines and replaceAll.');
  }

  async function readEvents() {
    try {
      const lines = await io.readLines(filePath);
      if (!Array.isArray(lines)) return [];
      return lines.map(parseLine).filter((e) => e !== null);
    } catch {
      // A log that cannot be read is a degraded view, not an outage.
      return [];
    }
  }

  async function record(input) {
    const built = buildEvent(input);
    if (!built.ok) return built;
    try {
      await io.appendLine(filePath, serialiseEvent(built.event));
      return { ok: true, event: built.event };
    } catch (err) {
      // LOSING A LOG LINE MUST NEVER TAKE DOWN THE MONITOR THAT WAS WRITING IT.
      return { ok: false, reason: (err && err.message) || 'Could not append to the incident log.' };
    }
  }

  async function list(limit = 100) {
    const events = await readEvents();
    return events.slice(-limit).reverse();
  }

  async function incidents(limit = 50) {
    return foldIncidents(await readEvents()).slice(0, limit);
  }

  async function prune() {
    try {
      const lines = await io.readLines(filePath);
      if (!Array.isArray(lines) || lines.length <= maxLines) return { pruned: 0 };
      await io.replaceAll(filePath, lines.slice(-maxLines));
      return { pruned: lines.length - maxLines };
    } catch {
      // A disk that fills up silently is its own outage, but a failed prune
      // must not become one too.
      return { pruned: 0 };
    }
  }

  return { record, list, incidents, prune };
}
