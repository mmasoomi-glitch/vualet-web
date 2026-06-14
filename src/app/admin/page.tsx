import Link from "next/link";
import { Card, KpiCard, PageHeader, HealthBadge } from "@/components/admin/ui";
import {
  getKpis,
  getProviderHealth,
  REVENUE_VS_COST_14D,
  usd,
  usd2,
} from "@/lib/admin-stub";

export default function AdminOverviewPage() {
  const k = getKpis();
  const health = getProviderHealth();
  const margin = k.todayRevenueUsd - k.todaySpendUsd;
  const marginPct = k.todayRevenueUsd > 0 ? (margin / k.todayRevenueUsd) * 100 : 0;

  const degraded = health.filter((h) => h.status !== "operational");
  const maxBar = Math.max(...REVENUE_VS_COST_14D.map((d) => d.revenueUsd));

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Live ops snapshot across customers, billing, and providers. Stubbed data."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total customers" value={String(k.totalCustomers)} sub="Across all plans & channels" />
        <KpiCard label="Active subscriptions" value={String(k.activeSubscriptions)} sub={`${k.trials} on trial`} />
        <KpiCard label="MRR" value={usd(k.mrrUsd)} sub="Recurring, normalized to monthly" />
        <KpiCard label="Trials" value={String(k.trials)} sub="Converting in ≤14 days" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        {/* Today: spend vs revenue + margin */}
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Today — revenue vs spend</h2>
            <span className="text-xs text-[var(--muted)]">Live, USD</span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-[var(--muted)]">Revenue</p>
              <p className="mt-1 text-2xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                {usd2(k.todayRevenueUsd)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--muted)]">Provider spend</p>
              <p className="mt-1 text-2xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                {usd2(k.todaySpendUsd)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--muted)]">Margin</p>
              <p
                className="mt-1 text-2xl font-semibold text-[var(--color-vualet-success)]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {usd2(margin)}
              </p>
              <p className="text-xs text-[var(--muted)]">{marginPct.toFixed(0)}% gross</p>
            </div>
          </div>

          {/* 14-day bar chart (CSS only, no chart lib) */}
          <div className="mt-6">
            <p className="text-xs text-[var(--muted)] mb-2">Last 14 days</p>
            <div className="flex items-end gap-1.5 h-28">
              {REVENUE_VS_COST_14D.map((d) => (
                <div key={d.date} className="flex-1 flex flex-col justify-end items-center gap-px h-full" title={`${d.date} · rev ${usd(d.revenueUsd)} · cost ${usd(d.costUsd)}`}>
                  <div className="w-full flex items-end justify-center gap-px h-full">
                    <div
                      className="w-1/2 rounded-t bg-[var(--color-vualet-indigo)]"
                      style={{ height: `${(d.revenueUsd / maxBar) * 100}%` }}
                    />
                    <div
                      className="w-1/2 rounded-t bg-[var(--color-vualet-indigo-soft)]"
                      style={{ height: `${(d.costUsd / maxBar) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-4 text-xs text-[var(--muted)]">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[var(--color-vualet-indigo)]" /> Revenue
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[var(--color-vualet-indigo-soft)]" /> Cost
              </span>
            </div>
          </div>
        </Card>

        {/* System health snapshot */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">System health</h2>
            <Link href="/admin/health" className="text-xs text-[var(--color-vualet-indigo)] hover:underline">
              Details →
            </Link>
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {degraded.length === 0 ? "All providers operational" : `${degraded.length} provider(s) need attention`}
          </p>
          <ul className="mt-4 space-y-3">
            {health.map((h) => (
              <li key={h.name} className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{h.name}</p>
                  <p className="text-xs text-[var(--muted)]">{h.category} · {h.latencyMs}ms</p>
                </div>
                <HealthBadge status={h.status} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
