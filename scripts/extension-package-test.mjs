/**
 * Permanent gate for extension/ invariants.
 *
 * Every assertion was verified by hand once; without a test they will rot on
 * the next edit. Run via `node scripts/extension-package-test.mjs` or let the
 * runner glob scripts/*-test.mjs.
 *
 * Uses ONLY node built-ins (node:test, node:assert, node:fs, node:path,
 * node:child_process, node:util). No external deps.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { equal, strictEqual, deepStrictEqual, ok } from "node:assert";

// ── helpers ──────────────────────────────────────────────────────────────────

const EXT = join(dirname(fileURLToPath(import.meta.url)), "..", "extension");

function read(relative) {
  return readFileSync(join(EXT, relative), "utf8");
}

function exists(relative) {
  return existsSync(join(EXT, relative));
}

/**
 * Strip comment lines from a file's content before scanning for forbidden
 * patterns.  Returns only non-comment lines so deliberate explanatory
 * comments (e.g. naming innerHTML as forbidden in sidepanel.js) don't
 * trigger false positives.
 */
function stripComments(content, fileExt) {
  return content
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      if (fileExt === ".js" || fileExt === ".mjs") {
        return !(trimmed.startsWith("//") || trimmed.startsWith("*"));
      }
      if (fileExt === ".html" || fileExt === ".htm") {
        return !trimmed.includes("<!--");
      }
      return true;
    })
    .join("\n");
}

/**
 * Parse PNG bytes 16..29 (IHDR chunk) to extract colourType (byte 23) and
 * bitDepth (bytes 21..22).  The first 8 bytes are the PNG magic number.
 */
function parseIhdr(buf) {
  // 8-byte PNG signature
  const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  ok(buf.slice(0, 8).equals(magic), "PNG signature mismatch");
  // IHDR starts at byte 8; length field at 8..11 = 13 (0x0000000d)
  const ihdrLength = buf.readUInt32BE(8);
  ok(ihdrLength > 0, "IHDR length must be > 0");
  // IHDR data starts at byte 16: width(16-19) height(20-23) bitDepth(24) colourType(25)
  const colourType = buf.readUInt8(25);
  const bitDepth = buf.readUInt8(24);
  return { colourType, bitDepth };
}

// ── load manifest ────────────────────────────────────────────────────────────

const manifest = JSON.parse(read("manifest.json"));

// ── tests ────────────────────────────────────────────────────────────────────

test("manifest_version is 3 (not 2 — MV2 is deprecated and insecure)", () => {
  // Policy: least privilege — only use the modern API surface.
  strictEqual(manifest.manifest_version, 3);
});

test('permissions is EXACTLY ["sidePanel","storage"] — no more, no fewer', () => {
  // Policy: least privilege — only request permissions the extension uses.
  const expected = ["sidePanel", "storage"];
  const actual = manifest.permissions;
  strictEqual(Array.isArray(actual), true);
  strictEqual(actual.length, expected.length, `permissions length: expected ${expected.length}, got ${actual.length}`);
  for (const p of expected) {
    ok(actual.includes(p), `permissions missing "${p}". Actual: [${actual.join(", ")}]`);
  }
});

test('host_permissions is EXACTLY ["https://mira.vualet.com/api/veridian-demo", "https://mira.vualet.com/api/veridian-voice"] — nothing more', () => {
  // Policy: least privilege — only talk to one origin.
  const expected = ["https://mira.vualet.com/api/veridian-demo", "https://mira.vualet.com/api/veridian-voice"];
  const actual = manifest.host_permissions;
  strictEqual(Array.isArray(actual), true);
  strictEqual(actual.length, expected.length, `host_permissions length: expected ${expected.length}, got ${actual.length}`);
  for (const h of expected) {
    ok(actual.includes(h), `host_permissions missing "${h}". Actual: [${actual.join(", ")}]`);
  }
});

test("manifest declares NONE of the forbidden optional fields", () => {
  // Policy: minimal attack surface — no content scripts, no web access,
  // no external connections, no persistent key, no DPR rules.
  const forbidden = [
    "content_scripts",
    "web_accessible_resources",
    "externally_connectable",
    "optional_permissions",
    "declarative_net_request",
    "key",
  ];
  for (const key of forbidden) {
    strictEqual(
      Object.hasOwn(manifest, key),
      false,
      `Unexpected field "${key}" in manifest`,
    );
  }
});

test("content_security_policy.extension_pages is the strict V3 CSP", () => {
  // Policy: Manifest V3 CSP — model-generated replies must never become
  // inline script or object eval. Only self-hosted scripts; no objects.
  strictEqual(
    manifest.content_security_policy?.extension_pages,
    "script-src 'self'; object-src 'none'",
  );
});

test("manifest.description length <= 132 characters (Chrome Web Store limit)", () => {
  equal(manifest.description.length <= 132, true,
    `description is ${manifest.description.length} chars, must be <= 132`);
});

test("every file path referenced in manifest.json EXISTS on disk", () => {
  // Check icons at every size, background.service_worker, side_panel.default_path.
  const paths = [];
  // action.default_icon.*
  if (manifest.action?.default_icon) {
    for (const _size of Object.values(manifest.action.default_icon)) {
      paths.push(_size);
    }
  }
  // icons.*
  if (manifest.icons) {
    for (const _size of Object.values(manifest.icons)) {
      paths.push(_size);
    }
  }
  // background.service_worker
  if (manifest.background?.service_worker) {
    paths.push(manifest.background.service_worker);
  }
  // side_panel.default_path
  if (manifest.side_panel?.default_path) {
    paths.push(manifest.side_panel.default_path);
  }
  for (const p of paths) {
    ok(exists(p), `Referenced file "${p}" does not exist under extension/`);
  }
});

test("every icon file is a real PNG (8-byte signature + IHDR colourType=6 RGBA, bitDepth=8)", () => {
  // A JPEG renamed .png would pass a filename check but fail here.
  const iconPaths = [];
  if (manifest.action?.default_icon) {
    for (const _size of Object.values(manifest.action.default_icon)) {
      iconPaths.push(_size);
    }
  }
  if (manifest.icons) {
    for (const _size of Object.values(manifest.icons)) {
      iconPaths.push(_size);
    }
  }
  // Deduplicate
  const seen = new Set();
  const unique = [];
  for (const p of iconPaths) {
    if (!seen.has(p)) { seen.add(p); unique.push(p); }
  }
  for (const p of unique) {
    const buf = readFileSync(join(EXT, p));
    const hdr = parseIhdr(buf);
    strictEqual(hdr.colourType, 6, `${p} colourType=${hdr.colourType}, expected 6 (RGBA)`);
    strictEqual(hdr.bitDepth, 8, `${p} bitDepth=${hdr.bitDepth}, expected 8`);
  }
});

test("NO unsafe patterns in shipped files — sidepanel.js, background.js, sidepanel.html (excluding comment lines)", () => {
  // Policy: the reply is model-generated and must never become markup.
  // eval and document.write enable code injection; innerHTML/insertAdjacentHTML/outerHTML
  // turn untrusted text into DOM (XSS); javascript: URIs execute on navigation.
  const unsafeRe = /eval\s*\(|new\s+Function\s*\(|innerHTML\s*=|insertAdjacentHTML\s*\(|outerHTML\s*=|document\.write\s*\(|javascript:/;
  const files = [
    { path: "sidepanel.js", ext: ".js" },
    { path: "background.js", ext: ".js" },
    { path: "sidepanel.html", ext: ".html" },
  ];
  const violations = [];
  for (const f of files) {
    const raw = read(f.path);
    const lines = raw.split("\n");
    const stripped = stripComments(raw, f.ext);
    const strippedLines = stripped.split("\n");
    // Build a set of line numbers that were stripped (comment lines)
    const strippedSet = new Set();
    let strippedIdx = 0;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      let isComment = false;
      if (f.ext === ".js" || f.ext === ".mjs") {
        isComment = trimmed.startsWith("//") || trimmed.startsWith("*");
      } else if (f.ext === ".html" || f.ext === ".htm") {
        isComment = trimmed.includes("<!--");
      }
      if (isComment) strippedSet.add(i);
    }
    // Re-scan: check the original lines, skipping comment lines
    for (let i = 0; i < lines.length; i++) {
      if (strippedSet.has(i)) continue;
      if (unsafeRe.test(lines[i])) {
        violations.push(`${f.path}:${i + 1}: ${lines[i].trim()}`);
      }
    }
  }
  strictEqual(violations.length, 0,
    violations.length > 0
      ? `Unsafe patterns found:\n${violations.join("\n")}`
      : undefined);
});

test("the only http(s) origins in shipped files are https://mira.vualet.com", () => {
  // Policy: single-origin lock-down — no cross-origin fetches, no redirects.
  const originRe = /https?:\/\/([^/"':\s]+)(?::\d+)?/g;
  const files = ["sidepanel.js", "background.js", "sidepanel.html"];
  const allowed = new Set(["https://mira.vualet.com"]);
  const violations = [];
  for (const f of files) {
    const content = read(f);
    let m;
    while ((m = originRe.exec(content)) !== null) {
      const origin = m[0];
      if (!allowed.has(origin)) {
        violations.push(`${f}: ${origin}`);
      }
    }
  }
  strictEqual(violations.length, 0,
    violations.length > 0
      ? `Disallowed origins found:\n${violations.join("\n")}`
      : undefined);
});

test("every local src=/href= in sidepanel.html resolves to an existing file", () => {
  // Normalise leading "./" before resolving to disk.
  const hrefRe = /(?:src|href)\s*=\s*["']([^"']+)["']/g;
  const content = read("sidepanel.html");
  let m;
  const found = [];
  while ((m = hrefRe.exec(content)) !== null) {
    const val = m[1].replace(/^\.\//, "");
    found.push(val);
    ok(exists(val), `HTML reference "${m[1]}" (normalised "${val}") does not exist`);
  }
  strictEqual(found.length > 0, true, "expected at least one src=/href= in sidepanel.html");
});

test("NO apparent secrets in any shipped file (API keys, private keys, bearer tokens)", () => {
  // A leaked key in the extension is a permanent credential exposure —
  // the extension ships to every user's machine and is visible in DevTools.
  const secretRe = /sk-[A-Za-z0-9]{16,}|"OPENROUTER_API_KEY"|"ELEVENLABS_API_KEY"|BEGIN\s+(RSA\s+|DSA\s+|EC\s+|OPEN\s+)?PRIVATE\s+KEY|"Authorization:\s*Bearer"/i;
  const files = ["sidepanel.js", "background.js", "sidepanel.html"];
  const violations = [];
  for (const f of files) {
    const content = read(f);
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (secretRe.test(lines[i])) {
        violations.push(`${f}:${i + 1}: ${lines[i].trim()}`);
      }
    }
  }
  strictEqual(violations.length, 0,
    violations.length > 0
      ? `Secret patterns found:\n${violations.join("\n")}`
      : undefined);
});
