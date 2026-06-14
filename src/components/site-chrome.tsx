"use client";

import { usePathname } from "next/navigation";
import { Nav } from "@/components/nav";
import { Footer } from "@/components/footer";
import { CsBot } from "@/components/cs-bot";

// Renders the public marketing chrome (nav/footer/support bot) on every page
// EXCEPT the internal /admin dashboard, which provides its own chrome.
export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith("/admin");

  if (isAdmin) {
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
