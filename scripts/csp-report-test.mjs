/**
 * Tests for the CSP violation sink.
 *
 * The one that matters is "script-sample is NEVER stored". That field can
 * carry page content, and this endpoint is unauthenticated by necessity -
 * browsers post to it with no credentials - so anything it writes to disk is
 * written on the word of a stranger. If that test ever fails, the endpoint is
 * an exfiltration sink, not a diagnostic.
 */
import { join } from "node:path";
import { readFileSync, unlinkSync } from "node:fs";
import { test } from "node:test";
import { equal, strictEqual } from "node:assert";
import { loadRoute, jsonRequest } from "./route-harness/index.mjs";

const REPORT_FILE = process.env.CSP_REPORT_FILE || join(process.cwd(), "data", "csp-reports.jsonl");

function resetFile() {
  try { unlinkSync(REPORT_FILE); } catch { /* not there yet */ }
}

const { POST } = await loadRoute("src/app/api/csp-report/route.ts");

test("legacy shape - extracts correct fields", async () => {
  resetFile();
  const body = {
    "csp-report": {
      "blocked-uri": "https://evil.com/script.js",
      "violated-directive": "script-src",
      "document-uri": "https://example.com/page",
      "disposition": "enforce",
      "line-number": 42,
      "source-file": "https://example.com/app.js",
    },
  };
  const res = await POST(jsonRequest(body));
  equal(res.status, 204);
  const lines = readFileSync(REPORT_FILE, "utf8").trim().split("\n");
  const record = JSON.parse(lines[0]);
  strictEqual(record.blockedUri, "https://evil.com/script.js");
  strictEqual(record.violatedDirective, "script-src");
  strictEqual(record.documentUri, "https://example.com/page");
  strictEqual(record.disposition, "enforce");
  strictEqual(record.lineNumber, "42");
  strictEqual(record.sourceFile, "https://example.com/app.js");
  equal(typeof record.receivedAt, "string");
});

test("array shape - normalizes Reporting API format (camelCase body)", async () => {
  // The REAL Reporting API vocabulary. The previous version of this test paired
  // the array envelope with kebab-case keys - a combination no browser sends -
  // so it passed while production stored thirteen rows of empty strings.
  resetFile();
  const body = [
    {
      body: {
        blockedURL: "https://bad.com/img.png",
        effectiveDirective: "img-src",
        documentURL: "https://example.com/gallery",
        disposition: "report",
        statusCode: 404,
        lineNumber: 17,
        sourceFile: "https://example.com/gallery.js",
      },
    },
  ];
  const res = await POST(jsonRequest(body));
  equal(res.status, 204);
  const lines = readFileSync(REPORT_FILE, "utf8").trim().split("\n");
  const record = JSON.parse(lines[0]);
  strictEqual(record.blockedUri, "https://bad.com/img.png");
  strictEqual(record.violatedDirective, "img-src");
  strictEqual(record.documentUri, "https://example.com/gallery");
  strictEqual(record.disposition, "report");
  strictEqual(record.statusCode, "404");
  strictEqual(record.lineNumber, "17");
  strictEqual(record.sourceFile, "https://example.com/gallery.js");
  equal(typeof record.receivedAt, "string");
});

test("413 when body exceeds 65536 characters", async () => {
  resetFile();
  const big = "x".repeat(65537);
  const res = await POST(new Request("https://example.com/api/csp-report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: big,
  }));
  equal(res.status, 413);
});

test("script-sample is NEVER stored", async () => {
  resetFile();
  const body = {
    "csp-report": {
      "blocked-uri": "https://evil.com/x.js",
      "script-sample": "doNotStoreThisSensitiveSample",
      "disposition": "enforce",
    },
  };
  const res = await POST(jsonRequest(body));
  equal(res.status, 204);
  const raw = readFileSync(REPORT_FILE, "utf8");
  // Assert on the RAW FILE, not just the parsed key: the sample must not reach
  // the disk under any key name, including one added later.
  equal(raw.includes("doNotStoreThisSensitiveSample"), false);
  const record = JSON.parse(raw.trim().split("\n")[0]);
  strictEqual(record.scriptSample, undefined);
});

test("malformed JSON returns 204 without error", async () => {
  resetFile();
  const res = await POST(new Request("https://example.com/api/csp-report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{ not valid json [[[",
  }));
  equal(res.status, 204);
});

test("success case - returns 204 and writes one line per report", async () => {
  resetFile();
  const body = [
    { body: { "blocked-uri": "https://a.com/1", "disposition": "report" } },
    { body: { "blocked-uri": "https://a.com/2", "disposition": "enforce" } },
  ];
  const res = await POST(jsonRequest(body));
  equal(res.status, 204);
  const lines = readFileSync(REPORT_FILE, "utf8").trim().split("\n");
  equal(lines.length, 2);
  resetFile();
});

test("Reporting API numeric fields - lineNumber 42 arrives as a NUMBER and stores as \"42\"", async () => {
  // statusCode and lineNumber are numbers in a real Reporting API body. A
  // truncate() that returned "" for non-strings would silently reproduce the
  // original bug for exactly these two fields and nothing else.
  resetFile();
  const body = [
    {
      body: {
        blockedURL: "https://bad.com/x.js",
        effectiveDirective: "script-src",
        documentURL: "https://example.com/page",
        disposition: "report",
        lineNumber: 42,
        statusCode: 200,
      },
    },
  ];
  const res = await POST(jsonRequest(body));
  equal(res.status, 204);
  const lines = readFileSync(REPORT_FILE, "utf8").trim().split("\n");
  const record = JSON.parse(lines[0]);
  strictEqual(record.lineNumber, "42");
  strictEqual(record.statusCode, "200");
});

test("neither \"sample\" nor \"script-sample\" ever reaches disk", async () => {
  // "sample" is the camelCase twin of "script-sample". Both can carry page
  // content. Asserted against the RAW line so a value smuggled in under some
  // other key still trips it.
  resetFile();
  const body = [
    {
      body: {
        blockedURL: "https://evil.com/x.js",
        disposition: "enforce",
        sample: "doNotStoreThisSample",
        "script-sample": "doNotStoreThisScriptSample",
      },
    },
  ];
  const res = await POST(jsonRequest(body));
  equal(res.status, 204);
  const raw = readFileSync(REPORT_FILE, "utf8");
  equal(raw.includes("doNotStoreThisSample"), false);
  equal(raw.includes("doNotStoreThisScriptSample"), false);
});
