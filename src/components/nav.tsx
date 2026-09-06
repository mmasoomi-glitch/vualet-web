"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const productsRef = useRef<HTMLDivElement>(null);

  // Esc closes whichever menu is open, and returns focus sensibly.
  useEffect(() => {
    if (!productsOpen && !mobileOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setProductsOpen(false);
        setMobileOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [productsOpen, mobileOpen]);

  // Close the Products dropdown when focus or a click leaves it entirely
  // (keyboard tab-out and outside click), without stealing focus from links.
  useEffect(() => {
    if (!productsOpen) return;
    function onDocInteract(e: Event) {
      if (productsRef.current && !productsRef.current.contains(e.target as Node)) {
        setProductsOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocInteract);
    document.addEventListener("focusin", onDocInteract);
    return () => {
      document.removeEventListener("mousedown", onDocInteract);
      document.removeEventListener("focusin", onDocInteract);
    };
  }, [productsOpen]);

  return (
    <header className="sticky top-0 z-50 backdrop-blur-md bg-[var(--background)]/80 border-b border-[var(--border)]">
      <div className="mx-auto max-w-7xl px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo size={32} />
          <Wordmark />
        </Link>

        <nav className="hidden md:flex items-center gap-1 text-sm">
          <div
            ref={productsRef}
            className="relative"
            onMouseEnter={() => setProductsOpen(true)}
            onMouseLeave={() => setProductsOpen(false)}
          >
            <button
              type="button"
              aria-haspopup="true"
              aria-expanded={productsOpen}
              onClick={() => setProductsOpen((o) => !o)}
              onFocus={() => setProductsOpen(true)}
              className="px-3 py-2 rounded-md text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
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
                                onClick={() => setProductsOpen(false)}
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
          {/* Customers and Docs removed: both are empty placeholder pages, excluded from sitemap; header links waste visitor clicks. Restore when pages have content. */}
          <Link href="/pricing" className="px-3 py-2 rounded-md text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">
            Pricing
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
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white bg-[var(--color-vualet-indigo-ink)] hover:bg-[var(--color-vualet-indigo-ink-hover)] transition-colors"
          >
            Start free
            <span aria-hidden>→</span>
          </Link>

          {/* Mobile disclosure — visible below md only */}
          <button
            type="button"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            onClick={() => setMobileOpen((o) => !o)}
            className="md:hidden grid place-items-center w-10 h-10 rounded-md text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
          >
            {mobileOpen ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile menu panel */}
      {mobileOpen && (
        <nav
          id="mobile-nav"
          className="md:hidden border-t border-[var(--border)] bg-[var(--background)] px-6 py-4 text-sm"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">
            Products
          </p>
          <ul className="space-y-1 mb-4">
            {productGroups.flatMap((group) =>
              group.items.map((item) => (
                <li key={item.name}>
                  <Link
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className="block rounded-lg px-2 py-2 -mx-2 text-[var(--foreground)] hover:bg-[var(--surface-2)] transition-colors"
                  >
                    {item.name}
                  </Link>
                </li>
              )),
            )}
          </ul>
          <ul className="space-y-1 border-t border-[var(--border)] pt-3">
            {[
              { name: "Pricing", href: "/pricing" },
              { name: "Sign in", href: "/login" },
            ].map((link) => (
              <li key={link.name}>
                <Link
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="block rounded-lg px-2 py-2 -mx-2 text-[var(--foreground)] hover:bg-[var(--surface-2)] transition-colors"
                >
                  {link.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
