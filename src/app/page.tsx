import Link from "next/link";
import { Logo } from "@/components/logo";
import { PRODUCTS } from "@/lib/products";

export default function Home() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 [background:radial-gradient(60%_60%_at_50%_0%,rgba(91,91,246,0.15),transparent_60%)]" />
        <div className="mx-auto max-w-7xl px-6 pt-24 pb-20 md:pt-32 md:pb-28">
          <div className="max-w-4xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1 text-xs font-medium text-[var(--muted)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-vualet-lime)]" />
              New — the Vualet family is launching, starting with Mira
            </div>
            <h1
              className="mt-6 text-5xl md:text-7xl font-semibold tracking-tight leading-[1.05]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Software that runs<br />
              your business <span className="text-[var(--color-vualet-indigo)]">for you.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg md:text-xl text-[var(--muted)] leading-relaxed">
              Vualet is a Dubai product family building software that runs your
              business for you. Mira, our personal assistant, is first — she works
              inside your own WhatsApp. CRM automation, people tools and more are
              coming soon, under one login and one bill.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row gap-3">
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
                Talk to sales
              </Link>
            </div>
            <p className="mt-6 text-xs text-[var(--muted)]">
              Free 14-day trial · No credit card · Cancel anytime
            </p>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)] bg-[var(--surface-2)]">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="flex items-end justify-between gap-6 flex-wrap">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-vualet-indigo)]">
                One platform, many tools
              </p>
              <h2
                className="mt-2 text-3xl md:text-4xl font-semibold tracking-tight"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Pick the products you need. Pay for what you use.
              </h2>
            </div>
            <Link
              href="/products"
              className="text-sm font-medium text-[var(--color-vualet-indigo)] hover:underline"
            >
              All products →
            </Link>
          </div>

          <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {PRODUCTS.map((p) => (
              <Link
                key={p.slug}
                href={`/products/${p.slug}`}
                className="group relative rounded-2xl border border-[var(--border)] bg-[var(--background)] p-6 hover:border-[var(--color-vualet-indigo)] transition-colors"
              >
                <div className="flex items-start justify-between">
                  <Logo glyph={p.glyph} size={44} title={p.name} />
                  {p.comingSoon && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-vualet-indigo)] border border-[var(--color-vualet-indigo)] rounded-full px-2 py-0.5">
                      Soon
                    </span>
                  )}
                </div>
                <h3 className="mt-5 text-lg font-semibold tracking-tight">
                  {p.name}
                </h3>
                <p className="mt-1 text-xs uppercase tracking-wider text-[var(--muted)]">
                  {p.category}
                </p>
                <p className="mt-4 text-sm text-[var(--muted)] leading-relaxed">
                  {p.tagline}
                </p>
                <div className="mt-6 flex items-center justify-between">
                  <p className="text-xs text-[var(--muted)]">
                    From <span className="font-semibold text-[var(--foreground)]">${p.startingPriceUsd}</span>/user/mo
                  </p>
                  <span className="text-sm text-[var(--color-vualet-indigo)] opacity-0 group-hover:opacity-100 transition-opacity">
                    Learn more →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)]">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <div className="rounded-3xl overflow-hidden bg-[var(--color-vualet-ink)] text-[var(--color-vualet-text-dark)] p-10 md:p-16 relative">
            <div className="absolute inset-0 [background:radial-gradient(50%_60%_at_80%_20%,rgba(199,242,90,0.18),transparent_60%)]" />
            <div className="relative max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-vualet-lime)]">
                Vualet One
              </p>
              <h2
                className="mt-3 text-3xl md:text-5xl font-semibold tracking-tight"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Everything Vualet ships. One flat price per user.
              </h2>
              <p className="mt-4 text-lg text-white/70">
                For teams that want the whole platform — every current product
                and every future one — at a price that makes the math easy.
              </p>
              <div className="mt-10 flex flex-col sm:flex-row gap-3">
                <Link
                  href="/pricing#one"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-sm font-medium text-[var(--color-vualet-ink)] bg-[var(--color-vualet-lime)] hover:bg-white transition-colors"
                >
                  See Vualet One pricing
                  <span aria-hidden>→</span>
                </Link>
                <Link
                  href="/contact-sales"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-sm font-medium text-white border border-white/20 hover:bg-white/5 transition-colors"
                >
                  Talk to sales
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)] bg-[var(--surface-2)]">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)] text-center">
            Built in Dubai. Shipped to the world.
          </p>
          <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              ["One login", "Across every product"],
              ["One bill", "In USD or AED"],
              ["VAT-ready", "TRN 100475523500003"],
              ["Arabic & English", "RTL built in"],
            ].map(([t, s]) => (
              <div key={t}>
                <p
                  className="text-2xl font-semibold tracking-tight"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {t}
                </p>
                <p className="mt-1 text-sm text-[var(--muted)]">{s}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
