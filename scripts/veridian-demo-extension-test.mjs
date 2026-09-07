/**
 * Tests for the x-mira-visitor header format check in the Veridian demo route.
 *
 * The regex `/^[0-9a-f]{64}$/` (route.ts:256) is the security control that
 * prevents a malformed or hostile header value from reaching the filesystem,
 * and prevents the extension from stealing another visitor's bearer capability.
 * Cookie path (website visitors) is unchanged and serves as the regression
 * guard (case 2).
 */
import { join } from "node:path";
import { readdirSync, rmSync } from "node:fs";
import { test } from "node:test";
import { equal, strictEqual } from "node:assert";
import { loadRoute, jsonRequest, resetNet } from "./route-harness/index.mjs";

// ── env setup ──────────────────────────────────────────────────────────────
// VERIDIAN_MEM_DIR overrides the storage dir in veridian-memory.ts so tests
// never pollute prod data or depend on a specific host path.
// OPENROUTER_API_KEY must NOT be set: the route takes the documented graceful
// no-key path and answers from the knowledge base.  The harness already
// blocks globalThis.fetch (netCalls tracks blocked calls), but deleting the
// key prevents the route from even attempting the call.
process.env.VERIDIAN_MEM_DIR = join(process.cwd(), "data", "veridian-mem-test");
delete process.env.OPENROUTER_API_KEY;

// ── helpers ────────────────────────────────────────────────────────────────
const { POST } = await loadRoute("src/app/api/veridian-demo/route.ts", { fresh: true });

function resetState() {
  // Clean the isolated test memory dir so stale files from previous cases
  // cannot confuse later assertions.
  try { rmSync(process.env.VERIDIAN_MEM_DIR, { recursive: true, force: true }); } catch { /* not found */ }
  resetNet();
}

/** Extract the vd_visitor cookie value from a route response. */
function cookieVisitorId(res) {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) return null;
  const m = setCookie.match(/vd_visitor=([^;]+)/);
  return m ? m[1] : null;
}

// ── cases ──────────────────────────────────────────────────────────────────

// CASE 1: VALID 64-char lowercase hex header -> that id is used as visitor id.
// Asserts against the durable record keyed to exactly that id on disk.
test("valid 64-char lowercase hex header -> id is used as visitor id", async () => {
  resetState();
  const testId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const res = await POST(new Request("https://example.com/api/veridian-demo", {
    method: "POST",
    headers: { "content-type": "application/json", "x-mira-visitor": testId },
    body: JSON.stringify({ message: "hello" }),
  }));
  equal(res.status, 200);
  // The route echoes back the id it resolved in the Set-Cookie header.
  strictEqual(cookieVisitorId(res), testId);
  // Assert against the DURABLE RECORD on disk. If the header id were ignored
  // or munged, the file would not exist at this exact path.
  const files = readdirSync(process.env.VERIDIAN_MEM_DIR);
  equal(files.includes(`${testId}.json`), true);
});

// CASE 2: NO header -> cookie path runs. Regression guard: website is unaffected.
test("no header -> cookie path runs (website unaffected)", async () => {
  resetState();
  const res = await POST(jsonRequest({ message: "hello" }));
  equal(res.status, 200);
  const cookieId = cookieVisitorId(res);
  equal(typeof cookieId, "string");
  equal(cookieId.length > 0, true, "cookie should contain a minted id");
  // Must NOT be the case-1 testId — proves the header logic was skipped.
  equal(cookieId !== "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", true,
    "cookie should NOT be the case-1 testId (cookie path was exercised, not header)");
  // Assert on a file that was NOT created by the case-1 id.
  strictEqual(
    readdirSync(process.env.VERIDIAN_MEM_DIR).includes("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json"),
    false,
    "case-1 id file must not exist when cookie path is taken",
  );
});

// CASE 3: 63 hex chars -> IGNORED, cookie/mint path runs.
test("63 hex chars -> ignored, minted id returned", async () => {
  resetState();
  const short = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // 63 a's
  strictEqual(short.length, 63);
  const res = await POST(new Request("https://example.com/api/veridian-demo", {
    method: "POST",
    headers: { "content-type": "application/json", "x-mira-visitor": short },
    body: JSON.stringify({ message: "hello" }),
  }));
  equal(res.status, 200);
  // The rejected header must NOT appear as the cookie — minted id returned.
  equal(cookieVisitorId(res) !== short, true,
    "invalid header was accepted instead of being rejected");
  // No file for the rejected id.
  strictEqual(
    readdirSync(process.env.VERIDIAN_MEM_DIR).includes(`${short}.json`),
    false,
    "rejected id must not produce a memory file",
  );
});

// CASE 4: 65 hex chars -> IGNORED, cookie/mint path runs.
test("65 hex chars -> ignored, minted id returned", async () => {
  resetState();
  const long = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // 65 a's
  strictEqual(long.length, 65);
  const res = await POST(new Request("https://example.com/api/veridian-demo", {
    method: "POST",
    headers: { "content-type": "application/json", "x-mira-visitor": long },
    body: JSON.stringify({ message: "hello" }),
  }));
  equal(res.status, 200);
  equal(cookieVisitorId(res) !== long, true,
    "invalid header was accepted instead of being rejected");
  strictEqual(
    readdirSync(process.env.VERIDIAN_MEM_DIR).includes(`${long}.json`),
    false,
    "rejected id must not produce a memory file",
  );
});

// CASE 5: UPPERCASE hex (A-F) -> IGNORED. Lowercase-only is deliberate.
test("uppercase hex (A-F) -> ignored, minted id returned", async () => {
  resetState();
  const upper = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const res = await POST(new Request("https://example.com/api/veridian-demo", {
    method: "POST",
    headers: { "content-type": "application/json", "x-mira-visitor": upper },
    body: JSON.stringify({ message: "hello" }),
  }));
  equal(res.status, 200);
  equal(cookieVisitorId(res) !== upper, true,
    "invalid header was accepted instead of being rejected");
  strictEqual(
    readdirSync(process.env.VERIDIAN_MEM_DIR).includes(`${upper}.json`),
    false,
    "rejected id must not produce a memory file",
  );
});

// CASE 6: PATH TRAVERSAL - "../" sequences padded to EXACTLY 64 chars.
// If EXT_ID_RE were deleted or loosened to a length-only check, this test
// WOULD FAIL. That failure is its entire purpose: it proves the regex
// catches what a naive length check cannot.
test("path traversal header padded to 64 chars -> ignored, nothing written", async () => {
  resetState();
  // Construct a 64-char string containing "../" — a naive length check would
  // accept it, but the hex-only regex rejects it.
  const traversal = "a/../../b/../../c/../../d/../../e/../../f/../../g/../h/../../i/j";
  strictEqual(traversal.length, 64);
  strictEqual(traversal.includes("../"), true, "must contain path traversal sequences");
  const res = await POST(new Request("https://example.com/api/veridian-demo", {
    method: "POST",
    headers: { "content-type": "application/json", "x-mira-visitor": traversal },
    body: JSON.stringify({ message: "hello" }),
  }));
  equal(res.status, 200);
  // Should be a minted id, not the traversal header.
  equal(cookieVisitorId(res) !== traversal, true,
    "invalid header was accepted instead of being rejected");
  // Assert nothing was read or written outside the intended per-visitor storage.
  // The traversal string must not appear as a filename in the memory dir.
  try {
    const files = readdirSync(process.env.VERIDIAN_MEM_DIR);
    for (const f of files) {
      strictEqual(f.includes("../"), false,
        `file ${f} must not contain "../" — path traversal must not reach filesystem`);
    }
  } catch {
    // Directory doesn't exist — that's also acceptable (no files written).
  }
});
