"use client";

import { usePathname } from "next/navigation";
import { Nav } from "@/components/nav";
import { Footer } from "@/components/footer";
import { CsBot } from "@/components/cs-bot";

// Renders the public marketing chrome (nav/footer/support bot) on every page EXCEPT the internal
// /admin dashboard (own sidebar chrome) and the Mira sub-brand pages (own MiraNav + warm brand).
export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const ownChrome = pathname?.startsWith("/admin") || pathname?.startsWith("/mira");

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
