"use client";

import { StatusBadge } from "./ui";
import type { Customer } from "@/lib/admin-stub";
import { fmtDate, getUsageHistory, usd } from "@/lib/admin-stub";

export function CustomerDrawer({ customer, onClose }: { customer: Customer | null; onClose: () => void }) {
  if (!customer) return null;
  const c = customer;
  const usage = getUsageHistory(c.id);
  const pct = c.creditsIncluded > 0 ? Math.min(100, (c.creditsUsed / c.creditsIncluded) * 100) : 0;

  // STUB ACTIONS — wire these to real billing/admin endpoints.
  const stubAction = (label: string) =>
    alert(`[STUB] "${label}" for ${c.name} (${c.id}).\nWire this to a real admin API endpoint.`);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close drawer" />
      <div className="relative w-full max-w-md bg-[var(--surface)] border-l border-[var(--border)] h-full overflow-y-auto shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between bg-[var(--surface)] border-b border-[var(--border)] px-5 h-14">
          <h2 className="text-sm font-semibold">Customer detail</h2>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--foreground)] text-xl leading-none px-2" aria-label="Close">
            ×
          </button>
        </div>

        <div className="p-5 space-y-6">
          <div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold tracking-tight">{c.name}</h3>
                <p className="text-sm text-[var(--muted)]">{c.email}</p>
              </div>
              <StatusBadge status={c.status} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <Field label="Plan" value={c.plan} />
              <Field label="Channel" value={c.channel} />
              <Field label="MRR" value={usd(c.mrrUsd)} />
              <Field label="Country" value={c.country} />
              <Field label="Joined" value={fmtDate(c.joined)} />
              <Field label="Customer ID" value={c.id} mono />
            </div>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted)] mb-2">Credit usage</p>
            <div className="h-2 rounded-full bg-[var(--surface-2)] overflow-hidden">
              <div
                className={`h-full rounded-full ${pct >= 100 ? "bg-[var(--color-vualet-danger)]" : "bg-[var(--color-vualet-indigo)]"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-[var(--muted)] tabular-nums">
              {c.creditsUsed.toLocaleString()} / {c.creditsIncluded.toLocaleString()} credits ({pct.toFixed(0)}%)
            </p>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted)] mb-2">Usage history</p>
            <ul className="space-y-2">
              {usage.map((u, i) => (
                <li key={i} className="flex items-start justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
                  <div>
                    <p className="text-sm font-medium capitalize">{u.kind.replace("_", " ")}</p>
                    <p className="text-xs text-[var(--muted)]">{u.detail}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-medium tabular-nums">{u.credits}</p>
                    <p className="text-xs text-[var(--muted)]">{fmtDate(u.date)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted)] mb-2">Actions</p>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => stubAction("Top-up credits")}
                className="rounded-lg bg-[var(--color-vualet-indigo)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--color-vualet-indigo-hover)] transition-colors"
              >
                Top-up
              </button>
              <button
                onClick={() => stubAction("Issue refund")}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium hover:bg-[var(--surface-2)] transition-colors"
              >
                Refund
              </button>
              <button
                onClick={() => stubAction("Suspend account")}
                className="rounded-lg border border-[var(--color-vualet-danger)] px-3 py-2 text-sm font-medium text-[var(--color-vualet-danger)] hover:bg-[var(--color-vualet-danger)]/10 transition-colors"
              >
                Suspend
              </button>
            </div>
            <p className="mt-2 text-[11px] text-[var(--muted)]">Actions are stubbed — they must call real admin API endpoints.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className={`mt-0.5 font-medium ${mono ? "font-mono text-xs" : ""}`}>{value}</p>
    </div>
  );
}
