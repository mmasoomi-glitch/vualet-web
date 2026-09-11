/**
 * Technical SEO foundation — the one place that knows the real public surface,
 * how a canonical URL is formed, and what must never be indexed.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * This app is served on TWO hosts from one Next build:
 *   - https://vualet.com        the Vualet corporate surface (src/app/layout.tsx
 *                               sets metadataBase = https://vualet.com)
 *   - https://mira.vualet.com   the Mira sub-brand (src/app/mira/layout.tsx sets
 *                               metadataBase = https://mira.vualet.com; and
 *                               src/middleware.ts rewrites "/" -> "/mira" when the
 *                               Host header starts with "mira.")
 * Every /mira/* path is therefore reachable on BOTH hosts. Without an explicit
 * canonical that is duplicate content. `canonicalFor()` below encodes the single
 * correct answer per path so nothing has to guess.
 *
 * TWO CONSUMERS, ONE TRUTH
 *   - src/app/sitemap.ts  imports buildPublicRoutes() + canonicalFor()
 *   - src/app/robots.ts   imports SITEMAP_URL + robotsDisallow()
 * The exclusion list is shared, so robots.txt and sitemap.xml cannot drift: any
 * path kept out of the sitemap is the same path robots.txt tells crawlers to
 * skip.
 *
 * NOTHING IS EXPORTED "FOR LATER". scripts/seo-test.mjs enforces that every
 * export here is either consumed by a real page/route or used inside this file;
 * a helper nobody calls fails the suite.
 */

/* -------------------------------------------------------------------------- */
/* Origins                                                                     */
/* -------------------------------------------------------------------------- */

/** Vualet corporate host. Source: src/app/layout.tsx metadataBase. */
// The blog index and every published post are real public pages, so the sitemap is
// generated FROM the post list rather than transcribed alongside it. A post that is
// added or removed in blog.ts cannot leave a stale or missing sitemap entry behind.
import { allPosts } from "@/lib/blog";

export const ORIGIN_MAIN = "https://vualet.com";

/** Mira sub-brand host. Source: src/app/mira/layout.tsx metadataBase. */
export const ORIGIN_MIRA = "https://mira.vualet.com";

/**
 * Where the sitemap actually lives. Next serves src/app/sitemap.ts at this path.
 *
 * ONE announced sitemap, on the corporate host, on purpose. /sitemap.xml is
 * reachable on both hosts and lists URLs for both, so announcing it twice would
 * just publish the same document under two names. See the cross-host note in
 * src/app/sitemap.ts for the Search Console requirement that makes this work.
 */
const SITEMAP_PATH = "/sitemap.xml";

/** Absolute sitemap URL for the `Sitemap:` line in robots.txt. robots.txt is a
 *  static file with no metadataBase, so this must be absolute or crawlers
 *  ignore it. */
export const SITEMAP_URL = `${ORIGIN_MAIN}${SITEMAP_PATH}`;

/* -------------------------------------------------------------------------- */
/* Path + canonical helpers                                                    */
/* -------------------------------------------------------------------------- */

/**
 * True when `raw` is an absolute URL *on* `origin`.
 *
 * A bare startsWith() is not enough: "https://mira.vualet.com.example.net/x"
 * starts with ORIGIN_MIRA but is a different, hostile host. The next character
 * has to end the authority.
 */
function isOnOrigin(raw: string, origin: string): boolean {
  if (!raw.startsWith(origin)) return false;
  const next = raw.charAt(origin.length);
  return next === "" || next === "/" || next === "?" || next === "#";
}

/**
 * Normalise a path to the exact form that appears in a canonical URL:
 * one leading slash, no trailing slash (except root), no query, no hash.
 */
export function normalizePath(path: string): string {
  if (typeof path !== "string") throw new TypeError("path must be a string");
  let p = path.trim();
  // Tolerate an accidental absolute URL on either known origin.
  if (isOnOrigin(p, ORIGIN_MIRA)) p = p.slice(ORIGIN_MIRA.length);
  else if (isOnOrigin(p, ORIGIN_MAIN)) p = p.slice(ORIGIN_MAIN.length);
  p = p.split("#")[0].split("?")[0];
  if (!p.startsWith("/")) p = "/" + p;
  p = p.replace(/\/{2,}/g, "/");
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p === "" ? "/" : p;
}

/**
 * Which host is authoritative for a path.
 *
 * The Mira surface belongs to mira.vualet.com. Everything else — including the
 * /legal/* trust pages, which render on both hosts but whose metadata inherits
 * the root layout's metadataBase — belongs to vualet.com.
 */
export function originFor(path: string): string {
  // An absolute URL already on the Mira host stays on the Mira host - including
  // its root, which middleware serves from /mira and which a bare "/" would
  // otherwise hand back to vualet.com.
  if (typeof path === "string" && isOnOrigin(path.trim(), ORIGIN_MIRA)) return ORIGIN_MIRA;
  const p = normalizePath(path);
  if (p === "/mira" || p.startsWith("/mira/")) return ORIGIN_MIRA;
  // APEX RESTORED 2026-08-29: vualet.com now proxies to this application, so
  // the two-host rule is back in force - the Mira product surface belongs to
  // mira.vualet.com and everything else, including the /legal/* trust pages,
  // belongs to the apex. Verified live before this revert: vualet.com/,
  // /about, /security, /products and all three /legal/* pages return 200.
  return ORIGIN_MAIN;
}

/**
 * Absolute canonical URL for a path.
 *
 * Special case: on mira.vualet.com the middleware serves /mira at "/", and
 * src/app/mira/page.tsx already declares `alternates: { canonical: "/" }`.
 * We match that exactly so the sitemap and the page agree.
 *
 * Idempotent: canonicalFor(canonicalFor(x)) === canonicalFor(x) for every route,
 * so a canonical can be fed back in without silently changing host.
 */
export function canonicalFor(path: string): string {
  const origin = originFor(path);
  const p = normalizePath(path);
  if (origin === ORIGIN_MIRA && (p === "/mira" || p === "/")) return ORIGIN_MIRA + "/";
  return p === "/" ? origin + "/" : origin + p;
}

/* -------------------------------------------------------------------------- */
/* The real public surface                                                     */
/* -------------------------------------------------------------------------- */

export type ChangeFrequency =
  | "always"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "never";

export type PublicRoute = {
  path: string;
  changeFrequency: ChangeFrequency;
  priority: number;
  /** ISO date. Static, not `new Date()` — a sitemap that claims every page
   *  changed at build time is telling crawlers something untrue. */
  lastModified: string;
  why: string;
};

/**
 * Bumped by hand when the marketing surface actually changes. Deliberately NOT
 * `new Date()`: lastmod must mean "the content changed", not "we redeployed".
 */
export const CONTENT_REVISION = "2026-08-05";

/** The legal pages carry their own stated date — see `lastUpdated="July 17, 2026"`
 *  in each of src/app/legal/{terms,privacy,refund,ai-disclosure}/page.tsx. */
export const LEGAL_REVISION = "2026-07-17";

/**
 * Product detail pages are generated from src/lib/products.ts. Kept as a literal
 * list (rather than importing PRODUCTS) so the sitemap module stays free of app
 * runtime imports and so a slug can never silently disappear without a test
 * failing — scripts/seo-test.mjs asserts this list equals PRODUCTS' slugs.
 */
export const PRODUCT_SLUGS: readonly string[] = [
  "mira",
  "whatsapp-agents",
  "crm",
  "hr",
  "inbox",
  "quotes",
  "performance",
];

/**
 * Paths that must NEVER be indexed. This single list drives BOTH the sitemap
 * exclusion (via isExcluded) and the robots.txt disallow list (via
 * robotsDisallow), so the two can never contradict each other.
 *
 * - /api          machine endpoints
 * - /admin        the internal control plane (src/app/admin/layout.tsx sets
 *                 robots noindex; /admin-login and /admin-invite do NOT, which
 *                 is exactly why robots.txt now covers them too)
 * - /login, /signup, /mira/login   auth + funnel entry points, no search value
 * - the transactional Mira routes: checkout, welcome, account, start
 *
 * Prefix semantics: an entry blocks the exact path and everything beneath it.
 */
const EXCLUDED_PREFIXES: readonly string[] = [
  "/api",
  "/admin",
  "/admin-login",
  "/admin-invite",
  "/login",
  "/signup",
  "/mira/checkout",
  "/mira/welcome",
  "/mira/account",
  "/mira/login",
  "/mira/start",
  // Leftover waitlist page - the live funnel entry is /mira/start; excluded so the sitemap cannot split the funnel again.
  "/mira/signup",
  // Re-pairing flow for EXISTING customers whose WhatsApp link dropped. It is a
  // utility, not public content: indexing it would put a page that collects a
  // phone number and a consent tick into search results, competing with the real
  // funnel entry and reading like a second signup.
  "/mira/reconnect",
];

/** True when a path must be kept out of the sitemap and out of the index. */
export function isExcluded(path: string): boolean {
  const p = normalizePath(path);
  return EXCLUDED_PREFIXES.some((x) => p === x || p.startsWith(x + "/"));
}

/**
 * The `Disallow:` lines for src/app/robots.ts — the same list the sitemap
 * excludes, so a route can never be hidden from one and offered by the other.
 * Returns a fresh array because MetadataRoute.Robots takes a mutable string[].
 */
export function robotsDisallow(): string[] {
  return [...EXCLUDED_PREFIXES];
}

/**
 * Every indexable public route, with an honest priority.
 *
 * Priority is relative *within this site only*. The paid conversion surface
 * (Mira home, Mira plans, Vualet pricing) ranks highest; the legal boilerplate
 * sits at the floor — it must be crawlable and reachable, but it is not what we
 * want ranking for a product query.
 *
 * NOT LISTED, on purpose: /docs, /customers and /changelog are "coming soon"
 * placeholders today (see each page's body). Submitting empty pages is a
 * quality signal we do not want. Add them here the moment they have content.
 */
export function buildPublicRoutes(): PublicRoute[] {
  const routes: PublicRoute[] = [
    // ---- Vualet corporate (vualet.com) ----
    {
      path: "/",
      changeFrequency: "weekly",
      priority: 1.0,
      lastModified: CONTENT_REVISION,
      why: "Corporate home — src/app/page.tsx",
    },
    {
      path: "/pricing",
      changeFrequency: "weekly",
      priority: 0.9,
      lastModified: CONTENT_REVISION,
      why: "Commercial intent — src/app/pricing/page.tsx",
    },
    {
      path: "/products",
      changeFrequency: "weekly",
      priority: 0.8,
      lastModified: CONTENT_REVISION,
      why: "Product index — src/app/products/page.tsx",
    },
    {
      path: "/about",
      changeFrequency: "monthly",
      priority: 0.6,
      lastModified: CONTENT_REVISION,
      why: "Entity/company page — src/app/about/page.tsx",
    },
    {
      path: "/contact",
      changeFrequency: "monthly",
      priority: 0.5,
      lastModified: CONTENT_REVISION,
      why: "Real contact form — src/app/contact/page.tsx",
    },
    {
      path: "/contact-sales",
      changeFrequency: "monthly",
      priority: 0.5,
      lastModified: CONTENT_REVISION,
      why: "Sales enquiry — src/app/contact-sales/page.tsx",
    },
    {
      path: "/veridian",
      changeFrequency: "monthly",
      priority: 0.4,
      lastModified: CONTENT_REVISION,
      why: "Public read-only Mira demo — src/app/veridian/page.tsx",
    },
    {
      path: "/security",
      changeFrequency: "yearly",
      priority: 0.3,
      lastModified: CONTENT_REVISION,
      why: "Responsible disclosure — src/app/security/page.tsx",
    },
    {
      path: "/security/journalists",
      changeFrequency: "monthly",
      priority: 0.7,
      lastModified: CONTENT_REVISION,
      why: "Verified security properties and honest limits for at-risk users - src/app/security/journalists/page.tsx",
    },

    // ---- Mira sub-brand (mira.vualet.com) ----
    {
      path: "/mira",
      changeFrequency: "weekly",
      priority: 1.0,
      lastModified: CONTENT_REVISION,
      why: "Mira home; served at / on mira.vualet.com — src/app/mira/page.tsx",
    },
    {
      path: "/mira/plans",
      changeFrequency: "weekly",
      priority: 0.9,
      lastModified: CONTENT_REVISION,
      why: "Mira paid plans — src/app/mira/plans/page.tsx",
    },
    {
      path: "/mira/store",
      changeFrequency: "monthly",
      priority: 0.7,
      lastModified: CONTENT_REVISION,
      why: "Mira product family — src/app/mira/store/page.tsx",
    },
    {
      path: "/mira/vpn",
      changeFrequency: "monthly",
      priority: 0.5,
      lastModified: CONTENT_REVISION,
      why: "Coming-soon preview with real content — src/app/mira/vpn/page.tsx",
    },
    {
      path: "/mira/live",
      changeFrequency: "monthly",
      priority: 0.5,
      lastModified: CONTENT_REVISION,
      why: "Live-voice preview, honest about not shipping yet — src/app/mira/live/page.tsx",
    },
  ];

  // Product detail pages.
  for (const slug of PRODUCT_SLUGS) {
    routes.push({
      path: `/products/${slug}`,
      changeFrequency: "monthly",
      priority: 0.7,
      lastModified: CONTENT_REVISION,
      why: "Generated from PRODUCTS — src/app/products/[slug]/page.tsx",
    });
  }

  // The engineering blog: the index, then one entry per published post.
  routes.push({
    path: "/blog",
    changeFrequency: "weekly",
    priority: 0.6,
    lastModified: CONTENT_REVISION,
    why: "Engineering notes index - src/app/blog/page.tsx",
  });
  for (const post of allPosts()) {
    routes.push({
      path: `/blog/${post.slug}`,
      changeFrequency: "yearly",
      priority: 0.5,
      // A post carries its own publication date, which is the honest lastModified.
      lastModified: post.date,
      why: "Generated from POSTS - src/app/blog/[slug]/page.tsx",
    });
  }

  // Legal / trust pages last, at the floor priority. Required to be crawlable
  // (payment providers and app stores check them) but never ranked as product.
  for (const leaf of ["terms", "privacy", "refund", "ai-disclosure"]) {
    routes.push({
      path: `/legal/${leaf}`,
      changeFrequency: "yearly",
      priority: 0.2,
      lastModified: LEGAL_REVISION,
      why: "Legal boilerplate — src/app/legal/*/page.tsx",
    });
  }

  // Fail loudly rather than silently publishing a private path.
  for (const r of routes) {
    if (isExcluded(r.path)) {
      throw new Error(`SEO: excluded path leaked into the sitemap: ${r.path}`);
    }
  }
  return routes;
}
