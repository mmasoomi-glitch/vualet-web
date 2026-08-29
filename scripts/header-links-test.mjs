/*
 * Why this file exists:
 * /login shipped for months announcing a vendor that was never adopted.
 * It sat inside EXCLUDED_PREFIXES so the sitemap suite never inspected it,
 * and nothing else checked that a navigation destination has content.
 * This suite closes that gap.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => readFileSync(join(root, ...p), "utf8");

const PLACEHOLDER = [/coming soon/i, /landing soon/i, /next deploy/i, /\bClerk\b/];

function hrefsInNav() {
  const nav = read("src", "components", "nav.tsx");
  const hrefs = new Set();
  const re = /href="(\/[^"]*)"/g;
  let m;
  while ((m = re.exec(nav)) !== null) {
    const href = m[1];
    // Drop bare root and template placeholders
    if (href === "/") continue;
    if (href.includes("${") || href.includes("`")) continue;
    hrefs.add(href);
  }
  const sorted = [...hrefs].sort();
  assert.ok(sorted.length > 0, "No header links found - nav.tsx may have changed format");
  return sorted;
}

function pageSourceFor(path) {
  const exact = join(root, "src", "app", path.slice(1), "page.tsx");
  if (existsSync(exact)) return readFileSync(exact, "utf8");

  // Try dynamic segment fallback: drop last segment, append [slug]/page.tsx
  const segments = path.split("/").filter(Boolean);
  if (segments.length > 1) {
    const dynamic = join(root, "src", "app", ...segments.slice(0, -1), "[slug]", "page.tsx");
    if (existsSync(dynamic)) return readFileSync(dynamic, "utf8");
  }
  return null;
}

function followRedirect(src) {
  const m = src.match(/(?:permanentRedirect|redirect)\(\s*"(\/[^"]*)"/);
  return m ? m[1] : null;
}

test("every header link resolves to a page that exists", () => {
  for (const href of hrefsInNav()) {
    const src = pageSourceFor(href);
    assert.ok(src !== null, `No page source found for ${href}`);
  }
});

// Following one redirect hop is intentional: /login is now a redirect,
// and we care about whether the final destination has content.
test("no header link lands on a placeholder page", () => {
  for (const href of hrefsInNav()) {
    let src = pageSourceFor(href);
    let resolvedFile = href;
    if (src) {
      const target = followRedirect(src);
      if (target) {
        const destSrc = pageSourceFor(target);
        assert.ok(destSrc !== null, `Redirect target ${target} (from ${href}) does not exist`);
        src = destSrc;
        resolvedFile = target;
      }
    } else {
      assert.fail(`No page source found for ${href}`);
    }
    for (const pattern of PLACEHOLDER) {
      assert.ok(
        !pattern.test(src),
        `Placeholder pattern ${pattern} matched in ${resolvedFile} (linked from ${href})`
      );
    }
  }
});

test("the retired stub cannot come back", () => {
  const bannedRe = /\bClerk\b/;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
        const content = readFileSync(full, "utf8");
        assert.ok(
          !bannedRe.test(content),
          `Retired vendor name found in ${full} - it was never a dependency`
        );
      }
    }
  };
  walk(join(root, "src"));
});
