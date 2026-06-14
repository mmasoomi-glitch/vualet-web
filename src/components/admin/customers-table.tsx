"use client";

import { useMemo, useState } from "react";
import { Card, StatusBadge } from "./ui";
import { CustomerDrawer } from "./customer-drawer";
import type { Customer, CustomerStatus } from "@/lib/admin-stub";
import { fmtDate, usd } from "@/lib/admin-stub";

const STATUS_FILTERS: ("all" | CustomerStatus)[] = ["all", "active", "trialing", "past_due", "suspended", "canceled"];
const STATUS_FILTER_LABEL: Record<string, string> = {
  all: "All",
  active: "Active",
  trialing: "Trial",
  past_due: "Past due",
  suspended: "Suspended",
  canceled: "Canceled",
};

export function CustomersTable({ customers }: { customers: Customer[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | CustomerStatus>("all");
  const [selected, setSelected] = useState<Customer | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return customers.filter((c) => {
      if (status !== "all" && c.status !== status) return false;
      if (!needle) return true;
      return (
        c.name.toLowerCase().includes(needle) ||
        c.email.toLowerCase().includes(needle) ||
        c.plan.toLowerCase().includes(needle) ||
        c.channel.toLowerCase().includes(needle)
      );
    });
  }, [customers, q, status]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, email, plan, channel…"
          className="w-full sm:w-80 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-vualet-indigo)]"
        />
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium border transition-colors ${
                status === s
                  ? "border-[var(--color-vualet-indigo)] bg-[var(--color-vualet-indigo)] text-white"
                  : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {STATUS_FILTER_LABEL[s]}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-[var(--muted)]">{filtered.length} of {customers.length}</span>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wider text-[var(--muted)]">
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium">Channel</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Credits</th>
                <th className="px-4 py-3 font-medium">MRR</th>
                <th className="px-4 py-3 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const pct = c.creditsIncluded > 0 ? Math.min(100, (c.creditsUsed / c.creditsIncluded) * 100) : 0;
                return (
                  <tr
                    key={c.id}
                    onClick={() => setSelected(c)}
                    className="border-b border-[var(--border)] last:border-0 cursor-pointer hover:bg-[var(--surface-2)] transition-colors"
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-[var(--foreground)]">{c.name}</p>
                      <p className="text-xs text-[var(--muted)]">{c.email}</p>
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">{c.plan}</td>
                    <td className="px-4 py-3 text-[var(--muted)]">{c.channel}</td>
                    <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
                          <div
                            className={`h-full rounded-full ${pct >= 100 ? "bg-[var(--color-vualet-danger)]" : "bg-[var(--color-vualet-indigo)]"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-[var(--muted)] tabular-nums">
                          {c.creditsUsed.toLocaleString()}/{c.creditsIncluded.toLocaleString()}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{usd(c.mrrUsd)}</td>
                    <td className="px-4 py-3 text-[var(--muted)]">{fmtDate(c.joined)}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-[var(--muted)]">
                    No customers match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <CustomerDrawer customer={selected} onClose={() => setSelected(null)} />
    </>
  );
}
