/*
 * A placeholder is not an accessible name.
 *
 * It disappears on focus, leaving a half-filled field unreadable.
 * It vanishes for anyone who starts typing, and screen readers
 * often treat it as a decoration, not a label.
 *
 * These checks enforce WCAG 2.2 Level A - the floor, not the target.
 * If a form control ships without a real accessible name, the build
 * must fail. No exceptions for "it looks fine".
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect every .tsx file under `src/`, skipping
 * `node_modules` and `.next` directories.
 * Asserts the list is non-empty so a broken walk fails loudly.
 */
function tsxFiles() {
  const results = [];
  const stack = [join(root, "src")];

  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // directory may not exist - skip
      continue;
    }

    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
        results.push(full);
      }
    }
  }

  assert.ok(results.length > 0, "Expected at least one .tsx file under src/");
  return results;
}

/**
 * Extract opening-tag attributes from <input>, <textarea>, and <select> elements
 * in an HTML/JSX string.
 *
 * WHY NOT A SIMPLE REGEX?  The naive `[^>]*` stops at the FIRST `>` character.
 * In JSX, an event handler like `onChange={(e) => setQ(e)}` contains a `>` inside
 * the `{...}` expression.  A regex would terminate there, missing all subsequent
 * attributes (e.g. `aria-label`).  This function walks the string character by
 * character, tracking brace depth and quote state, so that `>` inside an
 * expression or a string is never mistaken for the end of the opening tag.
 */
function controlsIn(src) {
  const tagRe = /<(input|textarea|select)\b/g;
  const controls = [];
  let match;

  while ((match = tagRe.exec(src)) !== null) {
    const tagName = match[1];
    const tagStartIndex = match.index;
    // Position right after the tag name (e.g. after "<input")
    let pos = tagStartIndex + match[0].length;

    let depth = 0;
    let quote = null; // null, '"', "'", or '`'
    let closingIndex = -1;

    for (let i = pos; i < src.length; i++) {
      const ch = src[i];

      // Handle quote state
      if (quote !== null) {
        if (ch === quote) {
          // Check if this quote is escaped by counting preceding backslashes
          let backslashCount = 0;
          let j = i - 1;
          while (j >= pos && src[j] === "\\") {
            backslashCount++;
            j--;
          }
          if (backslashCount % 2 === 0) {
            // Even number of backslashes -> quote is not escaped, close quote
            quote = null;
          }
          // If odd, the quote is escaped and we stay inside the string
        }
        // Inside a quote, ignore all structural characters
        continue;
      }

      // Not inside a quote
      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
        continue;
      }

      if (ch === "{") {
        depth++;
        continue;
      }

      if (ch === "}") {
        if (depth > 0) depth--;
        continue;
      }

      if (ch === ">" && depth === 0) {
        closingIndex = i;
        break;
      }
    }

    // If no closing '>' was found (truncated file), stop processing entirely
    if (closingIndex === -1) {
      break;
    }

    // Extract the raw attribute string (between tag name and closing '>')
    let attrs = src.slice(pos, closingIndex);

    // Strip trailing whitespace and a self-closing slash if present
    attrs = attrs.trimEnd();
    if (attrs.endsWith("/")) {
      attrs = attrs.slice(0, -1).trimEnd();
    }

    controls.push({
      tag: tagName,
      attrs: attrs,
      index: tagStartIndex,
    });

    // Advance the regex lastIndex past the closing '>' so we find the next tag
    tagRe.lastIndex = closingIndex + 1;
  }

  return controls;
}

/**
 * Return the value of an HTML attribute from a raw attribute string.
 * Handles double- and single-quoted values.
 */
function getAttr(attrs, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i");
  const m = attrs.match(re);
  return m ? m[1] : undefined;
}

/**
 * Find all `<label>...</label>` spans in `src` and return an array
 * of `{ start, end }` where `start` is the index of the opening
 * `<label` and `end` is the index immediately after the closing
 * `</label>`.
 *
 * Uses a simple stack to pair openings and closings; nested labels
 * are extremely unlikely but handled correctly.
 */
function getLabelSpans(src) {
  const spans = [];
  const stack = [];
  const re = /<(\/?)label\b/gi;
  let match;

  while ((match = re.exec(src)) !== null) {
    if (match[1] === "/") {
      if (stack.length) {
        const start = stack.pop();
        spans.push({ start, end: match.index + match[0].length });
      }
    } else {
      stack.push(match.index);
    }
  }

  return spans;
}

/**
 * Determine whether a form control has an accessible name.
 *
 * `attrs` - the raw attribute string of the control.
 * `src`   - the full file source.
 * `tag`   - the control tag name.
 * `index` - the control's character index inside `src`.
 * `labelSpans` - pre-computed label spans for this file.
 */
function hasAccessibleName(attrs, src, tag, index, labelSpans) {
  // 1. Explicit ARIA attributes, in both the quoted and the expression form.
  // Only the quoted form was recognised at first, which made every
  // aria-label={expr} invisible to this check.
  if (/\baria-label\s*=\s*(?:["']|\{)/.test(attrs)) return true;
  if (/\baria-labelledby\s*=\s*(?:["']|\{)/.test(attrs)) return true;

  // 2. id / htmlFor pairing
  const id = getAttr(attrs, "id");
  if (id) {
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const forRe = new RegExp(`htmlFor\\s*=\\s*["']${escapedId}["']`, "i");
    if (forRe.test(src)) return true;
  }

  // 2b. id / htmlFor in the JSX EXPRESSION form.
  // Motivating case, real in this codebase: <input id={id} /> paired with
  // <label htmlFor={id}>. Rule 2 sees only quoted literals, so it reported a
  // correctly labelled checkbox as unlabelled. This is TEXTUAL matching, not
  // evaluation: two different variables that happen to share a name would be a
  // false negative in the other direction, and that trade is accepted
  // deliberately, because the alternative is evaluating JSX.
  const idExprMatch = attrs.match(/\bid=\{([^}]*)\}/);
  if (idExprMatch) {
    const idExpr = idExprMatch[1].trim();
    if (idExpr) {
      const escapedExpr = idExpr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const forExprRe = new RegExp(`htmlFor\\s*=\\s*\\{\\s*${escapedExpr}\\s*\\}`, "i");
      if (forExprRe.test(src)) return true;
    }
  }

  // 3. Self-labelling types (no visible label needed)
  const type = getAttr(attrs, "type");
  if (type && ["hidden", "submit", "button"].includes(type.toLowerCase())) {
    return true;
  }

  // 4. Wrapping <label> element
  if (labelSpans.some(({ start, end }) => start <= index && index < end)) {
    return true;
  }

  // A placeholder is explicitly NOT an accessible name.
  return false;
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

test("every form control has an accessible name that is not a placeholder", () => {
  const files = tsxFiles();

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const labelSpans = getLabelSpans(src);
    const controls = controlsIn(src);

    for (const ctrl of controls) {
      const relPath = relative(root, file);
      const nameOrPlaceholder =
        getAttr(ctrl.attrs, "name") ||
        getAttr(ctrl.attrs, "placeholder") ||
        "(no name or placeholder)";

      const msg =
        `${relPath}: <${ctrl.tag}> with ${nameOrPlaceholder} lacks an accessible name. ` +
        "A placeholder is not an accessible name - it disappears on focus and leaves a half-filled field unreadable.";

      assert.ok(
        hasAccessibleName(ctrl.attrs, src, ctrl.tag, ctrl.index, labelSpans),
        msg
      );
    }
  }
});

test("the corporate chrome offers a skip link to main content", () => {
  const chromePath = join(root, "src", "components", "site-chrome.tsx");
  let src;

  try {
    src = readFileSync(chromePath, "utf8");
  } catch {
    assert.fail(`Missing file: ${relative(root, chromePath)}`);
  }

  assert.ok(
    /href\s*=\s*["']#main-content["']/.test(src),
    'site-chrome.tsx must contain an anchor with href="#main-content"'
  );

  assert.ok(
    /id\s*=\s*["']main-content["']/.test(src),
    'site-chrome.tsx must contain id="main-content" (the skip-link target)'
  );

  assert.ok(
    /tabIndex\s*=\s*\{-1\}/.test(src),
    "site-chrome.tsx must contain tabIndex={-1} so focus moves to the target"
  );
});

/*
 * Test 3 is deliberately narrower than Test 1: it only checks files
 * under src/app. A failure in a customer-facing page has different
 * urgency than one in an internal admin component, and a combined red
 * does not tell an operator which one they have.
 */
test("no page uses a placeholder as its only field label", () => {
  const allFiles = tsxFiles();
  const appDir = join(root, "src", "app");
  const appFiles = allFiles.filter((file) => file.startsWith(appDir));

  for (const file of appFiles) {
    const src = readFileSync(file, "utf8");
    const labelSpans = getLabelSpans(src);
    const controls = controlsIn(src);

    for (const ctrl of controls) {
      const relPath = relative(root, file);
      const nameOrPlaceholder =
        getAttr(ctrl.attrs, "name") ||
        getAttr(ctrl.attrs, "placeholder") ||
        "(no name or placeholder)";

      const msg =
        `${relPath}: <${ctrl.tag}> with ${nameOrPlaceholder} relies on a placeholder as its only label. ` +
        "Placeholder text is not an accessible name.";

      assert.ok(
        hasAccessibleName(ctrl.attrs, src, ctrl.tag, ctrl.index, labelSpans),
        msg
      );
    }
  }
});

test("the control matcher finds controls, so a green run means something", () => {
  const files = tsxFiles();
  let totalControls = 0;
  let contactSalesControls = 0;

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const controls = controlsIn(src);
    totalControls += controls.length;

    // Normalize backslashes to forward slashes for cross-platform path comparison.
    // On Windows, relative() returns backslashes; without this, the contact-sales
    // check would silently never match, masking degradation.
    const relPath = relative(root, file).replace(/\\/g, "/");
    if (relPath === "src/app/contact-sales/page.tsx") {
      contactSalesControls = controls.length;
    }
  }

  assert.ok(
    totalControls > 10,
    "Expected more than 10 controls across all TSX files. " +
    "Finding zero controls indicates a broken matcher, not a passing suite. " +
    "This assertion exists because a corrupted regex once caused controlsIn to return nothing, " +
    "making all tests pass vacuously."
  );

  assert.ok(
    contactSalesControls >= 1,
    "Expected at least 1 control in the contact-sales page (known to contain 4). " +
    "Finding none there means the matcher has degraded, even if the total count appears plausible."
  );
});
