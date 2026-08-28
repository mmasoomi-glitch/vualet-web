"use client";

import { useMemo, useState } from "react";
import type { AdminCustomer } from "@/lib/admin-data";
import { fmtDate } from "@/lib/admin-format";
import { Card, Pill, StatusBadge } from "./ui";
import { CustomerDrawer } from "./customer-drawer";

const STATUS_FILTERS = ["all", "active", "pending", "bound", "cancelled", "refunded", "chargeback", "on_hold", "paused"];

const STATUS_LABELS: Record<string, string> = {
  all: "All", active: "Active", pending: "Pending", bound: "Bound",
  cancelled: "Cancelled", refunded: "Refunded", chargeback: "Chargeback",
  on_hold: "On hold", paused: "Paused",
};

export function CustomersTable({ customers }: { customers: AdminCustomer[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<AdminCustomer | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return customers.filter((c) => {
      if (status !== "all" && c.status !== status) return false;
      if (!needle) return true;
      return (
        c.email.toLowerCase().includes(needle) ||
        c.plan.toLowerCase().includes(needle) ||
        c.channel.toLowerCase().includes(needle) ||
        c.id.toLowerCase().includes(needle)
      );
    });
  }, [customers, q, status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search email, plan, channel, id..."
          className="w-full sm:w-80 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-vualet-indigo)]"
        />
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-md px-2.5 py-1.5 text-xs font-medium border transition-colors ${status === s ? "border-[var(--color-vualet-indigo)] bg-[var(--color-vualet-indigo)] text-white" : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"}`}
          >
            {STATUS_LABELS[s]}
          </button>
        ))}
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
                <th className="px-4 py-3 font-medium">WhatsApp</th>
                <th className="px-4 py-3 font-medium">Joined</th>
                {/* Credits/MRR columns removed: the live store holds no usage or price data; columns of invented numbers were removed rather than filled with dashes. */}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setSelected(c)}
                  className="border-b border-[var(--border)] last:border-0 cursor-pointer hover:bg-[var(--surface-2)] transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">{c.email}</div>
                    <div className="text-xs text-[var(--muted)] font-mono">{c.id}</div>
                  </td>
                  <td className="px-4 py-3 text-[var(--muted)]">{c.plan}</td>
                  <td className="px-4 py-3 text-[var(--muted)]">{c.channel}</td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-4 py-3">{c.bound ? <Pill>Linked</Pill> : <span className="text-xs text-[var(--muted)]">Not linked</span>}</td>
                  <td className="px-4 py-3">{fmtDate(c.joined)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-[var(--muted)]">No customers match your filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <CustomerDrawer customer={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
