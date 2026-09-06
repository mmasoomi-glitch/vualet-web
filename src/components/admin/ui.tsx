// Shared presentational primitives for the admin dashboard.
// Pure UI — no data fetching. Uses the Vualet CSS-variable design system.

import type { ReactNode } from "react";
import { STATUS_LABEL } from "@/lib/admin-format";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-[var(--border)] bg-[var(--surface)] ${className}`}>
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-[var(--muted)]">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  tone?: "default" | "positive" | "negative";
}) {
  const toneClass =
    tone === "positive"
      ? "text-[var(--color-vualet-success)]"
      : tone === "negative"
        ? "text-[var(--color-vualet-danger)]"
        : "text-[var(--foreground)]";
  return (
    <Card className="p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">{label}</p>
      <p className={`mt-2 text-3xl font-semibold tracking-tight ${toneClass}`} style={{ fontFamily: "var(--font-display)" }}>
        {value}
      </p>
      {sub && <p className="mt-1.5 text-xs text-[var(--muted)]">{sub}</p>}
    </Card>
  );
}

// Tones over the LIVE subscription-status union (active, pending, bound,
// cancelled, refunded, chargeback, on_hold, paused). The union is open-ended
// on purpose: an unknown status renders neutral rather than crashing a
// Record lookup, because the store's union can grow before this file does.
const STATUS_STYLES: Record<string, string> = {
  active: "bg-[var(--color-vualet-success)]/12 text-[var(--color-vualet-success)]",
  pending: "bg-[var(--color-vualet-indigo-ink)]/12 text-[var(--color-vualet-indigo-ink)]",
  bound: "bg-[var(--color-vualet-indigo-ink)]/12 text-[var(--color-vualet-indigo-ink)]",
  on_hold: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  paused: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  cancelled: "bg-[var(--color-vualet-danger)]/12 text-[var(--color-vualet-danger)]",
  refunded: "bg-[var(--color-vualet-danger)]/12 text-[var(--color-vualet-danger)]",
  chargeback: "bg-[var(--color-vualet-danger)]/12 text-[var(--color-vualet-danger)]",
};
const STATUS_STYLE_UNKNOWN = "bg-[var(--surface-2)] text-[var(--muted)]";

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? STATUS_STYLE_UNKNOWN}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

type HealthStatus = "operational" | "degraded" | "down" | "unknown";

const HEALTH_DOT: Record<HealthStatus, string> = {
  operational: "bg-[var(--color-vualet-success)]",
  degraded: "bg-amber-500",
  down: "bg-[var(--color-vualet-danger)]",
  unknown: "bg-[var(--muted)]",
};

const HEALTH_LABEL: Record<HealthStatus, string> = {
  operational: "Operational",
  degraded: "Degraded",
  down: "Down",
  unknown: "Unknown",
};

export function HealthBadge({ status }: { status: HealthStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium">
      <span className={`w-2 h-2 rounded-full ${HEALTH_DOT[status]}`} />
      {HEALTH_LABEL[status]}
    </span>
  );
}

export function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-xs text-[var(--muted)]">
      {children}
    </span>
  );
}

// This is how a metric the app cannot truthfully source is shown: a dash plus
// the reason, NEVER a number and NEVER zero, because a fabricated zero reads
// as "no revenue" when the truth is "not measured here".
export function UnavailableValue({ reason }: { reason: string }) {
  return (
    <span className="inline-block" title={reason}>
      <span className="block mt-2 text-3xl font-semibold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
        —
      </span>
      <span className="mt-1.5 block text-xs text-[var(--muted)]">{reason}</span>
    </span>
  );
}
