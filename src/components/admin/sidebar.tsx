"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/logo";

const NAV = [
  { href: "/admin", label: "Overview", icon: "M3 3h7v7H3V3zm0 11h7v7H3v-7zm11 0h7v7h-7v-7zm0-11h7v7h-7V3z" },
  { href: "/admin/customers", label: "Customers", icon: "M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 21v-1a6 6 0 0112 0v1" },
  { href: "/admin/billing", label: "Billing", icon: "M3 6h18v12H3V6zm0 4h18" },
  { href: "/admin/health", label: "Health", icon: "M3 12h4l2 6 4-12 2 6h6" },
];

function isActive(pathname: string, href: string) {
  if (href === "/admin") return pathname === "/admin";
  return pathname.startsWith(href);
}

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden sticky top-0 z-40 flex items-center justify-between border-b border-[var(--border)] bg-[var(--background)] px-4 h-14">
        <Link href="/admin" className="flex items-center gap-2">
          <Logo size={26} />
          <span className="text-sm font-semibold">Vualet Admin</span>
        </Link>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
          aria-label="Toggle navigation"
        >
          Menu
        </button>
      </div>

      <aside
        className={`${open ? "block" : "hidden"} md:block md:fixed md:inset-y-0 md:left-0 md:w-60 border-b md:border-b-0 md:border-r border-[var(--border)] bg-[var(--surface-2)] z-30`}
      >
        <div className="flex h-full flex-col">
          <div className="hidden md:flex items-center gap-2 px-5 h-16 border-b border-[var(--border)]">
            <Logo size={28} />
            <div className="leading-tight">
              <p className="text-sm font-semibold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
                Vualet Admin
              </p>
              <p className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Mira ops</p>
            </div>
          </div>

          <nav className="flex-1 p-3 space-y-1">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "bg-[var(--color-vualet-indigo)] text-white"
                      : "text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--background)]"
                  }`}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d={item.icon} />
                  </svg>
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-[var(--border)] p-3">
            <div className="px-3 py-2 mb-1 rounded-lg bg-[var(--background)]">
              <p className="text-xs font-medium text-[var(--foreground)]">ops@vualet.com</p>
              <p className="text-[10px] text-[var(--muted)]">Internal team</p>
            </div>
            <button
              onClick={async () => {
                await fetch("/api/admin/login", { method: "DELETE" }).catch(() => {});
                window.location.href = "/admin-login";
              }}
              className="w-full text-left rounded-lg px-3 py-2 text-sm text-[var(--muted)] hover:text-[var(--color-vualet-danger)] hover:bg-[var(--background)] transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
