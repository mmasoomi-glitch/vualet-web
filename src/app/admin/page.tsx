import Link from "next/link";
import {
  Card,
  KpiCard,
  PageHeader,
  HealthBadge,
  Pill,
  UnavailableValue,
} from "@/components/admin/ui";
import { getAdminKpis } from "@/lib/admin-data";

const UNAVAILABLE_LABELS: Record<string, string> = {
  mrrUsd: "Monthly recurring revenue",
  creditsUsed: "Credits used",
  todaySpendUsd: "Provider spend today",
  todayRevenueUsd: "Revenue today",
};

export default async function AdminOverviewPage() {
  const k = await getAdminKpis();

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle="Live snapshot from the subscription store. Metrics this app cannot measure are declared, not invented."
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total customers"
          value={String(k.totalCustomers)}
          sub="From the live subscription store"
        />
        <KpiCard
          label="Active subscriptions"
          value={String(k.activeSubscriptions)}
          sub={`${k.trials} on trial`}
        />
        <KpiCard
          label="Trials"
          value={String(k.trials)}
          sub="Counted from the plan field"
        />
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wider text-[var(--muted)]">MRR</p>
          <UnavailableValue reason={k.unavailable.mrrUsd ?? "not measured"} />
        </Card>
      </div>
      {/* The previous version rendered a hard-coded fake revenue figure and
          a 14-day chart of invented numbers; an admin page that lies
          confidently is worse than one that says not measured. */}
      <Card className="p-5 mt-4">
        <h2 className="text-sm font-semibold">Revenue &amp; cost</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          These metrics are not measurable from this app and are deliberately not simulated:
        </p>
        <dl className="mt-3 space-y-2">
          {Object.entries(k.unavailable).map(([key, reason]) => (
            <div key={key} className="flex items-baseline justify-between gap-4 text-sm">
              <dt>{UNAVAILABLE_LABELS[key] ?? key}</dt>
              <dd className="text-[var(--muted)] text-right">{reason}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card className="p-5 mt-4">
        <h2 className="text-sm font-semibold">System health</h2>
        <div className="mt-2 flex items-center gap-2">
          <HealthBadge status="unknown" />
          <Pill>Not instrumented</Pill>
        </div>
        <p className="mt-3 text-sm text-[var(--muted)]">
          No in-app health instrumentation is wired yet; operational monitoring
          lives in the host systemd timers (mira-monitor).
        </p>
        <Link
          href="/admin/health"
          className="text-xs text-[var(--color-vualet-indigo)] hover:underline"
        >
          Details
        </Link>
      </Card>
    </div>
  );
}
