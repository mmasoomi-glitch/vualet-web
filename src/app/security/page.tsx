import Link from "next/link";

export const metadata = {
  title: "Security",
  description:
    "How to report a security issue to Vualet and how we handle responsible disclosure.",
};

export default function SecurityPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-24">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-vualet-indigo)]">
        Security
      </p>
      <h1
        className="mt-3 text-4xl md:text-5xl font-semibold tracking-tight"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Responsible disclosure.
      </h1>
      <div className="mt-6 space-y-5 text-lg text-[var(--muted)] leading-relaxed">
        <p>
          We take the security of Vualet and its products seriously. If you
          believe you&apos;ve found a vulnerability, please tell us before
          disclosing it publicly so we can protect our users while we fix it.
        </p>
        <p>
          Email{" "}
          <a
            href="mailto:security@vualet.com"
            className="text-[var(--foreground)] underline hover:text-[var(--color-vualet-indigo)]"
          >
            security@vualet.com
          </a>{" "}
          with a description of the issue and the steps to reproduce it.
          We&apos;ll acknowledge your report, keep you updated on our progress,
          and credit you once the issue is resolved if you&apos;d like.
        </p>
        <p>
          Please act in good faith: avoid privacy violations, data destruction,
          and any disruption to our services while you research.
        </p>
        {/* /security/journalists was an ORPHAN: in the sitemap and in the
            SiteNavigationElement structured data, but linked from nowhere on
            the site. It was advertised to search engines while no visitor
            could reach it. Its parent page is the right place to link it. */}
        <p>
          If you are a journalist, a researcher, or anyone whose safety depends
          on the answer, a separate page sets out exactly what is verified about
          each product and what is not:{" "}
          <Link
            href="/security/journalists"
            className="text-[var(--foreground)] underline hover:text-[var(--color-vualet-indigo)]"
          >
            Security information for journalists and researchers
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
