import { getAdminCustomers, getAdminKpis } from "@/lib/admin-data";
import {
  Card,
  KpiCard,
  PageHeader,
  StatusBadge,
  UnavailableValue,
} from "@/components/admin/ui";
import { fmtDate } from "@/lib/admin-format";

export default async function AdminBillingPage() {
  const [customers, k] = await Promise.all([getAdminCustomers(), getAdminKpis()]);

  return (
    <div>
      <PageHeader
        title="Billing"
        subtitle="Live subscription records. Revenue metrics live in Dodo, not here - they are declared unavailable, not simulated."
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Subscriptions" value={String(k.totalCustomers)} sub="Records in the store" />
        <KpiCard label="Active" value={String(k.activeSubscriptions)} sub={`${k.trials} on trial`} />
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wider text-[var(--muted)]">MRR</p>
          <UnavailableValue reason={k.unavailable.mrrUsd ?? "not measured"} />
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wider text-[var(--muted)]">Revenue today</p>
          <UnavailableValue reason={k.unavailable.todayRevenueUsd ?? "not measured"} />
        </Card>
      </div>
      <Card className="mt-6 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold">Subscriptions</h2>
          <span className="text-xs text-[var(--muted)]">{customers.length} total</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wider text-[var(--muted)]">
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Channel</th>
                <th className="px-4 py-3 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{c.email}</div>
                    <div className="text-xs text-[var(--muted)] font-mono">{c.id}</div>
                  </td>
                  <td className="px-4 py-3 text-[var(--muted)]">{c.plan}</td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-4 py-3 text-[var(--muted)]">{c.channel}</td>
                  <td className="px-4 py-3">{fmtDate(c.joined)}</td>
                </tr>
              ))}
              {customers.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-sm text-[var(--muted)]">
                    No subscription records in the store yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      {/* The old page rendered a fabricated refunds queue with invented
          amounts; the honest replacement points at the system of record. */}
      <Card className="p-5 mt-6">
        <h2 className="text-sm font-semibold">Refunds &amp; disputes</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Refunds and chargebacks are initiated and managed in the Dodo dashboard (Dodo is the merchant of record). When a refund webhook lands, the record&apos;s status above flips to refunded or chargeback - that is the truthful in-app view.
        </p>
      </Card>
    </div>
  );
}
