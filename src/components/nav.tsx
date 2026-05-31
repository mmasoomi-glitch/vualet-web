"use client";

import Link from "next/link";
import { useState } from "react";
import { Logo, Wordmark } from "./logo";

const productGroups = [
  {
    title: "Customer Conversations",
    items: [
      { name: "WhatsApp AI Agents", href: "/products/whatsapp-agents", desc: "24/7 sales + support on WhatsApp." },
      { name: "Omnichannel Inbox", href: "/products/inbox", desc: "WhatsApp, email, IG and web — one queue." },
    ],
  },
  {
    title: "Sales & CRM",
    items: [
      { name: "CRM Automation", href: "/products/crm", desc: "Pipelines, sequences, follow-ups on autopilot." },
      { name: "Quote-to-Cash", href: "/products/quotes", desc: "Quotes, invoices, payment links." },
    ],
  },
  {
    title: "HR & People",
    items: [
      { name: "Employee Hub", href: "/products/hr", desc: "Onboarding, leave, payroll inputs." },
      { name: "Performance", href: "/products/performance", desc: "Reviews, 1:1s, goals." },
    ],
  },
];

export function Nav() {
  const [productsOpen, setProductsOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 backdrop-blur-md bg-[var(--background)]/80 border-b border-[var(--border)]">
      <div className="mx-auto max-w-7xl px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo size={32} />
          <Wordmark />
        </Link>

        <nav className="hidden md:flex items-center gap-1 text-sm">
          <div
            className="relative"
            onMouseEnter={() => setProductsOpen(true)}
            onMouseLeave={() => setProductsOpen(false)}
          >
            <button className="px-3 py-2 rounded-md text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">
              Products
            </button>
            {productsOpen && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 pt-2 w-[640px]">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-2 shadow-2xl">
                  <div className="grid grid-cols-3 gap-2">
                    {productGroups.map((group) => (
                      <div key={group.title} className="p-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
                          {group.title}
                        </p>
                        <ul className="space-y-2">
                          {group.items.map((item) => (
                            <li key={item.name}>
                              <Link
                                href={item.href}
                                className="block rounded-lg p-2 -mx-2 hover:bg-[var(--background)] transition-colors"
                              >
                                <p className="text-sm font-medium text-[var(--foreground)]">
                                  {item.name}
                                </p>
                                <p className="text-xs text-[var(--muted)] mt-0.5">
                                  {item.desc}
                                </p>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
          <Link href="/pricing" className="px-3 py-2 rounded-md text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">
            Pricing
          </Link>
          <Link href="/customers" className="px-3 py-2 rounded-md text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">
            Customers
          </Link>
          <Link href="/docs" className="px-3 py-2 rounded-md text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">
            Docs
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="hidden md:inline px-3 py-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white bg-[var(--color-vualet-indigo)] hover:bg-[var(--color-vualet-indigo-hover)] transition-colors"
          >
            Start free
            <span aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
