/**
 * Cloudflare range drift check — the repeatable version of a hand diff.
 *
 * WHY THIS EXISTS. /api/begin refuses to key its rate limiter on an `x-real-ip`
 * that falls inside a Cloudflare range, because such a value is proof that
 * `set_real_ip_from` / `real_ip_header CF-Connecting-IP` is not configured on
 * the host (gotchas#252, decisions#343). Those ranges are VENDORED into
 * src/app/api/begin/route.ts — deliberately, because fetching them on the
 * signup path would be a new failure mode and a new latency budget.
 *
 * The cost of vendoring is drift, and a code comment admitting that is not a
 * mitigation: it does not repeat itself. Someone diffing the list by hand once
 * protects nobody next month. This script is the part that repeats.
 *
 * IT FETCHES. That is the point, and it is why it is a script you run and not
 * something the route or the test suite does: no network at request time, and
 * none in the test suite. The tests for this file drive it with fixtures.
 *
 * EXIT CODES — the third one is the one that matters:
 *   0  the vendored list matches Cloudflare exactly
 *   1  DRIFT, in either direction (see below; they have opposite consequences)
 *   2  COULD NOT VERIFY — the fetch failed, returned nothing usable, or the
 *      vendored list could not be read. NOTHING WAS COMPARED. A run that
 *      silently checks nothing and exits 0 is what retires the question and
 *      leaves you exposed, so that outcome is spelled out as its own code.
 *
 * Run: npm run check:cloudflare-ranges
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROUTE_FILE = path.join(HERE, "..", "src", "app", "api", "begin", "route.ts");

export const SOURCES = [
  { family: "IPv4", url: "https://www.cloudflare.com/ips-v4" },
  { family: "IPv6", url: "https://www.cloudflare.com/ips-v6" },
];

const FETCH_TIMEOUT_MS = 15_000;

/** A CIDR, loosely: enough shape to reject prose, not a full address parser. */
const CIDR_RE = /^[0-9a-fA-F.:]+\/\d{1,3}$/;

/**
 * Cloudflare serves these as plain text, one CIDR per line. Tolerant of CRLF,
 * blank lines and a trailing newline; intolerant of anything that is not a
 * CIDR, because an HTML error page full of prose must NOT parse as "zero
 * ranges, all good".
 */
export function parseRangeList(text) {
  if (typeof text !== "string") return { ok: false, reason: "response was not text" };
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { ok: false, reason: "response was empty" };
  const bad = lines.filter((l) => !CIDR_RE.test(l));
  if (bad.length > 0) {
    return {
      ok: false,
      reason: `response did not look like a CIDR list (e.g. ${JSON.stringify(bad[0].slice(0, 60))})`,
    };
  }
  return { ok: true, ranges: lines.map((l) => l.toLowerCase()) };
}

/**
 * Pull CLOUDFLARE_RANGES out of the route source.
 *
 * Line comments are stripped first so the documentation URLs inside the array
 * (https://www.cloudflare.com/ips-v4 and friends) can never be mistaken for
 * entries, and every survivor must still look like a CIDR.
 */
export function readVendoredRanges(routeSource) {
  if (typeof routeSource !== "string") {
    return { ok: false, reason: "route source was not text" };
  }
  const block = routeSource.match(
    /const CLOUDFLARE_RANGES: readonly string\[\] = \[([\s\S]*?)\n\];/,
  );
  if (!block) {
    return {
      ok: false,
      reason: "could not find `const CLOUDFLARE_RANGES: readonly string[] = [...]` in the route",
    };
  }
  const body = block[1].replace(/\/\/[^\n]*/g, "");
  const quoted = [...body.matchAll(/"([^"]*)"/g)].map((m) => m[1].trim());
  const ranges = quoted.filter((r) => CIDR_RE.test(r));
  if (ranges.length === 0) {
    return { ok: false, reason: "the vendored list parsed to zero ranges" };
  }
  if (ranges.length !== quoted.length) {
    const bad = quoted.find((r) => !CIDR_RE.test(r));
    return { ok: false, reason: `vendored entry is not a CIDR: ${JSON.stringify(bad)}` };
  }
  return { ok: true, ranges: ranges.map((r) => r.toLowerCase()) };
}

/**
 * The two directions of drift, kept apart because their consequences are
 * opposite and a combined count would hide which one you have.
 *
 *   missing — Cloudflare publishes it, we do not have it. The guard does not
 *             recognise traffic through that range, so it stays quiet and
 *             those visitors silently collapse into shared buckets. This is
 *             the direction that reopens gotchas#252.
 *   stale   — we list it, Cloudflare no longer does. We treat addresses there
 *             as untrusted and fail open, so real customers in a range that is
 *             now somebody else's get no per-client rate limiting at all.
 */
export function diffRanges(vendored, live) {
  const v = new Set(vendored);
  const l = new Set(live);
  return {
    missing: live.filter((r) => !v.has(r)),
    stale: vendored.filter((r) => !l.has(r)),
  };
}

/** 0 clean, 1 drift, 2 could-not-verify. */
export function classify(outcome) {
  if (!outcome.ok) return 2;
  return outcome.missing.length > 0 || outcome.stale.length > 0 ? 1 : 0;
}

/** Compare two already-obtained lists. Pure — no I/O, so tests can drive it. */
export function compare({ vendored, live }) {
  if (!vendored.ok) return { ok: false, reason: `vendored list unreadable: ${vendored.reason}` };
  if (!live.ok) return { ok: false, reason: `live list unusable: ${live.reason}` };
  const { missing, stale } = diffRanges(vendored.ranges, live.ranges);
  return { ok: true, missing, stale, vendoredCount: vendored.ranges.length, liveCount: live.ranges.length };
}

/** Human-readable report. Returns the lines so tests can assert on them. */
export function report(outcome) {
  if (!outcome.ok) {
    return [
      "COULD NOT VERIFY — " + outcome.reason,
      "",
      "NOTHING WAS COMPARED. Do not read this as a pass: the vendored Cloudflare",
      "ranges in src/app/api/begin/route.ts are still whatever they were, and",
      "this run has told you nothing about whether they are current.",
    ];
  }
  if (outcome.missing.length === 0 && outcome.stale.length === 0) {
    return [
      `OK — the vendored list matches Cloudflare exactly (${outcome.vendoredCount} ranges, IPv4 + IPv6).`,
    ];
  }
  const lines = [
    `DRIFT — vendored ${outcome.vendoredCount}, Cloudflare publishes ${outcome.liveCount}.`,
    "",
  ];
  if (outcome.missing.length > 0) {
    lines.push(
      `MISSING (${outcome.missing.length}) — Cloudflare publishes these, the route does NOT list them.`,
      "  Consequence: traffic arriving through these ranges is not recognised as edge",
      "  traffic, so the guard stays silent and those visitors collapse into shared",
      "  rate-limit buckets (gotchas#252). This is the direction that reopens the bug.",
      ...outcome.missing.map((r) => `    + ${r}`),
      "",
    );
  }
  if (outcome.stale.length > 0) {
    lines.push(
      `STALE (${outcome.stale.length}) — the route lists these, Cloudflare no longer publishes them.`,
      "  Consequence: addresses in these ranges are treated as untrusted, so the route",
      "  fails open for them and real customers there get no per-client rate limiting.",
      ...outcome.stale.map((r) => `    - ${r}`),
      "",
    );
  }
  lines.push("Fix: update CLOUDFLARE_RANGES in src/app/api/begin/route.ts, then re-run this check.");
  return lines;
}

/** Fetch one published list. Never throws — a failure is a reason, not a crash. */
export async function fetchRangeList(url, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return { ok: false, reason: `${url} returned HTTP ${res.status}` };
    const parsed = parseRangeList(await res.text());
    return parsed.ok ? parsed : { ok: false, reason: `${url}: ${parsed.reason}` };
  } catch (err) {
    return { ok: false, reason: `${url}: ${err?.message ?? String(err)}` };
  }
}

/** Fetch both families and merge them into one list. */
export async function fetchLiveRanges(fetchImpl = globalThis.fetch) {
  const ranges = [];
  for (const { family, url } of SOURCES) {
    const got = await fetchRangeList(url, fetchImpl);
    if (!got.ok) return { ok: false, reason: `${family}: ${got.reason}` };
    ranges.push(...got.ranges);
  }
  return { ok: true, ranges };
}

export async function main({ fetchImpl = globalThis.fetch, routeFile = ROUTE_FILE } = {}) {
  let vendored;
  try {
    vendored = readVendoredRanges(readFileSync(routeFile, "utf8"));
  } catch (err) {
    vendored = { ok: false, reason: `could not read ${routeFile}: ${err?.message ?? String(err)}` };
  }
  const live = vendored.ok ? await fetchLiveRanges(fetchImpl) : { ok: false, reason: "not attempted" };
  const outcome = compare({ vendored, live });
  for (const line of report(outcome)) console.log(line);
  return classify(outcome);
}

// Only run when executed directly, so importing this from a test does nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
