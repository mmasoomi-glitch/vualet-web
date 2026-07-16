import Link from "next/link";
import type { ReactNode } from "react";
import styles from "../legal.module.css";

const LEGAL_LINKS = [
  { href: "/legal/privacy", label: "Privacy Policy" },
  { href: "/legal/terms", label: "Terms of Service" },
  { href: "/legal/refund", label: "Refund Policy" },
  { href: "/legal/ai-disclosure", label: "AI Disclosure" },
];

export function LegalPage({
  title,
  lastUpdated,
  intro,
  activeHref,
  children,
}: {
  title: string;
  lastUpdated: string;
  intro?: string;
  activeHref: string;
  children: ReactNode;
}) {
  return (
    <article>
      <nav className={styles.crumbs} aria-label="Legal pages">
        {LEGAL_LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`${styles.crumbLink} ${l.href === activeHref ? styles.crumbLinkActive : ""}`}
          >
            {l.label}
          </Link>
        ))}
      </nav>

      <h1 className={styles.h1} style={{ fontFamily: "var(--font-display)" }}>
        {title}
      </h1>
      <p className={styles.meta}>Last updated: {lastUpdated}</p>
      {intro && <p className={styles.intro}>{intro}</p>}

      <div className={styles.prose}>{children}</div>

      <div className={styles.footerNote}>
        <p>
          This policy is issued by <strong>Afaq Alnaseem Trading LLC</strong>,
          Dubai, United Arab Emirates (TRN 100475523500003), the operator of
          Vualet and Mira. Questions? Contact{" "}
          <a href="mailto:legal@vualet.com">legal@vualet.com</a>.
        </p>
      </div>
    </article>
  );
}
