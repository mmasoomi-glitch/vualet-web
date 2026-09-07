import type { Metadata } from "next";

/**
 * This layout exists ONLY to carry metadata. The page in this segment is a
 * "use client" component and a client component cannot export `metadata`, so
 * without a server layout here these routes inherit the generic Mira title and
 * are fully indexable — a checkout, a sign-in and a signed-in account page,
 * each emitting a self-referential canonical that invites a crawler in.
 *
 * follow stays TRUE on purpose: noindex-nofollow would stop the crawl passing
 * through to the public pages these link to.
 *
 * It deliberately sets NEITHER metadataBase NOR alternates/canonical. Those are
 * inherited from src/app/mira/layout.tsx, which sets its own metadataBase
 * because the Mira sub-brand is served from its own origin. Re-declaring them
 * here is how the vualet.com-canonical-on-mira.vualet.com defect happened.
 */
export const metadata: Metadata = {
  // The Mira layout applies the template "%s · Mira", so this must NOT repeat
  // the suffix or the tab reads "Your account · Mira · Mira".
  title: "Your account",
  robots: { index: false, follow: true },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
