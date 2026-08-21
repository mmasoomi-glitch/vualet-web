/**
 * Tests for the Cloudflare range drift check.
 *
 * NO NETWORK. Not "we try not to" — the first thing this file does is replace
 * globalThis.fetch with something that throws, so a test that forgot to inject
 * a fake would fail loudly instead of quietly reaching cloudflare.com. The
 * script fetches; its tests use fixtures. That split is the whole contract.
 *
 * The assertion this file exists for is the THIRD exit code. A drift check
 * that cannot reach Cloudflare and exits 0 is worse than no check at all: it
 * retires the question while verifying nothing. So "could not verify" is
 * pinned as its own outcome, in every way it can happen.
 *
 * Run: npm run test:cf-ranges
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ROUTE_FILE,
  SOURCES,
  parseRangeList,
  readVendoredRanges,
  diffRanges,
  classify,
  compare,
  report,
  fetchLiveRanges,
  main,
} from "./cloudflare-ranges-check.mjs";

// ── the network kill switch ───────────────────────────────────────────────
const BLOCKED = () => {
  throw new Error(
    "[cf-ranges-test] BLOCKED outbound fetch — these tests must never touch the network.",
  );
};
globalThis.fetch = BLOCKED;

/** A fake fetch serving fixture text per URL. Records what was asked for. */
function fakeFetch(byUrl) {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    const entry = byUrl[String(url)];
    if (entry === undefined) throw new Error(`unexpected URL ${url}`);
    if (typeof entry === "function") return entry();
    const { status = 200, body = "" } = entry;
    return new Response(body, { status });
  };
  impl.calls = calls;
  return impl;
}

const V4_URL = SOURCES[0].url;
const V6_URL = SOURCES[1].url;

/** Serve exactly these ranges, split across the two published lists. */
const serving = (ranges) =>
  fakeFetch({
    [V4_URL]: { body: ranges.filter((r) => !r.includes(":")).join("\n") + "\n" },
    [V6_URL]: { body: ranges.filter((r) => r.includes(":")).join("\n") + "\n" },
  });

/** Run main() with console.log captured. */
let logged = [];
const realLog = console.log;
beforeEach(() => {
  logged = [];
  console.log = (line) => logged.push(String(line));
});
afterEach(() => {
  console.log = realLog;
});

const runMain = async (fetchImpl, routeFile = ROUTE_FILE) => {
  const code = await main({ fetchImpl, routeFile });
  return { code, text: logged.join("\n") };
};

const VENDORED = readVendoredRanges(readFileSync(ROUTE_FILE, "utf8"));

// ── parsing Cloudflare's published text ──────────────────────────────────

test("p: a normal published list parses", () => {
  const got = parseRangeList("173.245.48.0/20\n103.21.244.0/22\n");
  assert.equal(got.ok, true);
  assert.deepEqual(got.ranges, ["173.245.48.0/20", "103.21.244.0/22"]);
});

test("p: CRLF, blank lines and stray whitespace are tolerated", () => {
  const got = parseRangeList("\r\n 173.245.48.0/20 \r\n\r\n2400:cb00::/32\r\n");
  assert.equal(got.ok, true);
  assert.deepEqual(got.ranges, ["173.245.48.0/20", "2400:cb00::/32"]);
});

test("p: IPv6 is lower-cased so a case change is not reported as drift", () => {
  const got = parseRangeList("2400:CB00::/32");
  assert.deepEqual(got.ranges, ["2400:cb00::/32"]);
});

test("p: an EMPTY response is a failure, not 'zero ranges, all good'", () => {
  // The heart of exit code 2. If empty parsed as a valid list, every vendored
  // range would look STALE — or worse, an empty-vs-empty comparison would look
  // clean — and the check would report on nothing while exiting 0.
  for (const empty of ["", "   ", "\n\n", "\r\n"]) {
    const got = parseRangeList(empty);
    assert.equal(got.ok, false, `${JSON.stringify(empty)} must not parse as a list`);
    assert.match(got.reason, /empty/);
  }
});

test("p: an HTML error page does NOT parse as a range list", () => {
  const got = parseRangeList("<!doctype html>\n<title>502 Bad Gateway</title>\n");
  assert.equal(got.ok, false);
  assert.match(got.reason, /did not look like a CIDR list/);
});

test("p: a list with one non-CIDR line is refused wholesale", () => {
  const got = parseRangeList("173.245.48.0/20\nsomething went wrong\n");
  assert.equal(got.ok, false);
  assert.match(got.reason, /did not look like a CIDR list/);
});

// ── reading the vendored constant out of the route ───────────────────────

test("v: the REAL route's vendored list is readable and is 22 CIDRs", () => {
  // Reads the file, never the network. If someone adds or removes a range this
  // number changes, which should be a deliberate edit, not a silent one.
  assert.equal(VENDORED.ok, true, VENDORED.reason);
  assert.equal(VENDORED.ranges.length, 22);
  for (const r of VENDORED.ranges) {
    assert.match(r, /^[0-9a-f.:]+\/\d{1,3}$/, `${r} must be a CIDR`);
  }
  assert.ok(VENDORED.ranges.includes("104.16.0.0/13"), "a known IPv4 range must be present");
  assert.ok(VENDORED.ranges.includes("2a06:98c0::/29"), "a known IPv6 range must be present");
  assert.equal(VENDORED.ranges.filter((r) => r.includes(":")).length, 7, "7 IPv6 ranges");
  assert.equal(VENDORED.ranges.filter((r) => !r.includes(":")).length, 15, "15 IPv4 ranges");
});

test("v: the documentation URLs inside the array are NOT mistaken for ranges", () => {
  const src = [
    "const CLOUDFLARE_RANGES: readonly string[] = [",
    "  // IPv4 — https://www.cloudflare.com/ips-v4",
    '  "104.16.0.0/13",',
    "  // IPv6 — https://www.cloudflare.com/ips-v6",
    '  "2400:cb00::/32",',
    "];",
  ].join("\n");
  const got = readVendoredRanges(src);
  assert.deepEqual(got.ranges, ["104.16.0.0/13", "2400:cb00::/32"]);
});

test("v: a route with no CLOUDFLARE_RANGES at all is 'could not verify', not 'clean'", () => {
  const got = readVendoredRanges("export const nothing = 1;\n");
  assert.equal(got.ok, false);
  assert.match(got.reason, /could not find/);
  assert.equal(classify(compare({ vendored: got, live: { ok: true, ranges: [] } })), 2);
});

test("v: an emptied vendored list is refused rather than compared as zero", () => {
  const got = readVendoredRanges("const CLOUDFLARE_RANGES: readonly string[] = [\n];\n");
  assert.equal(got.ok, false);
});

// ── the two directions of drift ──────────────────────────────────────────

test("d: MISSING and STALE are reported as separate, opposite facts", () => {
  const d = diffRanges(["a/1", "shared/2"], ["shared/2", "b/3"]);
  assert.deepEqual(d.missing, ["b/3"], "Cloudflare has it, we do not");
  assert.deepEqual(d.stale, ["a/1"], "we have it, Cloudflare dropped it");
});

test("d: an identical pair in a different ORDER is not drift", () => {
  const d = diffRanges(["a/1", "b/2"], ["b/2", "a/1"]);
  assert.deepEqual(d.missing, []);
  assert.deepEqual(d.stale, []);
});

test("d: the report names the CONSEQUENCE of each direction, not just the diff", () => {
  const added = report({ ok: true, missing: ["1.2.3.0/24"], stale: [], vendoredCount: 22, liveCount: 23 });
  const text = added.join("\n");
  assert.match(text, /MISSING \(1\)/);
  assert.match(text, /\+ 1\.2\.3\.0\/24/);
  assert.match(text, /collapse into shared/, "must say what a missing range costs");
  assert.doesNotMatch(text, /STALE/, "a clean direction must not be printed");

  const dropped = report({ ok: true, missing: [], stale: ["9.9.9.0/24"], vendoredCount: 22, liveCount: 21 });
  const text2 = dropped.join("\n");
  assert.match(text2, /STALE \(1\)/);
  assert.match(text2, /- 9\.9\.9\.0\/24/);
  assert.match(text2, /fails open/, "must say what a stale range costs");
  assert.doesNotMatch(text2, /MISSING/);
});

// ── exit codes ───────────────────────────────────────────────────────────

test("x: 0 only when the lists match exactly", async () => {
  const { code, text } = await runMain(serving(VENDORED.ranges));
  assert.equal(code, 0, text);
  assert.match(text, /^OK — the vendored list matches Cloudflare exactly \(22 ranges/m);
});

test("x: 1 when Cloudflare ADDS a range we do not have", async () => {
  const { code, text } = await runMain(serving([...VENDORED.ranges, "203.0.113.0/24"]));
  assert.equal(code, 1);
  assert.match(text, /MISSING \(1\)/);
  assert.match(text, /\+ 203\.0\.113\.0\/24/);
});

test("x: 1 when Cloudflare DROPS a range we still list", async () => {
  const { code, text } = await runMain(serving(VENDORED.ranges.filter((r) => r !== "104.16.0.0/13")));
  assert.equal(code, 1);
  assert.match(text, /STALE \(1\)/);
  assert.match(text, /- 104\.16\.0\.0\/13/);
});

test("x: 1 reports BOTH directions at once when both have drifted", async () => {
  const live = [...VENDORED.ranges.filter((r) => r !== "104.16.0.0/13"), "203.0.113.0/24"];
  const { code, text } = await runMain(serving(live));
  assert.equal(code, 1);
  assert.match(text, /MISSING \(1\)/);
  assert.match(text, /STALE \(1\)/);
});

test("x: 2 — THE ONE THAT MATTERS — a run that verified nothing is never a pass", async () => {
  // Every way the check can fail to actually check. None of them may return 0,
  // and every one must say plainly that nothing was compared.
  const cases = [
    ["network error", fakeFetch({ [V4_URL]: () => { throw new Error("ENOTFOUND"); } })],
    ["HTTP 500", fakeFetch({ [V4_URL]: { status: 500, body: "" } })],
    ["HTTP 403", fakeFetch({ [V4_URL]: { status: 403, body: "denied" } })],
    ["empty body", fakeFetch({ [V4_URL]: { body: "" } })],
    ["HTML error page", fakeFetch({ [V4_URL]: { body: "<!doctype html><h1>502</h1>" } })],
    [
      "IPv6 list fails even though IPv4 succeeded",
      fakeFetch({
        [V4_URL]: { body: VENDORED.ranges.filter((r) => !r.includes(":")).join("\n") },
        [V6_URL]: { status: 500, body: "" },
      }),
    ],
  ];

  for (const [name, impl] of cases) {
    logged = [];
    const { code, text } = await runMain(impl);
    assert.equal(code, 2, `${name} must exit 2, got ${code}`);
    assert.match(text, /^COULD NOT VERIFY —/m, `${name} must say so`);
    assert.match(text, /Do not read this as a pass/, `${name} must refuse to be read as clean`);
    assert.doesNotMatch(text, /^OK —/m, `${name} must not print a success line`);
  }
});

test("x: 2 when the ROUTE cannot be read, and Cloudflare is not even contacted", async () => {
  // No point asking Cloudflare anything if we have nothing to compare against —
  // and reporting "clean" here would be the worst possible answer.
  const impl = fakeFetch({});
  const { code, text } = await runMain(impl, ROUTE_FILE + ".does-not-exist");
  assert.equal(code, 2);
  assert.match(text, /COULD NOT VERIFY/);
  assert.match(text, /Do not read this as a pass/);
  assert.deepEqual(impl.calls, [], "a pointless fetch must not be made");
});

// ── the no-network contract ──────────────────────────────────────────────

test("n: main() asks for EXACTLY the two published lists and nothing else", async () => {
  const impl = serving(VENDORED.ranges);
  await runMain(impl);
  assert.deepEqual(impl.calls, [V4_URL, V6_URL]);
});

test("n: the real global fetch is still the blocked one — no test reached the network", async () => {
  // If any test above had leaned on the default fetch, it would have thrown.
  assert.equal(globalThis.fetch, BLOCKED);
  const live = await fetchLiveRanges();
  assert.equal(live.ok, false, "an un-injected call must fail, not silently succeed");
  assert.match(live.reason, /BLOCKED outbound fetch/);
});
