import type { ReactNode } from "react";
import styles from "./legal.module.css";

// Shared chrome for every /legal/* trust page (privacy, terms, refund,
// ai-disclosure). Nav/Footer/CsBot are added by SiteChrome already since
// these routes don't start with /admin or /mira.
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <div className={styles.container}>{children}</div>
    </div>
  );
}
