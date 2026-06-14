"use client";

import { useState } from "react";
import { Card } from "./ui";
import type { RefundRequest } from "@/lib/admin-stub";
import { fmtDate, usd2 } from "@/lib/admin-stub";

const BADGE: Record<RefundRequest["status"], string> = {
  pending: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  approved: "bg-[var(--color-vualet-success)]/12 text-[var(--color-vualet-success)]",
  denied: "bg-[var(--color-vualet-danger)]/12 text-[var(--color-vualet-danger)]",
};

export function RefundsQueue({ initial }: { initial: RefundRequest[] }) {
  const [rows, setRows] = useState(initial);

  // STUB: optimistically update local state only. A real action must POST to an
  // admin endpoint (and Stripe) and reconcile from the server response.
  function decide(id: string, status: "approved" | "denied") {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status } : r)));
  }

  const pendingCount = rows.filter((r) => r.status === "pending").length;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <h2 className="text-sm font-semibold">Refund queue</h2>
        <span className="text-xs text-[var(--muted)]">{pendingCount} pending</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wider text-[var(--muted)]">
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Reason</th>
              <th className="px-4 py-3 font-medium">Requested</th>
              <th className="px-4 py-3 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-[var(--border)] last:border-0">
                <td className="px-4 py-3">
                  <p className="font-medium">{r.customerName}</p>
                  <p className="text-xs text-[var(--muted)]">{r.customerEmail}</p>
                </td>
                <td className="px-4 py-3 tabular-nums font-medium">{usd2(r.amountUsd)}</td>
                <td className="px-4 py-3 text-[var(--muted)] max-w-xs">{r.reason}</td>
                <td className="px-4 py-3 text-[var(--muted)]">{fmtDate(r.requested)}</td>
                <td className="px-4 py-3">
                  {r.status === "pending" ? (
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => decide(r.id, "approved")}
                        className="rounded-md bg-[var(--color-vualet-success)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => decide(r.id, "denied")}
                        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--surface-2)] transition-colors"
                      >
                        Deny
                      </button>
                    </div>
                  ) : (
                    <div className="flex justify-end">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${BADGE[r.status]}`}>
                        {r.status}
                      </span>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2.5 text-[11px] text-[var(--muted)] border-t border-[var(--border)]">
        Approve/deny is stubbed (local state only). Wire to a real admin + Stripe refund endpoint.
      </p>
    </Card>
  );
}
