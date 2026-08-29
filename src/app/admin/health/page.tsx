// The previous page rendered invented latencies and uptimes for real provider
// names; deleting the fiction outranks keeping the furniture.
import {
  Card,
  PageHeader,
  HealthBadge,
  Pill,
} from "@/components/admin/ui";

export default function AdminHealthPage() {
  return (
    <div>
      <PageHeader
        title="Provider health"
        subtitle="No in-app health instrumentation is wired yet - nothing here is simulated."
      />
      <Card className="p-5">
        <div className="flex items-center gap-2">
          <HealthBadge status="unknown" />
          <Pill>Not instrumented</Pill>
        </div>
        <p className="mt-3 text-sm text-[var(--muted)]">
          This web app does not probe DeepSeek, ElevenLabs, WhatsApp or the
          engine, so it cannot truthfully render per-provider status, latency
          or uptime.
        </p>
        <p className="mt-3 text-sm text-[var(--muted)]">
          The real operational signals live on the host today - systemd units
          and timers (mira-monitor, mira-expiry, mira-backup) and their journal
          logs; wiring live probes into this page is the intended follow-up.
        </p>
      </Card>
    </div>
  );
}
