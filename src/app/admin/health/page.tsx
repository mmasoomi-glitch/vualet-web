import { Card, HealthBadge, PageHeader, Pill } from "@/components/admin/ui";
import { getProviderHealth } from "@/lib/admin-stub";

export default function AdminHealthPage() {
  // REAL HOOK: replace with live healthchecks / status-page polling per provider.
  const providers = getProviderHealth();

  const operational = providers.filter((p) => p.status === "operational").length;
  const degraded = providers.filter((p) => p.status === "degraded").length;
  const down = providers.filter((p) => p.status === "down").length;

  return (
    <>
      <PageHeader
        title="Provider health"
        subtitle="Live status, latency, and 30-day uptime per provider and channel. Stubbed data."
      />

      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wider text-[var(--muted)]">Operational</p>
          <p className="mt-1 text-2xl font-semibold text-[var(--color-vualet-success)]" style={{ fontFamily: "var(--font-display)" }}>{operational}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wider text-[var(--muted)]">Degraded</p>
          <p className="mt-1 text-2xl font-semibold text-amber-500" style={{ fontFamily: "var(--font-display)" }}>{degraded}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wider text-[var(--muted)]">Down</p>
          <p className="mt-1 text-2xl font-semibold text-[var(--color-vualet-danger)]" style={{ fontFamily: "var(--font-display)" }}>{down}</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {providers.map((p) => (
          <Card key={p.name} className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold tracking-tight">{p.name}</h2>
                  <Pill>{p.category}</Pill>
                </div>
                <p className="mt-1 text-sm text-[var(--muted)]">{p.note}</p>
              </div>
              <HealthBadge status={p.status} />
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs text-[var(--muted)]">Latency</p>
                <p className="mt-0.5 font-medium tabular-nums">{p.latencyMs} ms</p>
              </div>
              <div>
                <p className="text-xs text-[var(--muted)]">Uptime (30d)</p>
                <p className="mt-0.5 font-medium tabular-nums">{p.uptime30d.toFixed(2)}%</p>
              </div>
              <div>
                <p className="text-xs text-[var(--muted)]">Checked</p>
                <p className="mt-0.5 font-medium tabular-nums">
                  {new Date(p.lastChecked).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            </div>

            <div className="mt-4 h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  p.status === "operational"
                    ? "bg-[var(--color-vualet-success)]"
                    : p.status === "degraded"
                      ? "bg-amber-500"
                      : "bg-[var(--color-vualet-danger)]"
                }`}
                style={{ width: `${p.uptime30d}%` }}
              />
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
