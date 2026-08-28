import type { MetadataRoute } from "next";
import { buildPublicRoutes, canonicalFor } from "@/lib/seo";

/**
 * /sitemap.xml
 *
 * The route table, the exclusion list and the canonical-URL rule all live in
 * src/lib/seo.ts, so this file cannot drift from what the metadata builder says.
 *
 * TWO HOSTS, ONE SITEMAP — read this before changing it.
 * This build is served on both vualet.com and mira.vualet.com (see
 * src/middleware.ts), so /sitemap.xml is reachable on both and lists URLs on
 * both. That is only honoured by search engines when the two hosts sit in the
 * same verified property. OPERATIONAL REQUIREMENT: register vualet.com in
 * Google Search Console as a *Domain* property (which covers every subdomain),
 * not as two separate URL-prefix properties. Otherwise the mira.vualet.com
 * entries are dropped as cross-host.
 *
 * Excluded by construction: /api/*, /admin*, /login, /signup and every
 * transactional Mira route. buildPublicRoutes() throws if one ever leaks in.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const entries = buildPublicRoutes().map((route) => ({
    // originFor() itself now answers the serving host for every route while
    // the apex is parked on another product (see src/lib/seo.ts), so no
    // re-homing is needed here; the dedupe below still matters because the
    // corporate home and the Mira home collapse onto one URL.
    url: canonicalFor(route.path),
    lastModified: new Date(`${route.lastModified}T00:00:00Z`),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
  // Re-homing collapses the corporate home onto the Mira home, so the same
  // URL can now appear twice. The first entry wins because route-table order
  // puts the primary page first; duplicate entries split crawl budget.
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.url)) {
      return false;
    }
    seen.add(entry.url);
    return true;
  });
}
