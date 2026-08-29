import { permanentRedirect } from "next/navigation";

// The waitlist era is over: the live funnel entry is /mira/start (wizard ->
// checkout -> pairing). This page is already delisted from the sitemap; the
// redirect catches old links and bookmarks so nobody dead-ends on a waitlist
// while the product is actually buyable. 308 (permanent) on purpose - crawlers
// that still hold the old URL should transfer it to the real entry.
export default function MiraSignupRedirect(): never {
  permanentRedirect("/mira/start");
}
