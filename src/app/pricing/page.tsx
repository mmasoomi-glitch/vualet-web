import Link from "next/link";
import { Logo } from "@/components/logo";
import { PRODUCTS } from "@/lib/products";

export const metadata = {
  title: "Pricing",
  description:
    "See per-product costs and the Vualet One bundle to understand how Vualet charges for each product and for the bundle based on what you use.",
};

export default function PricingPage() {
  return (
    <>
      <section className="mx-auto max-w-7xl px-6 pt-20 pb-12 text-center">
        <h1
          className="text-4xl md:text-6xl font-semibold tracking-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Pay only for what you use.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-[var(--muted)]">
          Every product has a 14-day free trial. Cancel anytime. Or bundle
          everything with Vualet One.
        </p>
      </section>

      <section id="per-product" className="mx-auto max-w-7xl px-6 py-16">
        <h2
          className="text-2xl font-semibold tracking-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Per-product pricing
        </h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Starts at the price below. Higher tiers add seats, volume, and
          advanced features.
        </p>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {PRODUCTS.map((p) => (
            <div
              key={p.slug}
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-6 flex flex-col"
            >
              <div className="flex items-start justify-between">
                <Logo glyph={p.glyph} size={40} title={p.name} />
                {p.comingSoon && (
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-vualet-indigo-ink)] border border-[var(--color-vualet-indigo)] rounded-full px-2 py-0.5">
                    Soon
                  </span>
                )}
              </div>
              <h3 className="mt-5 text-lg font-semibold tracking-tight">
                {p.name}
              </h3>
              <p className="mt-1 text-sm text-[var(--muted)]">{p.tagline}</p>
              <p
                className="mt-6 text-3xl font-semibold tracking-tight"
                style={{ fontFamily: "var(--font-display)" }}
              >
                ${p.startingPriceUsd}
                <span className="text-base font-normal text-[var(--muted)]">
                  {" "}
                  /user/mo
                </span>
              </p>
              <Link
                href={`/products/${p.slug}`}
                className="mt-6 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border border-[var(--border)] hover:border-[var(--color-vualet-indigo)] transition-colors"
              >
                Learn more
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section id="one" className="border-t border-[var(--border)]">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <div className="rounded-3xl bg-[var(--color-vualet-ink)] text-[var(--color-vualet-text-dark)] p-10 md:p-16 relative overflow-hidden">
            <div className="absolute inset-0 [background:radial-gradient(50%_60%_at_80%_20%,rgba(199,242,90,0.18),transparent_60%)]" />
            <div className="relative grid md:grid-cols-2 gap-12 items-center">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-vualet-lime)]">
                  Vualet One
                </p>
                <h2
                  className="mt-3 text-4xl md:text-5xl font-semibold tracking-tight"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  All of Vualet. One flat price.
                </h2>
                <p className="mt-4 text-lg text-white/70">
                  Every current product. Every future product. One bill per
                  user, billed monthly or annually.
                </p>
                <p
                  className="mt-8 text-5xl md:text-6xl font-semibold tracking-tight"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  $89
                  <span className="text-2xl font-normal text-white/60">
                    {" "}
                    /user/mo
                  </span>
                </p>
                <p className="mt-2 text-sm text-white/60">
                  Billed annually. $109/user/mo billed monthly.
                </p>
                <Link
                  href="/signup?plan=one"
                  className="mt-8 inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-sm font-medium text-[var(--color-vualet-ink)] bg-[var(--color-vualet-lime)] hover:bg-white transition-colors"
                >
                  Start free 14-day trial
                  <span aria-hidden>→</span>
                </Link>
              </div>
              <ul className="space-y-3 text-sm text-white/80">
                {[
                  "Every Vualet product, today and tomorrow",
                  "Unlimited integrations",
                  "Priority support",
                  "SSO and SAML",
                  "Dedicated onboarding manager",
                  "Priority reliability and status updates",
                ].map((b) => (
                  <li key={b} className="flex gap-3">
                    <span className="text-[var(--color-vualet-lime)]">✓</span>
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)]">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h2
            className="text-3xl font-semibold tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Need something custom?
          </h2>
          <p className="mt-4 text-[var(--muted)]">
            We work with larger teams on annual commits, custom SLAs,
            single-tenant deployments, and bilingual onboarding. Tell us what
            you need.
          </p>
          <Link
            href="/contact-sales"
            className="mt-8 inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-sm font-medium text-white bg-[var(--color-vualet-indigo-ink)] hover:bg-[var(--color-vualet-indigo-ink-hover)] transition-colors"
          >
            Talk to sales
            <span aria-hidden>→</span>
          </Link>
        </div>
      </section>
    </>
  );
}
