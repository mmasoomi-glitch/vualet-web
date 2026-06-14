// Shared presentational primitives for the admin dashboard.
// Pure UI — no data fetching. Uses the Vualet CSS-variable design system.

import type { ReactNode } from "react";
import type { CustomerStatus, ProviderHealth } from "@/lib/admin-stub";
import { STATUS_LABEL } from "@/lib/admin-stub";

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

const STATUS_STYLES: Record<CustomerStatus, string> = {
  active: "bg-[var(--color-vualet-success)]/12 text-[var(--color-vualet-success)]",
  trialing: "bg-[var(--color-vualet-indigo)]/12 text-[var(--color-vualet-indigo)]",
  past_due: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  suspended: "bg-[var(--color-vualet-danger)]/12 text-[var(--color-vualet-danger)]",
  canceled: "bg-[var(--surface-2)] text-[var(--muted)]",
};

export function StatusBadge({ status }: { status: CustomerStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

const HEALTH_DOT: Record<ProviderHealth["status"], string> = {
  operational: "bg-[var(--color-vualet-success)]",
  degraded: "bg-amber-500",
  down: "bg-[var(--color-vualet-danger)]",
};

const HEALTH_LABEL: Record<ProviderHealth["status"], string> = {
  operational: "Operational",
  degraded: "Degraded",
  down: "Down",
};

export function HealthBadge({ status }: { status: ProviderHealth["status"] }) {
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
