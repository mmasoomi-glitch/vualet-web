#!/usr/bin/env node
// package.mjs — Build ONE clean Chrome Web Store submission ZIP from extension/.
//
// ALLOWLIST — build the archive from this explicit list, never by walking the
// directory and excluding.  A denylist ships whatever nobody thought to exclude,
// and this artefact goes to a third party.
//
// ZIP is written by hand with node:zlib.deflateRawSync — local file headers,
// then the central directory, then the end-of-central-directory record.
// Forward-slash relative paths, no absolute paths, no separate directory
// entries.  Fixed DOS timestamp for reproducibility.
//
// Run:  node extension/tools/package.mjs

import { readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";

// ── Paths ────────────────────────────────────────────────────────────────────
const EXT = resolve("extension");
const DIST = join(EXT, "dist");

// ── Allowlist ────────────────────────────────────────────────────────────────
const ALLOWLIST = [
  "manifest.json",
  "background.js",
  "sidepanel.html",
  "sidepanel.css",
  "sidepanel.js",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png",
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function readText(rel) {
  try { return readFileSync(join(EXT, rel), "utf-8"); } catch { return null; }
}

// ── CHECK 1: every allowlisted file exists and is non-empty ──────────────────
{
  const missing = [];
  for (const f of ALLOWLIST) {
    const p = join(EXT, f);
    try {
      const s = statSync(p);
      if (s.size === 0) missing.push(f + " (empty)");
    } catch {
      missing.push(f + " (not found)");
    }
  }
  if (missing.length) {
    console.error("FAIL [1] missing or empty: " + missing.join(", "));
    process.exit(1);
  }
}

// ── CHECK 2: manifest.json parses and manifest_version === 3 ─────────────────
let manifest;
try {
  manifest = JSON.parse(readText("manifest.json"));
} catch {
  console.error("FAIL [2] manifest.json is not valid JSON");
  process.exit(1);
}
if (manifest.manifest_version !== 3) {
  console.error("FAIL [2] manifest_version is " + manifest.manifest_version + ", expected 3");
  process.exit(1);
}
const VERSION = manifest.version || "0.0.0";

// ── CHECK 3: every icon path in manifest exists AND begins with PNG signature ─
{
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  function getIconPaths(m) {
    const paths = [];
    // MV3: action.default_icon (can be string or {size: path})
    if (m.action?.default_icon) {
      if (typeof m.action.default_icon === "string") paths.push(m.action.default_icon);
      else for (const v of Object.values(m.action.default_icon)) paths.push(v);
    }
    // MV2 fallback: icons field
    if (m.icons) {
      if (Array.isArray(m.icons)) {
        for (const it of m.icons) paths.push(typeof it === "string" ? it : it["128"] || it["48"] || it["32"] || it["16"]);
      } else {
        for (const v of Object.values(m.icons)) paths.push(typeof v === "string" ? v : v["128"] || v["48"] || v["32"] || v["16"]);
      }
    }
    return paths.filter(Boolean);
  }

  const iconPaths = getIconPaths(manifest);
  const badIcons = [];
  for (const p of iconPaths) {
    const full = join(EXT, p);
    try {
      const buf = readFileSync(full);
      if (buf.length < 8 || !buf.slice(0, 8).equals(PNG_SIG)) {
        badIcons.push(p + " (not a PNG — first 8 bytes: " + buf.slice(0, 8).toString("hex") + ")");
      }
    } catch {
      badIcons.push(p + " (not found)");
    }
  }
  if (badIcons.length) {
    console.error("FAIL [3] icon check: " + badIcons.join(", "));
    process.exit(1);
  }
}

// ── CHECK 4: sidepanel.html references only allowlisted local resources ──────
{
  const spHtml = readText("sidepanel.html");
  const htmlRefs = [...spHtml.matchAll(/(?:href|src)\s*=\s*"([^"]+)"/gi)].map(m => m[1]);
  const localRefs = htmlRefs.filter(r => !/^https?:\/\//.test(r) && !r.startsWith("data:") && !r.startsWith("#"));
  const badRefs = localRefs.filter(r => !ALLOWLIST.includes(r));
  if (badRefs.length) {
    console.error("FAIL [4] sidepanel.html references local files not in allowlist: " + badRefs.join(", "));
    process.exit(1);
  }
}

// ── CHECK 5: scan for dangerous patterns (comments do NOT count) ─────────────
{
  const DANGEROUS_PATTERNS = [
    { re: /["']eval\s*\(/i, label: 'eval(' },
    { re: /new\s+Function\s*\(/i, label: 'new Function(' },
    { re: /\binnerHTML\b/, label: 'innerHTML' },
    { re: /\binsertAdjacentHTML\b/, label: 'insertAdjacentHTML' },
    { re: /\bouterHTML\b/, label: 'outerHTML' },
    { re: /\bdocument\.write\b/, label: 'document.write' },
    { re: /\bjavascript\s*:/i, label: 'javascript:' },
  ];
  const TRUSTED_ORIGIN = "https://mira.vualet.com";

  const FILES_TO_SCAN = ["sidepanel.js", "background.js", "sidepanel.html"];
  const findings = [];

  for (const fname of FILES_TO_SCAN) {
    const content = readText(fname);
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const lineNum = i + 1;

      // Remove full-line comments (// ...) and inline comments.
      // We strip the comment portion but keep the code portion for scanning.
      // For block comments we remove everything between /* and */.
      let stripped = rawLine;
      // Single-line block comments: remove /* ... */
      stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, "");
      // Line comments: remove // ... to end of line
      const commentIdx = stripped.indexOf("//");
      if (commentIdx >= 0) stripped = stripped.slice(0, commentIdx);

      // Check each pattern
      for (const { re, label } of DANGEROUS_PATTERNS) {
        re.lastIndex = 0;
        if (re.test(stripped)) {
          findings.push(`${fname}:${lineNum} — ${label}`);
        }
      }

      // Check for non-trusted https:// or http:// URLs
      const urlMatches = stripped.match(/"(https?:\/\/[^"]+)"/g);
      if (urlMatches) {
        for (const url of urlMatches) {
          const originMatch = url.match(/^(https?:\/\/[^/]+)/);
          if (originMatch && originMatch[1] !== TRUSTED_ORIGIN) {
            findings.push(`${fname}:${lineNum} — untrusted URL: ${url}`);
          }
        }
      }
    }
  }

  if (findings.length) {
    console.error("FAIL [5] dangerous patterns:");
    for (const f of findings) console.error("  " + f);
    process.exit(1);
  }
}

// ── CHECK 6: scan for secrets in any allowlisted file ────────────────────────
{
  const SECRET_RE = [
    /sk-[A-Za-z0-9]{16,}/,
    /OPENROUTER_API_KEY/,
    /ELEVENLABS_API_KEY/,
    /BEGIN PRIVATE KEY/,
    /Authorization:\s*Bearer\s+/i,
  ];

  for (const f of ALLOWLIST) {
    const content = readText(f);
    for (const re of SECRET_RE) {
      re.lastIndex = 0;
      if (re.test(content)) {
        console.error("FAIL [6] secret found in " + f + " matching /" + re.source + "/");
        process.exit(1);
      }
    }
  }
}

// ── CHECK 7: permissions tripwire ────────────────────────────────────────────
{
  const expectedPermissions = ["sidePanel", "storage"];
  const actualPermissions = manifest.permissions || [];
  const permSorted = [...actualPermissions].sort();
  const expectedSorted = [...expectedPermissions].sort();
  if (JSON.stringify(permSorted) !== JSON.stringify(expectedSorted)) {
    console.error("FAIL [7] permissions are " + JSON.stringify(permSorted) +
      ", expected " + JSON.stringify(expectedSorted));
    process.exit(1);
  }

  const expectedHostPerms = ["https://mira.vualet.com/*"];
  const actualHostPerms = manifest.host_permissions || [];
  const hpSorted = [...actualHostPerms].sort();
  const expectedHpSorted = [...expectedHostPerms].sort();
  if (JSON.stringify(hpSorted) !== JSON.stringify(expectedHpSorted)) {
    console.error("FAIL [7] host_permissions are " + JSON.stringify(hpSorted) +
      ", expected " + JSON.stringify(expectedHpSorted));
    process.exit(1);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ALL CHECKS PASSED — BUILD THE ZIP
// ══════════════════════════════════════════════════════════════════════════════

/**
 * CRC-32 lookup table.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * DOS date/time for reproducibility.
 * Fixed to 2026-09-07 00:00:00 (arbitrary but constant).
 *
 * DOS time:  bits 0-4  = seconds/2,  5-10 = minutes,  11-15 = hours
 * DOS date:  bits 0-4  = day,          5-8  = month,   9-15 = year-1980
 */
const DOS_TIME = ((0 >>> 1) << 11) | (0 << 5) | (0 >>> 1);  // 00:00:00 → 0x0000
const DOS_DATE = (7) | (9 << 5) | ((2026 - 1980) << 9);      // 2026-09-07 → 0x4C77

// ── Collect file entries ─────────────────────────────────────────────────────
const FILES = [];

for (const f of ALLOWLIST) {
  const data = readFileSync(join(EXT, f));
  const compressed = deflateRawSync(data);
  const crcVal = crc32(data);
  FILES.push({
    name: f,
    data,
    compressed,
    size: data.length,
    compressedSize: compressed.length,
    crc: crcVal,
  });
}

// ── Calculate total ZIP size ─────────────────────────────────────────────────
// For each file: local header (30 + nameLen) + compressed data
// Then: central dir records (46 + nameLen) each
// Then: end-of-central-directory (22)
function zipSize(files) {
  let s = 0;
  for (const f of files) s += 30 + f.name.length + f.compressedSize;
  for (const f of files) s += 46 + f.name.length;
  s += 22;
  return s;
}
const TOTAL_SIZE = zipSize(FILES);
const ZIP = Buffer.alloc(TOTAL_SIZE);

// ── Write local file headers + compressed data ───────────────────────────────
let pos = 0;
const fileStartOffsets = [];

for (const f of FILES) {
  fileStartOffsets.push(pos);

  // Local file header — 30 bytes fixed + variable name
  // Signature     4B  0x04034b50 (local file header signature)
  // Version       2B  20 (2.0 = deflate works everywhere)
  // Flags         2B  0 (no encryption, no span)
  // Method        2B  8  (deflate)
  // ModTime       2B  DOS time (fixed for reproducibility)
  // ModDate       2B  DOS date  (fixed for reproducibility)
  // CRC-32        4B
  // Compressed    4B
  // Uncompressed  4B
  // NameLen       2B
  // ExtraLen      2B  0 (no extra field)
  ZIP.writeUInt32LE(0x04034b50, pos);      // signature
  ZIP.writeUInt16LE(20, pos + 4);           // version needed
  ZIP.writeUInt16LE(0, pos + 6);            // flags
  ZIP.writeUInt16LE(8, pos + 8);            // compression method: deflate
  ZIP.writeUInt16LE(DOS_TIME, pos + 10);    // mod time (fixed)
  ZIP.writeUInt16LE(DOS_DATE, pos + 12);    // mod date  (fixed)
  ZIP.writeUInt32LE(f.crc, pos + 14);       // CRC-32
  ZIP.writeUInt32LE(f.compressedSize, pos + 18); // compressed size
  ZIP.writeUInt32LE(f.size, pos + 22);           // uncompressed size
  ZIP.writeUInt16LE(f.name.length, pos + 26);    // file name length
  ZIP.writeUInt16LE(0, pos + 28);                  // extra field length

  // File name (no directory entries — names are relative paths like "icons/icon16.png")
  for (let i = 0; i < f.name.length; i++) {
    ZIP[pos + 30 + i] = f.name.charCodeAt(i);
  }

  // Compressed data immediately follows the header
  f.compressed.copy(ZIP, pos + 30 + f.name.length);

  pos += 30 + f.name.length + f.compressedSize;
}

// ── Write central directory ──────────────────────────────────────────────────
// Central directory records sit after all local file entries.
// Each record:
//   Signature     4B  0x02014b50
//   VersionMadeBy 2B  20  (Unix-ish, doesn't matter for Chrome)
//   VersionNeeded 2B  20
//   Flags         2B  0
//   Method        2B  8
//   ModTime       2B  DOS time (fixed)
//   ModDate       2B  DOS date  (fixed)
//   CRC-32        4B
//   Compressed    4B
//   Uncompressed  4B
//   NameLen       2B
//   ExtraLen      2B  0
//   CommentLen    2B  0
//   DiskStart     2B  0
//   InternalAttrs 2B  0
//   ExternalAttrs 4B  0
//   LocalHeaderOff 4B  offset in ZIP where local file header starts

const CD_START = pos;

for (let i = 0; i < FILES.length; i++) {
  const f = FILES[i];

  // Signature
  ZIP.writeUInt32LE(0x02014b50, pos);
  // Version made by
  ZIP.writeUInt16LE(20, pos + 4);
  // Version needed
  ZIP.writeUInt16LE(20, pos + 6);
  // Flags
  ZIP.writeUInt16LE(0, pos + 8);
  // Method: deflate
  ZIP.writeUInt16LE(8, pos + 10);
  // Mod time (fixed)
  ZIP.writeUInt16LE(DOS_TIME, pos + 12);
  // Mod date (fixed)
  ZIP.writeUInt16LE(DOS_DATE, pos + 14);
  // CRC-32
  ZIP.writeUInt32LE(f.crc, pos + 16);
  // Compressed size
  ZIP.writeUInt32LE(f.compressedSize, pos + 20);
  // Uncompressed size
  ZIP.writeUInt32LE(f.size, pos + 24);
  // File name length
  ZIP.writeUInt16LE(f.name.length, pos + 28);
  // Extra field length
  ZIP.writeUInt16LE(0, pos + 30);
  // Comment length
  ZIP.writeUInt16LE(0, pos + 32);
  // Disk number start
  ZIP.writeUInt16LE(0, pos + 34);
  // Internal file attributes
  ZIP.writeUInt16LE(0, pos + 36);
  // External file attributes
  ZIP.writeUInt32LE(0, pos + 38);
  // Relative offset of local header
  ZIP.writeUInt32LE(fileStartOffsets[i], pos + 42);

  // File name
  for (let j = 0; j < f.name.length; j++) {
    ZIP[pos + 46 + j] = f.name.charCodeAt(j);
  }

  pos += 46 + f.name.length;
}

// ── Write end-of-central-directory record ────────────────────────────────────
// Signature     4B  0x06054b50
// Disk number   2B  0
// Disk with CD  2B  0
// Entries on disk 2B = number of files
// Total entries 2B = number of files
// CD size       4B = size of central directory (CD_START to pos)
// CD offset     4B = offset where central directory starts (= CD_START, but we need position before EOC)
// Comment length 2B = 0

const EOC_START = pos;

// Signature
ZIP.writeUInt32LE(0x06054b50, EOC_START);
// Number of this disk
ZIP.writeUInt16LE(0, EOC_START + 4);
// Disk where central directory starts
ZIP.writeUInt16LE(0, EOC_START + 6);
// Central directory entries on this disk
ZIP.writeUInt16LE(FILES.length, EOC_START + 8);
// Total central directory entries
ZIP.writeUInt16LE(FILES.length, EOC_START + 10);
// Size of central directory (bytes)
ZIP.writeUInt32LE(CD_START, EOC_START + 12);
// Offset of start of central directory
ZIP.writeUInt32LE(CD_START, EOC_START + 16);
// Comment length
ZIP.writeUInt16LE(0, EOC_START + 20);

// ── Write ZIP to disk ────────────────────────────────────────────────────────
// Create dist/ if needed
try { mkdirSync(DIST, { recursive: true }); } catch {}

const ZIP_PATH = join(DIST, `mira-help-${VERSION}.zip`);
writeFileSync(ZIP_PATH, ZIP);

// ── Print manifest ───────────────────────────────────────────────────────────
let totalBytes = 0;
console.log("ZIP manifest:");
for (const f of FILES) {
  console.log(`  ${f.name} — ${f.size} bytes`);
  totalBytes += f.size;
}
console.log(`  ─────────────────`);
console.log(`  TOTAL files: ${FILES.length}  |  TOTAL uncompressed: ${totalBytes} bytes`);
console.log(`  ZIP size: ${ZIP.length} bytes`);

// SHA-256 of the final ZIP
const sha256 = createHash("sha256").update(ZIP).digest("hex");
console.log(`  SHA-256: ${sha256}`);
console.log(`  Written to: ${ZIP_PATH}`);

process.exit(0);
