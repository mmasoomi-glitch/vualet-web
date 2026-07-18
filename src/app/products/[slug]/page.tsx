import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/components/logo";
import { PRODUCTS } from "@/lib/products";

export function generateStaticParams() {
  return PRODUCTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = PRODUCTS.find((p) => p.slug === slug);
  if (!product) return {};
  return {
    title: product.name,
    description: product.tagline,
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = PRODUCTS.find((p) => p.slug === slug);
  if (!product) notFound();

  return (
    <>
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 [background:radial-gradient(50%_60%_at_50%_0%,rgba(91,91,246,0.12),transparent_60%)]" />
        <div className="mx-auto max-w-5xl px-6 pt-20 pb-16">
          <Logo glyph={product.glyph} size={64} title={product.name} />
          <p className="mt-6 text-xs font-semibold uppercase tracking-wider text-[var(--color-vualet-indigo)]">
            {product.category}
          </p>
          <h1
            className="mt-2 text-4xl md:text-6xl font-semibold tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {product.name}
          </h1>
          <p className="mt-4 max-w-2xl text-lg md:text-xl text-[var(--muted)] leading-relaxed">
            {product.tagline}
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-sm font-medium text-white bg-[var(--color-vualet-indigo)] hover:bg-[var(--color-vualet-indigo-hover)] transition-colors"
            >
              Start free
              <span aria-hidden>→</span>
            </Link>
            <Link
              href="/contact-sales"
              className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-sm font-medium border border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors"
            >
              Book a demo
            </Link>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)] bg-[var(--surface-2)]">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <div className="grid md:grid-cols-2 gap-12">
            <div>
              <h2
                className="text-3xl font-semibold tracking-tight"
                style={{ fontFamily: "var(--font-display)" }}
              >
                What you get
              </h2>
              <p className="mt-4 text-[var(--muted)] leading-relaxed">
                {product.description}
              </p>
            </div>
            <ul className="space-y-4">
              {product.bullets.map((b) => (
                <li key={b} className="flex gap-3">
                  <span
                    className="mt-1 inline-block w-5 h-5 rounded-full flex-shrink-0"
                    style={{
                      background: "var(--color-vualet-indigo)",
                      mask: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'><path d='M16.7 5.3a1 1 0 0 1 0 1.4l-7.4 7.4a1 1 0 0 1-1.4 0L3.3 9.5A1 1 0 0 1 4.7 8.1l3 3 6.6-6.8a1 1 0 0 1 1.4 0z' fill='black'/></svg>\") center/contain no-repeat",
                      WebkitMask:
                        "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'><path d='M16.7 5.3a1 1 0 0 1 0 1.4l-7.4 7.4a1 1 0 0 1-1.4 0L3.3 9.5A1 1 0 0 1 4.7 8.1l3 3 6.6-6.8a1 1 0 0 1 1.4 0z' fill='black'/></svg>\") center/contain no-repeat",
                    }}
                  />
                  <span className="text-sm leading-relaxed">{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)]">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Pricing
              </p>
              <p
                className="mt-2 text-3xl font-semibold tracking-tight"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {product.slug === "mira" ? "" : "From "}${product.startingPriceUsd}
                <span className="text-lg text-[var(--muted)] font-normal">
                  {" "}
                  {product.slug === "mira" ? "/mo" : "/user/mo"}
                </span>
              </p>
              <p className="mt-2 text-sm text-[var(--muted)]">
                {product.slug === "mira"
                  ? "14-day free trial. Card required at signup — you won't be charged until the trial ends."
                  : "14-day free trial. No credit card."}
              </p>
            </div>
            <Link
              href="/pricing"
              className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-sm font-medium text-white bg-[var(--color-vualet-indigo)] hover:bg-[var(--color-vualet-indigo-hover)] transition-colors"
            >
              See all tiers
              <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
