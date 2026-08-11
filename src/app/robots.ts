import type { MetadataRoute } from "next";
import { SITEMAP_URL, robotsDisallow } from "@/lib/seo";

/**
 * /robots.txt
 *
 * Two jobs:
 *  1. ANNOUNCE THE SITEMAP. A sitemap nothing points at is a sitemap crawlers
 *     never find. The URL must be absolute — robots.txt is a static file with
 *     no metadataBase to resolve against — so it comes from src/lib/seo.ts.
 *  2. Keep transactional / authenticated / control-plane routes out of search,
 *     while allowing the public marketing surface.
 *
 * The disallow list is NOT written here. It is the same list src/lib/seo.ts uses
 * to exclude paths from the sitemap, so robots.txt and sitemap.xml cannot
 * disagree about what is private.
 *
 * Served on both vualet.com and mira.vualet.com (src/middleware.ts). The single
 * announced sitemap lives on the corporate host and lists URLs for both — see
 * the cross-host note in src/app/sitemap.ts.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: robotsDisallow(),
    },
    sitemap: SITEMAP_URL,
  };
}
