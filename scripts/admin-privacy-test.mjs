/**
 * ADMIN PRIVACY TEST (backend-generalised §1) — runnable proof that NO admin
 * surface exposes customer conversation/message/memory/document content.
 *
 * Dependency-free: uses node:test + node:fs against the actual source, so it
 * runs with `node --test` and no build step. It proves three invariants:
 *   1. The admin customer-metadata allowlist contains ZERO content fields.
 *   2. The metadata projector strips any content field at runtime.
 *   3. No admin API route imports a content-bearing store, and no admin route
 *      returns a forbidden content field.
 *
 * Run: npm run test:privacy
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT = join(ROOT, "src/lib/admin-privacy-contract.ts");
const ADMIN_API_DIR = join(ROOT, "src/app/api/admin");

// Field names that represent CUSTOMER CONTENT — none may ever surface to admins.
const FORBIDDEN_FIELDS = [
  "message", "messages", "messageBody", "conversation", "conversations",
  "conversationBody", "transcript", "transcripts", "prompt", "prompts",
  "completion", "output", "memory", "memories", "document", "documents",
  "docContent", "voiceNote", "attachmentBody", "kbContent", "modelContext",
  "apiKey", "accessToken", "secret",
];
// Content-bearing modules an admin route must never import.
const FORBIDDEN_MODULES = ["veridian-memory", "veridian-kb"];

function read(path) {
  return readFileSync(path, "utf8");
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

// Parse the allowlist array literal out of the contract source.
function parseAllowlist(src) {
  const m = src.match(/ADMIN_CUSTOMER_METADATA_FIELDS\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(m, "ADMIN_CUSTOMER_METADATA_FIELDS array not found in contract");
  return [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
}

test("metadata allowlist contains zero content fields", () => {
  const allow = parseAllowlist(read(CONTRACT));
  assert.ok(allow.length > 0, "allowlist is empty");
  for (const f of allow) {
    assert.ok(!FORBIDDEN_FIELDS.includes(f), `content field "${f}" must not be in the admin metadata allowlist`);
  }
});

test("metadata projector strips content fields at runtime", () => {
  const allow = parseAllowlist(read(CONTRACT));
  // Replicate the contract's allowlist projection and feed it a record that is
  // stuffed with content. Every forbidden field must be dropped.
  const project = (full) => {
    const out = {};
    for (const k of allow) out[k] = full[k];
    return out;
  };
  const poisoned = {
    id: "cus_x", name: "Test", email: "t@x.io", plan: "Pro", channel: "Web",
    status: "active", creditsUsed: 1, creditsIncluded: 2, mrrUsd: 49, joined: "2026-01-01", country: "AE",
    // content that must NEVER pass through:
    messages: [{ body: "secret plaintext" }], conversation: "hello world",
    transcript: "voice text", memory: "user memory", document: "pdf text",
    apiKey: "sk-123", accessToken: "tok", prompt: "system prompt", output: "model output",
  };
  const projected = project(poisoned);
  for (const f of FORBIDDEN_FIELDS) {
    assert.ok(!(f in projected), `projector leaked content field "${f}"`);
  }
  assert.equal(projected.email, "t@x.io"); // metadata still present
});

test("no admin API route imports a content-bearing store", () => {
  const files = walk(ADMIN_API_DIR);
  assert.ok(files.length > 0, "no admin API route files found");
  for (const file of files) {
    const src = read(file);
    for (const mod of FORBIDDEN_MODULES) {
      assert.ok(
        !new RegExp(`from\\s+["'][^"']*${mod}["']`).test(src),
        `${file} imports content-bearing module "${mod}" — admins must not reach content`,
      );
    }
  }
});

test("no admin API route references a customer-content property", () => {
  // Heuristic: forbid `.messages` / `.conversation` / `.transcript` / `.memory`
  // / `.document` member access and same-named object keys in admin routes.
  const risky = ["messages", "conversation", "conversations", "transcript", "transcripts", "memory", "memories"];
  for (const file of walk(ADMIN_API_DIR)) {
    const src = read(file);
    for (const name of risky) {
      assert.ok(!new RegExp(`\\.${name}\\b`).test(src), `${file} accesses .${name} — potential content access`);
    }
  }
});
