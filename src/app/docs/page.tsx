import Link from "next/link";

export const metadata = { title: "Docs" };

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-24 text-center">
      <h1
        className="text-4xl md:text-5xl font-semibold tracking-tight"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Docs are landing soon.
      </h1>
      <p className="mt-4 text-lg text-[var(--muted)]">
        Per-product guides, API references, and integration walkthroughs.
        We&apos;re building them in Mintlify and they&apos;ll live at{" "}
        <code className="text-sm font-mono">docs.vualet.com</code>.
      </p>
      <Link
        href="/"
        className="mt-8 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-medium border border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors"
      >
        Back home
      </Link>
    </div>
  );
}
