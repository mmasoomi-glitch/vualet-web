import { ORIGIN_MAIN, canonicalFor } from "@/lib/seo";

/**
 * Renders a script tag containing JSON-LD structured data.
 * JSON.stringify output is inserted via dangerouslySetInnerHTML.
 * The data passed in is authored by this application and never user input.
 * This is the standard way to emit structured data in React.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export function organizationSchema(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Vualet",
    // The registered trading name, enforced by scripts/brand-identity-test.mjs.
    // Earlier trading identities are retired and must not reappear anywhere.
    legalName: "Vualet Trading",
    url: ORIGIN_MAIN,
    description:
      "Vualet is an independent software company building an assistant, a VPN, and encrypted file storage. Its public claims are limited to what it can verify.",
    email: "info@vualet.com",
  };
}

export function articleSchema(input: {
  title: string;
  description: string;
  datePublished: string;
  path: string;
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: input.title,
    description: input.description,
    datePublished: input.datePublished,
    url: canonicalFor(input.path),
    author: {
      "@type": "Organization",
      name: "Vualet",
    },
    publisher: {
      "@type": "Organization",
      name: "Vualet",
    },
  };
}
