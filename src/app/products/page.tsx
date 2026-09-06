import Link from "next/link";
import { Logo } from "@/components/logo";
import { PRODUCTS } from "@/lib/products";

export const metadata = {
  title: "Products",
  description:
    "See Mira, WhatsApp AI Agents, CRM Automation, Employee Hub, Omnichannel Inbox, and the other Vualet tools in one view.",
};

export default function ProductsIndex() {
  const byCategory = PRODUCTS.reduce<Record<string, typeof PRODUCTS>>((acc, p) => {
    (acc[p.category] ??= []).push(p);
    return acc;
  }, {});

  return (
    <div className="mx-auto max-w-7xl px-6 py-20">
      <h1
        className="text-4xl md:text-5xl font-semibold tracking-tight"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Every Vualet product.
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-[var(--muted)]">
        Mix and match. Start with one. Add more as you grow.
      </p>

      <div className="mt-16 space-y-16">
        {Object.entries(byCategory).map(([cat, items]) => (
          <div key={cat}>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-vualet-indigo-ink)]">
              {cat}
            </p>
            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map((p) => (
                <Link
                  key={p.slug}
                  href={`/products/${p.slug}`}
                  className="group rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-6 hover:border-[var(--color-vualet-indigo)] transition-colors"
                >
                  <Logo glyph={p.glyph} size={40} title={p.name} />
                  <h3 className="mt-5 text-lg font-semibold tracking-tight">
                    {p.name}
                    {p.comingSoon && (
                      <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-vualet-indigo-ink)] border border-[var(--color-vualet-indigo)] rounded-full px-2 py-0.5 align-middle">
                        Soon
                      </span>
                    )}
                  </h3>
                  <p className="mt-2 text-sm text-[var(--muted)] leading-relaxed">
                    {p.tagline}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
