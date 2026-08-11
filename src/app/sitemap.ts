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
  return buildPublicRoutes().map((route) => ({
    url: canonicalFor(route.path),
    lastModified: new Date(`${route.lastModified}T00:00:00Z`),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
