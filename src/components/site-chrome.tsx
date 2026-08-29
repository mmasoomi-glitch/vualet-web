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
      {/* Skip-to-content link for the corporate site only. The Mira sub-brand and /admin are
          excluded because each carries its own chrome and its own skip affordance. tabIndex on
          the target ensures focus actually lands on the main element rather than just scrolling
          the viewport. */}
      <a
        href="#main-content"
        className="absolute left-4 -top-16 z-[60] rounded-lg px-4 py-2 text-sm font-medium bg-[var(--color-vualet-indigo)] text-white transition-all focus:top-4"
      >
        Skip to content
      </a>
      <Nav />
      <main id="main-content" tabIndex={-1} className="flex-1">
        {children}
      </main>
      <Footer />
      <CsBot />
    </>
  );
}
