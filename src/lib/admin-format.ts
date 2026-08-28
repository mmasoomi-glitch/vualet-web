// Formatting only - this module must never fabricate a data value. It exists
// so deleting the fiction (the old stub module) does not take the innocent formatters
// with it. If a metric cannot be truthfully sourced, that is declared by the
// data layer and rendered by the UI layer; nothing here invents a number.

export function usd(n: number): string {
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function usd2(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  pending: "Pending",
  bound: "Bound",
  cancelled: "Cancelled",
  refunded: "Refunded",
  chargeback: "Chargeback",
  on_hold: "On hold",
  paused: "Paused",
};
