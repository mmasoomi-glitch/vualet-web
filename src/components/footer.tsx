import Link from "next/link";
import { Logo, Wordmark } from "./logo";

const columns = [
  {
    title: "Products",
    links: [
      { name: "WhatsApp AI Agents", href: "/products/whatsapp-agents" },
      { name: "CRM Automation", href: "/products/crm" },
      { name: "Employee Hub", href: "/products/hr" },
      { name: "Omnichannel Inbox", href: "/products/inbox" },
      { name: "All products", href: "/products" },
    ],
  },
  {
    title: "Pricing",
    links: [
      { name: "Per-product", href: "/pricing" },
      { name: "Vualet One", href: "/pricing#one" },
      { name: "Enterprise", href: "/contact-sales" },
    ],
  },
  {
    title: "Company",
    links: [
      { name: "Customers", href: "/customers" },
      { name: "About", href: "/about" },
      { name: "Contact", href: "/contact" },
      { name: "Changelog", href: "/changelog" },
    ],
  },
  {
    title: "Resources",
    links: [
      { name: "Docs", href: "/docs" },
      { name: "Status", href: "https://status.vualet.com" },
      { name: "Security", href: "/security" },
      { name: "Privacy", href: "/legal/privacy" },
      { name: "Terms", href: "/legal/terms" },
      { name: "Refund Policy", href: "/legal/refund" },
      { name: "AI Disclosure", href: "/legal/ai-disclosure" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-[var(--border)] bg-[var(--surface-2)]">
      <div className="mx-auto max-w-7xl px-6 py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center gap-2.5">
              <Logo size={28} />
              <Wordmark />
            </Link>
            <p className="mt-4 text-sm text-[var(--muted)] max-w-xs">
              Software that runs your business for you.
            </p>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                {col.title}
              </p>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.name}>
                    <Link
                      href={l.href}
                      className="text-sm text-[var(--foreground)] hover:text-[var(--color-vualet-indigo)] transition-colors"
                    >
                      {l.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 pt-8 border-t border-[var(--border)] flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <p className="text-xs text-[var(--muted)]">
            © {new Date().getFullYear()} Vualet — from Vualet Trading (a sole proprietorship), Dubai, UAE.
          </p>
          <p className="text-xs text-[var(--muted)]">
            Sold by Dodo Payments, our merchant of record
          </p>
        </div>
      </div>
    </footer>
  );
}
