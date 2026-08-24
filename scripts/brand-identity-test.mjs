/**
 * Brand identity guard – stops the retired trading name from creeping back
 * into the codebase. Run with `node --test scripts/brand-identity-test.mjs`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FORBIDDEN = [
  /afaq\s*al\s*naseem/i,
  /alnaseem/i,
  /al\s+naseem/i,
  "100475523500003",
];

function getTrackedNonPublicFiles() {
  const raw = execFileSync("git", ["ls-files", "-z"], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const thisFile = path
    .relative(process.cwd(), fileURLToPath(import.meta.url))
    .replace(/\\/g, "/");
  return raw
    .split("\0")
    .filter(Boolean)
    .filter((f) => !f.startsWith("public/"))
    .filter((f) => f !== thisFile);
}

function readFileLinesSafe(filePath) {
  try {
    return readFileSync(filePath, "utf8").split(/\r?\n/);
  } catch {
    return null;
  }
}

test("no tracked file contains any forbidden pattern", () => {
  const files = getTrackedNonPublicFiles();
  const violations = [];

  for (const file of files) {
    const lines = readFileLinesSafe(file);
    if (!lines) continue;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pattern of FORBIDDEN) {
        if (typeof pattern === "string") {
          if (line.includes(pattern)) {
            violations.push(`${file}:${i + 1}`);
            break; // one violation per line is enough
          }
        } else if (pattern.test(line)) {
          violations.push(`${file}:${i + 1}`);
          break;
        }
      }
    }
  }

  assert.strictEqual(
    violations.length,
    0,
    `Forbidden patterns found:\n${violations.join("\n")}`
  );
});

test("COUNTERFACTUAL: the retired identity WAS present at 4eb9aa9", () => {
  const SHA = "4eb9aa9";
  const paths = [
    "src/components/footer.tsx",
    "src/app/legal/terms/page.tsx",
    "src/lib/system-knowledge.mjs",
  ];
  for (const p of paths) {
    const content = execFileSync("git", ["show", `${SHA}:${p}`], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const matched = FORBIDDEN.some((pattern) => {
      if (typeof pattern === "string") {
        return content.includes(pattern);
      }
      return pattern.test(content);
    });
    assert.ok(
      matched,
      `Counterfactual failed for ${p}: the pre-rename blob no longer contains the retired identity, meaning the guard proves nothing.`
    );
  }
});

test("replacement identity is present in footer", () => {
  const content = readFileSync("src/components/footer.tsx", "utf8");
  assert.ok(
    content.includes("Satellite World"),
    "Footer must contain 'Satellite World'"
  );
});

test("exact spelling is enforced", () => {
  const systemKnowledge = readFileSync(
    "src/lib/system-knowledge.mjs",
    "utf8"
  );
  assert.ok(
    systemKnowledge.includes("Satellite World"),
    "src/lib/system-knowledge.mjs must contain 'Satellite World'"
  );

  const files = getTrackedNonPublicFiles();
  const misspellings = ["Satelite World", "Satellite Word"];
  const violations = [];

  for (const file of files) {
    const lines = readFileLinesSafe(file);
    if (!lines) continue;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const bad of misspellings) {
        if (line.includes(bad)) {
          violations.push(`${file}:${i + 1}`);
          break;
        }
      }
    }
  }

  assert.strictEqual(
    violations.length,
    0,
    `Misspellings found:\n${violations.join("\n")}`
  );
});
