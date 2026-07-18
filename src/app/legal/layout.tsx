import type { ReactNode } from "react";
import { headers } from "next/headers";
import styles from "./legal.module.css";
import MiraNav from "../mira/_components/MiraNav";
import MiraBot from "../mira/_components/MiraBot";
import "../mira/mira-theme.css";

// Shared chrome for every /legal/* trust page (privacy, terms, refund,
// ai-disclosure). On the main vualet.com host, SiteChrome already adds the
// Vualet Nav/Footer (these routes don't start with /admin or /mira, so
// SiteChrome's ownChrome check is false there). But on the mira.* subdomain,
// SiteChrome suppresses ALL chrome unconditionally (isMiraHost is true for
// every path, not just /mira) — so /legal/* previously rendered with zero
// navigation on mira.vualet.com, leaving users with no way back. Add the
// Mira nav ourselves, gated on the same host check, so it never doubles up
// with SiteChrome's Vualet nav on the main site.
export default async function LegalLayout({ children }: { children: ReactNode }) {
  const host = (await headers()).get("host") ?? "";
  const isMiraHost = host.toLowerCase().startsWith("mira.");
  return (
    <div className={styles.page}>
      {isMiraHost && (
        <div className="mira-root">
          <MiraNav cta />
          <MiraBot />
        </div>
      )}
      <div className={styles.container}>{children}</div>
    </div>
  );
}
