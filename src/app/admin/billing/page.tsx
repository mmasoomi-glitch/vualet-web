import { Card, KpiCard, PageHeader } from "@/components/admin/ui";
import { RefundsQueue } from "@/components/admin/refunds-queue";
import {
  getRefundRequests,
  getSubscriptions,
  getKpis,
  REVENUE_VS_COST_14D,
  fmtDate,
  usd,
  usd2,
} from "@/lib/admin-stub";

export default function AdminBillingPage() {
  const subs = getSubscriptions();
  const refunds = getRefundRequests();
  const k = getKpis();

  const rev14 = REVENUE_VS_COST_14D.reduce((s, d) => s + d.revenueUsd, 0);
  const cost14 = REVENUE_VS_COST_14D.reduce((s, d) => s + d.costUsd, 0);
  const margin14 = rev14 - cost14;
  const marginPct = rev14 > 0 ? (margin14 / rev14) * 100 : 0;

  return (
    <>
      <PageHeader title="Billing" subtitle="Subscriptions, refunds, and revenue vs cost. Stubbed data." />

      {/* Revenue / cost summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="MRR" value={usd(k.mrrUsd)} sub="Normalized to monthly" />
        <KpiCard label="Revenue (14d)" value={usd(rev14)} sub="Recognized" />
        <KpiCard label="Provider cost (14d)" value={usd(cost14)} sub="DeepSeek · ElevenLabs · RunPod" />
        <KpiCard label="Gross margin (14d)" value={usd(margin14)} sub={`${marginPct.toFixed(0)}% gross`} tone="positive" />
      </div>

      <div className="mt-6">
        <RefundsQueue initial={refunds} />
      </div>

      {/* Active subscriptions */}
      <div className="mt-6">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
            <h2 className="text-sm font-semibold">Subscriptions</h2>
            <span className="text-xs text-[var(--muted)]">{subs.length} total</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wider text-[var(--muted)]">
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Plan</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Interval</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Next invoice</th>
                </tr>
              </thead>
              <tbody>
                {subs.map((s) => (
                  <tr key={s.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)] transition-colors">
                    <td className="px-4 py-3 font-medium">{s.customerName}</td>
                    <td className="px-4 py-3 text-[var(--muted)]">{s.plan}</td>
                    <td className="px-4 py-3 tabular-nums">{usd2(s.amountUsd)}</td>
                    <td className="px-4 py-3 text-[var(--muted)] capitalize">{s.interval}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          s.status === "past_due"
                            ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                            : "bg-[var(--color-vualet-success)]/12 text-[var(--color-vualet-success)]"
                        }`}
                      >
                        {s.status === "past_due" ? "Past due" : "Active"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">{fmtDate(s.nextInvoice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
