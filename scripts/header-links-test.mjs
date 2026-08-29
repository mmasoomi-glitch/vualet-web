/*
 * Why this file exists:
 * /login shipped for months announcing a vendor that was never adopted.
 * It sat inside EXCLUDED_PREFIXES so the sitemap suite never inspected it,
 * and nothing else checked that a navigation destination has content.
 * This suite now guards both global navigation components (header and footer).
 * The footer was found to carry the same defect on every page, including a
 * Status link to a subdomain that does not resolve, and a gate covering only
 * one component of two gave false assurance.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => readFileSync(join(root, ...p), "utf8");

const PLACEHOLDER = [/coming soon/i, /landing soon/i, /next deploy/i, /\bClerk\b/];

// External liveness cannot be proven from an offline unit test, so every
// external host must be listed here deliberately. The list is empty because
// status.vualet.com was removed for not resolving; adding a host here is a
// statement that someone confirmed it resolves.
const ALLOWED_EXTERNAL_HOSTS = [];

function globalNavHrefs() {
  const files = [
    { path: "src/components/nav.tsx", name: "nav.tsx" },
    { path: "src/components/footer.tsx", name: "footer.tsx" },
  ];
  const hrefMap = new Map(); // href -> source (first seen)
  const fileHasHref = new Set();

  for (const { path, name } of files) {
    const content = read(...path.split("/"));
    // Match both JSX attribute and object literal forms
    const patterns = [
      /href="([^"]+)"/g,
      /href:\s*"([^"]+)"/g,
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(content)) !== null) {
        const href = m[1];
        if (href === "/") continue;
        if (href.includes("${") || href.includes("`")) continue;
        if (!hrefMap.has(href)) {
          hrefMap.set(href, name);
        }
        fileHasHref.add(name);
      }
    }
  }

  const sorted = [...hrefMap.entries()]
    .map(([href, source]) => ({ href, source }))
    .sort((a, b) => a.href.localeCompare(b.href));

  assert.ok(sorted.length > 0, "No navigation links found in either nav.tsx or footer.tsx");
  assert.ok(
    fileHasHref.has("nav.tsx"),
    "No links extracted from nav.tsx - file may have been deleted or format changed"
  );
  assert.ok(
    fileHasHref.has("footer.tsx"),
    "No links extracted from footer.tsx - file may have been deleted or format changed"
  );

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

test("every global navigation link resolves to a page that exists", () => {
  for (const { href, source } of globalNavHrefs()) {
    if (!href.startsWith("/")) continue; // external
    const cleanHref = href.split("#")[0];
    const src = pageSourceFor(cleanHref);
    assert.ok(src !== null, `No page source found for ${href} (from ${source})`);
  }
});

test("no global navigation link lands on a placeholder page", () => {
  for (const { href, source } of globalNavHrefs()) {
    if (!href.startsWith("/")) continue; // external
    const cleanHref = href.split("#")[0];
    let src = pageSourceFor(cleanHref);
    let resolvedFile = cleanHref;
    if (src) {
      const target = followRedirect(src);
      if (target) {
        const destSrc = pageSourceFor(target);
        assert.ok(destSrc !== null, `Redirect target ${target} (from ${href} in ${source}) does not exist`);
        src = destSrc;
        resolvedFile = target;
      }
    } else {
      assert.fail(`No page source found for ${href} (from ${source})`);
    }
    for (const pattern of PLACEHOLDER) {
      assert.ok(
        !pattern.test(src),
        `Placeholder pattern ${pattern} matched in ${resolvedFile} (linked from ${href} in ${source})`
      );
    }
  }
});

test("every external link is on the reviewed allowlist", () => {
  for (const { href, source } of globalNavHrefs()) {
    if (href.startsWith("/")) continue;
    let hostname;
    try {
      hostname = new URL(href).hostname;
    } catch {
      assert.fail(`Invalid external URL ${href} (from ${source})`);
    }
    assert.ok(
      ALLOWED_EXTERNAL_HOSTS.includes(hostname),
      `External host ${hostname} (${href} from ${source}) is not on the reviewed allowlist. ` +
        `Add it only after confirming it resolves.`
    );
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
