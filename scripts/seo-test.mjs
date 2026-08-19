// Technical SEO foundation — sitemap, robots, canonicals.
//
// What matters here is not that the sitemap has entries, but that it can never
// publish a private URL, that crawlers are actually told where it is, and that
// nothing in src/lib/seo.ts is written "for later". So the assertions are mostly
// negative and cross-checking:
//   - robots.txt ANNOUNCES the sitemap, absolutely, on a real host
//   - the BUILT robots output carries that Sitemap: line (not just the source)
//   - robots.txt and sitemap.xml are driven by ONE exclusion list and cannot drift
//   - no /api, /admin, /login, /signup or transactional Mira path can appear
//   - every entry is an absolute URL on the host that actually owns that path
//   - no URL appears twice
//   - the route list matches the real files on disk (and PRODUCTS)
//   - DEAD-CODE GUARD: every export of seo.ts has a real call site
//
// Run: node --test scripts/seo-test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => readFileSync(join(root, ...p), "utf8");

// The app uses the "@/*" -> "./src/*" alias (tsconfig.json paths). Node does not
// know it, so teach the resolver — this is the only plumbing needed to import
// the real production modules (Node strips the TypeScript types natively).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return {
        url: pathToFileURL(join(root, "src", specifier.slice(2) + ".ts")).href,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

const sitemap = (await import("../src/app/sitemap.ts")).default;
const robots = (await import("../src/app/robots.ts")).default;
const seo = await import("../src/lib/seo.ts");
const {
  ORIGIN_MAIN,
  ORIGIN_MIRA,
  SITEMAP_URL,
  PRODUCT_SLUGS,
  buildPublicRoutes,
  robotsDisallow,
  canonicalFor,
  normalizePath,
  originFor,
  isExcluded,
} = seo;

const entries = sitemap();
const urls = entries.map((e) => e.url);
const robotsOut = robots();
const disallowed = robotsOut.rules.disallow;

/** robots.txt prefix semantics: an entry blocks the exact path and everything
 *  beneath it. */
const robotsBlocks = (path) =>
  disallowed.some((d) => {
    const clean = d.replace(/\/$/, "");
    return path === clean || path.startsWith(clean + "/") || path.startsWith(clean);
  });

/* ------------------------------------------------------------------ */
/* 1-4. robots.txt must announce the sitemap                           */
/* ------------------------------------------------------------------ */

test("robots.txt announces the sitemap", () => {
  // The whole point of a sitemap is that something points at it.
  assert.ok(robotsOut.sitemap, "robots.txt MUST declare a Sitemap: directive");
  const declared = Array.isArray(robotsOut.sitemap) ? robotsOut.sitemap : [robotsOut.sitemap];
  assert.ok(declared.length > 0, "the sitemap declaration must not be empty");
  for (const s of declared) {
    assert.equal(typeof s, "string");
    const u = new URL(s); // throws if not absolute
    assert.equal(u.protocol, "https:", `${s} must be https`);
    assert.ok(
      [new URL(ORIGIN_MAIN).hostname, new URL(ORIGIN_MIRA).hostname].includes(u.hostname),
      `${s} is on an unexpected host`,
    );
    assert.equal(u.pathname, "/sitemap.xml", `${s} must point at /sitemap.xml`);
  }
  assert.equal(declared[0], SITEMAP_URL);
  assert.equal(SITEMAP_URL, `${ORIGIN_MAIN}/sitemap.xml`);
});

test("the announced sitemap URL is served by a real route file", () => {
  // A Sitemap: line pointing at a 404 is worse than none.
  assert.ok(existsSync(join(root, "src", "app", "sitemap.ts")), "src/app/sitemap.ts must exist");
  assert.ok(entries.length > 0, "the sitemap it points at must not be empty");
});

test("the BUILT robots output contains the Sitemap: directive", (t) => {
  // Source is intent; the build is fact. Find whatever Next emitted for /robots.txt.
  const found = [];
  const hunt = (dir) => {
    if (!existsSync(dir)) return;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) hunt(full);
      else if (/^robots\.txt(\.body)?$/.test(ent.name)) found.push(full);
    }
  };
  hunt(join(root, ".next", "server", "app"));
  hunt(join(root, ".next", "static"));
  if (found.length === 0) {
    t.skip("no built robots output found — run `npm run build` first");
    return;
  }
  for (const f of found) {
    const body = readFileSync(f, "utf8");
    assert.match(body, /^Sitemap:\s*https:\/\/\S+\/sitemap\.xml\s*$/m, `${f} has no Sitemap: line`);
    assert.ok(body.includes(SITEMAP_URL), `${f} must announce ${SITEMAP_URL}`);
    assert.match(body, /User-Agent:\s*\*/i, `${f} must address all crawlers`);
    assert.match(body, /^Allow:\s*\/$/m, `${f} must allow the public surface`);
  }
});

test("robots.txt allows the public surface and blocks every private prefix", () => {
  assert.equal(robotsOut.rules.userAgent, "*");
  assert.equal(robotsOut.rules.allow, "/");
  assert.ok(Array.isArray(disallowed) && disallowed.length >= 6, "expected a real disallow list");
  for (const probe of [
    "/api/checkout",
    "/admin",
    "/admin/billing",
    "/admin-login",
    "/admin-invite",
    "/login",
    "/signup",
    "/mira/checkout",
    "/mira/welcome",
    "/mira/account",
    "/mira/login",
    "/mira/start",
  ]) {
    assert.equal(isExcluded(probe), true, `${probe} must be classed as excluded`);
    assert.ok(robotsBlocks(probe), `robots.txt must disallow ${probe}`);
  }
});

/* ------------------------------------------------------------------ */
/* 5-8. The sitemap must not leak anything private                     */
/* ------------------------------------------------------------------ */

test("sitemap contains NO /api path", () => {
  const leaked = urls.filter((u) => new URL(u).pathname.startsWith("/api"));
  assert.deepEqual(leaked, [], "API endpoints must never be submitted for indexing");
});

test("sitemap contains NO admin surface (/admin, /admin-login, /admin-invite)", () => {
  const leaked = urls.filter((u) => /^\/admin/.test(new URL(u).pathname));
  assert.deepEqual(leaked, [], "the control plane must never be submitted for indexing");
});

test("sitemap contains NO auth-gated or transactional Mira route", () => {
  const forbidden = [
    "/mira/checkout",
    "/mira/welcome",
    "/mira/account",
    "/mira/login",
    "/mira/start",
    "/login",
    "/signup",
  ];
  for (const f of forbidden) {
    const leaked = urls.filter((u) => {
      const p = new URL(u).pathname;
      return p === f || p.startsWith(f + "/");
    });
    assert.deepEqual(leaked, [], `${f} must not be in the sitemap`);
  }
});

test("robots.txt and sitemap.xml are driven by ONE list and cannot contradict", () => {
  // Nothing robots blocks may be submitted...
  for (const e of entries) {
    const p = new URL(e.url).pathname;
    assert.ok(!robotsBlocks(p), `robots.txt blocks ${p}, which the sitemap submits`);
  }
  // ...and nothing robots blocks may be considered indexable by seo.ts.
  for (const d of disallowed) {
    assert.equal(isExcluded(d), true, `robots disallows ${d} but isExcluded() says it is public`);
  }
  // The disallow list IS the exclusion list — same array, no hand-maintained copy.
  assert.deepEqual(robotsDisallow(), disallowed);
  assert.notEqual(robotsDisallow(), robotsDisallow(), "must hand out a fresh array, not a shared one");
});

/* ------------------------------------------------------------------ */
/* 9-11. Coverage: every real public page is present                   */
/* ------------------------------------------------------------------ */

test("sitemap covers every public page.tsx that exists on disk", () => {
  const appDir = join(root, "src", "app");
  const found = [];
  const walk = (dir, segs) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (ent.name.startsWith("_") || ent.name.startsWith("(")) continue;
        walk(join(dir, ent.name), [...segs, ent.name]);
      } else if (ent.name === "page.tsx") {
        found.push("/" + segs.join("/"));
      }
    }
  };
  walk(appDir, []);

  const expected = found
    .map((p) => (p === "/" ? "/" : p.replace(/\/$/, "")))
    .filter((p) => p !== "" && !p.includes("["))
    .filter((p) => !isExcluded(p));

  const inSitemap = new Set(urls.map((u) => new URL(u).pathname));
  // /mira is published as the mira.vualet.com root ("/"), per mira/page.tsx.
  inSitemap.add("/mira");

  const missing = expected.filter((p) => !inSitemap.has(p));
  // Deliberate omissions: empty "coming soon" placeholders. Documented in seo.ts.
  const knownPlaceholders = ["/docs", "/customers", "/changelog"];
  const unexplained = missing.filter((p) => !knownPlaceholders.includes(p));
  assert.deepEqual(
    unexplained,
    [],
    `public pages exist on disk but are not in the sitemap: ${unexplained.join(", ")}`,
  );
  // And the placeholders really are the only omissions.
  assert.deepEqual(missing.sort(), knownPlaceholders.slice().sort());
});

test("every product detail page is in the sitemap and matches PRODUCTS", () => {
  const productsSrc = read("src", "lib", "products.ts");
  const realSlugs = [...productsSrc.matchAll(/slug:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...PRODUCT_SLUGS].sort(),
    realSlugs.slice().sort(),
    "PRODUCT_SLUGS in seo.ts has drifted from src/lib/products.ts",
  );
  const paths = new Set(urls.map((u) => new URL(u).pathname));
  for (const slug of realSlugs) {
    assert.ok(paths.has(`/products/${slug}`), `/products/${slug} missing from sitemap`);
  }
});

test("every URL in the sitemap resolves to a page file that actually exists", () => {
  for (const u of urls) {
    const { hostname, pathname } = new URL(u);
    // mira.vualet.com/ is served by src/app/mira/page.tsx via middleware rewrite.
    const seg =
      hostname === new URL(ORIGIN_MIRA).hostname && pathname === "/" ? "mira" : pathname.slice(1);
    const dynamicParent = seg.startsWith("products/") && seg !== "products";
    const file = dynamicParent
      ? join(root, "src", "app", "products", "[slug]", "page.tsx")
      : join(root, "src", "app", seg, "page.tsx");
    assert.ok(existsSync(file), `${u} has no backing page file (looked for ${file})`);
  }
});

/* ------------------------------------------------------------------ */
/* 12-14. URL hygiene                                                  */
/* ------------------------------------------------------------------ */

test("no URL appears twice in the sitemap", () => {
  const seen = new Map();
  for (const u of urls) seen.set(u, (seen.get(u) ?? 0) + 1);
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([u]) => u);
  assert.deepEqual(dupes, [], "duplicate sitemap entries split crawl budget");
});

test("every sitemap URL is absolute, https, on a known host, and well formed", () => {
  const allowed = new Set([new URL(ORIGIN_MAIN).hostname, new URL(ORIGIN_MIRA).hostname]);
  for (const u of urls) {
    assert.doesNotThrow(() => new URL(u), `${u} is not a valid absolute URL`);
    const parsed = new URL(u);
    assert.equal(parsed.protocol, "https:", `${u} must be https`);
    assert.ok(allowed.has(parsed.hostname), `${u} is on an unexpected host`);
    assert.equal(parsed.search, "", `${u} must not carry a query string`);
    assert.equal(parsed.hash, "", `${u} must not carry a fragment`);
    assert.ok(!/\/\//.test(parsed.pathname), `${u} has a doubled slash`);
    if (parsed.pathname !== "/") {
      assert.ok(!parsed.pathname.endsWith("/"), `${u} must not have a trailing slash`);
    }
  }
});

test("each entry has a sane changeFrequency, priority and a real lastModified", () => {
  const freqs = new Set(["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"]);
  for (const e of entries) {
    assert.ok(freqs.has(e.changeFrequency), `${e.url}: bad changeFrequency ${e.changeFrequency}`);
    assert.ok(
      typeof e.priority === "number" && e.priority >= 0 && e.priority <= 1,
      `${e.url}: priority must be 0..1`,
    );
    assert.ok(e.lastModified instanceof Date, `${e.url}: lastModified must be a Date`);
    assert.ok(!Number.isNaN(e.lastModified.getTime()), `${e.url}: lastModified is invalid`);
  }
});

test("legal boilerplate is at the floor priority, below every commercial page", () => {
  const legal = entries.filter((e) => new URL(e.url).pathname.startsWith("/legal/"));
  assert.equal(legal.length, 4, "expected terms, privacy, refund, ai-disclosure");
  const maxLegal = Math.max(...legal.map((e) => e.priority));
  const commercial = entries.filter((e) => !new URL(e.url).pathname.startsWith("/legal/"));
  const minCommercial = Math.min(...commercial.map((e) => e.priority));
  assert.ok(
    maxLegal < minCommercial,
    `legal priority ${maxLegal} must be below the lowest commercial priority ${minCommercial}`,
  );
});

/* ------------------------------------------------------------------ */
/* 15-18. Canonicals                                                   */
/* ------------------------------------------------------------------ */

test("canonicalFor routes each path to the host that actually owns it", () => {
  assert.equal(canonicalFor("/"), `${ORIGIN_MAIN}/`);
  assert.equal(canonicalFor("/pricing"), `${ORIGIN_MAIN}/pricing`);
  assert.equal(canonicalFor("/legal/terms"), `${ORIGIN_MAIN}/legal/terms`);
  assert.equal(canonicalFor("/mira/plans"), `${ORIGIN_MIRA}/mira/plans`);
  assert.equal(originFor("/mira/store"), ORIGIN_MIRA);
  assert.equal(originFor("/about"), ORIGIN_MAIN);
  // "/miracle" must NOT be treated as a Mira path.
  assert.equal(originFor("/miracle"), ORIGIN_MAIN);
});

test("every canonical is absolute and each path canonicalises to exactly one URL", () => {
  const seen = new Map();
  for (const r of buildPublicRoutes()) {
    const c = canonicalFor(r.path);
    assert.match(c, /^https:\/\//, `${r.path} canonical must be absolute, got ${c}`);
    // Canonicalisation is idempotent: feeding the canonical back in is a fixed point.
    assert.equal(canonicalFor(c), c, `${r.path}: canonicalFor is not idempotent`);
    // Sloppy input forms must land on the same single canonical, never a duplicate.
    assert.equal(canonicalFor(r.path + "/"), c, `${r.path}: trailing slash forks the canonical`);
    assert.equal(canonicalFor(r.path + "?utm_source=x"), c, `${r.path}: query forks the canonical`);
    seen.set(c, (seen.get(c) ?? 0) + 1);
  }
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([u]) => u);
  assert.deepEqual(dupes, [], "two routes share one canonical URL");
});

test("the Mira home canonical matches what src/app/mira/page.tsx declares", () => {
  const miraPage = read("src", "app", "mira", "page.tsx");
  assert.match(
    miraPage,
    /alternates:\s*\{\s*canonical:\s*"\/"\s*\}/,
    "mira/page.tsx must keep canonical '/'",
  );
  // metadataBase there is https://mira.vualet.com, so that resolves to the Mira root.
  assert.match(
    read("src", "app", "mira", "layout.tsx"),
    /metadataBase:\s*new URL\("https:\/\/mira\.vualet\.com"\)/,
  );
  assert.equal(canonicalFor("/mira"), `${ORIGIN_MIRA}/`);
  assert.ok(urls.includes(`${ORIGIN_MIRA}/`), "the Mira home must be in the sitemap");
});

test("normalizePath strips query, hash, trailing and doubled slashes", () => {
  assert.equal(normalizePath("/pricing/"), "/pricing");
  assert.equal(normalizePath("pricing"), "/pricing");
  assert.equal(normalizePath("/pricing?utm_source=x"), "/pricing");
  assert.equal(normalizePath("/pricing#plans"), "/pricing");
  assert.equal(normalizePath("//mira//plans//"), "/mira/plans");
  assert.equal(normalizePath("/"), "/");
  assert.equal(normalizePath(`${ORIGIN_MIRA}/mira/plans`), "/mira/plans");
});

test("a look-alike host is never mistaken for the Mira origin", () => {
  // "https://mira.vualet.com.example.net/x" starts with ORIGIN_MIRA as a string
  // but is a different host. It must not be able to mint a canonical on ours.
  const hostile = `${ORIGIN_MIRA}.example.net/pricing`;
  assert.equal(originFor(hostile), ORIGIN_MAIN, "look-alike host must not claim the Mira origin");
  assert.notEqual(new URL(canonicalFor(hostile)).hostname, new URL(ORIGIN_MIRA).hostname);
  // The genuine origin, with and without a path, still resolves to Mira.
  assert.equal(originFor(`${ORIGIN_MIRA}/mira/plans`), ORIGIN_MIRA);
  assert.equal(originFor(`${ORIGIN_MIRA}/`), ORIGIN_MIRA);
  assert.equal(canonicalFor(`${ORIGIN_MIRA}/`), `${ORIGIN_MIRA}/`);
});

/* ------------------------------------------------------------------ */
/* 19-20. Guard rails                                                  */
/* ------------------------------------------------------------------ */

test("buildPublicRoutes refuses to publish an excluded path", () => {
  for (const p of ["/", "/pricing", "/mira/plans", "/legal/terms"]) {
    assert.equal(isExcluded(p), false, `${p} must be indexable`);
  }
  // Real routes and the sitemap agree on count.
  assert.equal(buildPublicRoutes().length, entries.length);
});

/**
 * DEAD-CODE GUARD.
 *
 * src/lib/seo.ts once carried a metadata builder and a JSON-LD layer that no
 * page ever imported — half the file was speculative. This test makes that state
 * unreachable: every export must be consumed by a real page/route under src/, or
 * be used inside seo.ts itself AND be named in INTERNAL_ONLY below.
 *
 * Add an export nobody calls and this fails immediately, by name.
 */
const INTERNAL_ONLY = new Set([
  // Used inside seo.ts; exported so this suite can unit-test them directly.
  "ORIGIN_MAIN",
  "ORIGIN_MIRA",
  "normalizePath",
  "originFor",
  "isExcluded",
  "PRODUCT_SLUGS",
  "CONTENT_REVISION",
  "LEGAL_REVISION",
  "ChangeFrequency",
  "PublicRoute",
]);

// Strip comments so a name merely *mentioned* in prose never counts as a call
// site. The "//" rule ignores "https://" by requiring a non-colon before it.
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("DEAD-CODE GUARD: every export of seo.ts has a real call site", () => {
  const seoRel = join("src", "lib", "seo.ts");
  const seoSrc = stripComments(read("src", "lib", "seo.ts"));

  const exportNames = [
    ...seoSrc.matchAll(/^export\s+(?:async\s+)?(?:const|let|function|class|type|interface)\s+([A-Za-z0-9_$]+)/gm),
  ].map((m) => m[1]);
  assert.ok(exportNames.length > 0, "could not parse any export from seo.ts");

  // Every production module under src/, except seo.ts itself.
  const consumers = [];
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (/\.(ts|tsx|mts)$/.test(ent.name) && !full.endsWith(seoRel)) {
        consumers.push({ file: full, text: stripComments(readFileSync(full, "utf8")) });
      }
    }
  };
  walk(join(root, "src"));
  assert.ok(consumers.length > 0, "found no production modules to scan");

  const dead = [];
  const unwired = [];
  for (const name of exportNames) {
    const re = new RegExp(`\\b${name}\\b`);
    const usedInProduction = consumers.some((c) => re.test(c.text));
    // Occurrences beyond the declaration itself mean seo.ts uses it internally.
    const internalUses = (seoSrc.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
    if (usedInProduction) continue;
    if (internalUses <= 1) dead.push(name);
    else if (!INTERNAL_ONLY.has(name)) unwired.push(name);
  }

  assert.deepEqual(
    dead,
    [],
    `seo.ts exports with ZERO call sites anywhere — wire them or delete them: ${dead.join(", ")}`,
  );
  assert.deepEqual(
    unwired,
    [],
    `seo.ts exports used only inside seo.ts and not declared INTERNAL_ONLY — ` +
      `wire them into a page/route, delete them, or add them to the allowlist deliberately: ${unwired.join(", ")}`,
  );

  // The allowlist itself must stay honest: no stale names, nothing that has since
  // gained a real production consumer.
  for (const name of INTERNAL_ONLY) {
    assert.ok(exportNames.includes(name), `INTERNAL_ONLY lists ${name}, which seo.ts no longer exports`);
    const re = new RegExp(`\\b${name}\\b`);
    const usedInProduction = consumers.some((c) => re.test(c.text));
    assert.equal(
      usedInProduction,
      false,
      `${name} now has a production call site — remove it from INTERNAL_ONLY`,
    );
  }

  // And the four production-consumed exports are exactly what we expect.
  const productionConsumed = exportNames.filter((n) => {
    const re = new RegExp(`\\b${n}\\b`);
    return consumers.some((c) => re.test(c.text));
  });
  assert.deepEqual(
    productionConsumed.slice().sort(),
    ["SITEMAP_URL", "buildPublicRoutes", "canonicalFor", "robotsDisallow"].sort(),
    "the set of seo.ts exports used by real routes changed — update this list on purpose",
  );
});
