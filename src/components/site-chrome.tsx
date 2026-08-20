"use client";

import { usePathname } from "next/navigation";
import { Nav } from "@/components/nav";
import { Footer } from "@/components/footer";
import { CsBot } from "@/components/cs-bot";

// Renders the public marketing chrome (nav/footer/support bot) on every page EXCEPT the internal
// /admin dashboard (own sidebar chrome) and the Mira sub-brand (own MiraNav + warm brand).
// `host` is passed from the server layout: the whole mira.* subdomain is the Mira sub-brand, so
// the Vualet corporate chrome is suppressed there regardless of path (the Mira page is served at
// "/" via the reverse proxy, so a pathname check alone would wrongly show a second nav).
export function SiteChrome({ children, host = "" }: { children: React.ReactNode; host?: string }) {
  const pathname = usePathname();
  const isMiraHost = host.toLowerCase().startsWith("mira.");
  const ownChrome = isMiraHost || pathname?.startsWith("/admin") || pathname?.startsWith("/mira");

  if (ownChrome) {
    return <main className="flex-1">{children}</main>;
  }

  return (
    <>
      <Nav />
      <main className="flex-1">{children}</main>
      <Footer />
      <CsBot />
    </>
  );
}
