"use client";

import type { AdminCustomer } from "@/lib/admin-data";
import { StatusBadge } from "./ui";
import { fmtDate } from "@/lib/admin-format";

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-[var(--muted)]">{label}</p>
      <p className={mono ? "mt-1 font-mono text-xs" : "mt-1"}>{value}</p>
    </div>
  );
}

export function CustomerDrawer({ customer, onClose }: { customer: AdminCustomer | null; onClose: () => void }) {
  if (!customer) return null;
  const c = customer;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close drawer" />
      <div className="relative w-full max-w-md bg-[var(--surface)] border-l border-[var(--border)] h-full overflow-y-auto shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between bg-[var(--surface)] border-b border-[var(--border)] px-5 h-14">
          <h2 className="text-sm font-semibold">Customer detail</h2>
          <button className="text-xl leading-none px-2" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="p-5 space-y-6">
          <div className="flex items-center justify-between gap-3">
            {/* The store holds no display name - the email IS the identity here. */}
            <h3 className="text-lg font-semibold tracking-tight">{c.email}</h3>
            <StatusBadge status={c.status} />
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Plan" value={c.plan} />
            <Field label="Channel" value={c.channel} />
            <Field label="Joined" value={fmtDate(c.joined)} />
            <Field label="WhatsApp" value={c.bound ? "Linked" : "Not linked"} />
            <Field label="Customer ID" value={c.id} mono />
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Usage &amp; billing detail</p>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Usage is metered in the engine database and prices live in Dodo; neither is reachable from this app, so nothing is shown rather than something invented.
            </p>
          </div>
          {/* The old drawer had alert()-stub actions; dead buttons that pretend to work are worse than no buttons. */}
        </div>
      </div>
    </div>
  );
}
