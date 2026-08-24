/**
 * Brand identity guard – ensures the current trading name 'Vualet Trading' is used correctly
 * and retired names ('Afaq Alnaseem Trading LLC', 'Satellite World') do not reappear.
 * Run with `node --test scripts/brand-identity-test.mjs`.
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
  /satellite\s+world/i,
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

test("COUNTERFACTUAL: the retired 'Satellite World' identity WAS present at fd3dd22", () => {
  const SHA = "fd3dd22";
  const paths = [
    "src/components/footer.tsx",
    "src/app/legal/terms/page.tsx",
    "src/lib/system-knowledge.mjs",
  ];
  const pattern = /satellite\s+world/i;
  for (const p of paths) {
    const content = execFileSync("git", ["show", `${SHA}:${p}`], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    assert.ok(
      pattern.test(content),
      `Counterfactual failed for ${p}: the blob at ${SHA} no longer contains 'Satellite World', meaning the guard proves nothing.`
    );
  }
});

test("replacement identity is present in footer", () => {
  const content = readFileSync("src/components/footer.tsx", "utf8");
  assert.ok(
    content.includes("Vualet Trading"),
    "Footer must contain 'Vualet Trading'"
  );
});

test("exact spelling is enforced", () => {
  const systemKnowledge = readFileSync(
    "src/lib/system-knowledge.mjs",
    "utf8"
  );
  assert.ok(
    systemKnowledge.includes("Vualet Trading"),
    "src/lib/system-knowledge.mjs must contain 'Vualet Trading'"
  );

  const files = getTrackedNonPublicFiles();
  const misspellings = [
    "Vualet trading",
    "VualetTrading",
    "Valuet Trading",
    "Vaulet Trading",
  ];
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

test("new identity must not be written with an incorporation suffix", () => {
  const files = getTrackedNonPublicFiles();
  const pattern = /vualet\s+trading\s+(LLC|L\.L\.C\.|Ltd|FZE|FZ-LLC)/i;
  const violations = [];

  for (const file of files) {
    const lines = readFileLinesSafe(file);
    if (!lines) continue;

    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        violations.push(`${file}:${i + 1}`);
      }
    }
  }

  assert.strictEqual(
    violations.length,
    0,
    `Incorporation suffix violations found:\n${violations.join("\n")}`
  );
});
