"use client";

import { useEffect, useState } from "react";
import { Card, PageHeader } from "@/components/admin/ui";

/**
 * Audit trail viewer (backend-generalised §8): recent privileged admin actions
 * and the tamper-evidence status of the hash chain. Read-only — there is no
 * edit/delete control here or anywhere. Permission: audit.read.
 */

type AuditRow = {
  seq: number;
  ts: string;
  adminId: string;
  role: string;
  action: string;
  target?: string;
  result: string;
  ip?: string;
};
type Chain = { ok: boolean; length: number; brokenAt?: number };

export default function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [chain, setChain] = useState<Chain | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/admin/audit?limit=300");
      if (res.ok) {
        const data = await res.json();
        setRows(data.rows || []);
        setChain(data.chain || null);
      } else if (res.status === 403) {
        setError("Your role can't read the audit trail.");
      } else {
        setError("Couldn't load the audit trail.");
      }
      setLoading(false);
    })();
  }, []);

  return (
    <>
      <PageHeader title="Audit trail" subtitle="Append-only, hash-chained record of every privileged admin action." />

      {chain && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            chain.ok
              ? "border-[var(--color-vualet-success)]/40 text-[var(--color-vualet-success)]"
              : "border-[var(--color-vualet-danger)]/40 text-[var(--color-vualet-danger)]"
          }`}
        >
          {chain.ok
            ? `Chain intact — ${chain.length} verified rows.`
            : `CHAIN BROKEN at row #${chain.brokenAt}. Tampering detected in ${chain.length} rows.`}
        </div>
      )}
      {error && <p className="mb-4 text-sm text-[var(--color-vualet-danger)]">{error}</p>}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
                <th className="px-4 py-2.5 font-medium">#</th>
                <th className="px-4 py-2.5 font-medium">When</th>
                <th className="px-4 py-2.5 font-medium">Admin</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Action</th>
                <th className="px-4 py-2.5 font-medium">Target</th>
                <th className="px-4 py-2.5 font-medium">Result</th>
                <th className="px-4 py-2.5 font-medium">IP</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-[var(--muted)]">Loading…</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-[var(--muted)]">No admin actions recorded yet.</td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.seq} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-4 py-2.5 text-[var(--muted)]">{r.seq}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{new Date(r.ts).toLocaleString()}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{r.adminId}</td>
                    <td className="px-4 py-2.5 text-xs">{r.role}</td>
                    <td className="px-4 py-2.5 font-medium">{r.action}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--muted)]">{r.target || "—"}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={
                          r.result === "success"
                            ? "text-[var(--color-vualet-success)]"
                            : r.result === "denied"
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-[var(--color-vualet-danger)]"
                        }
                      >
                        {r.result}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[var(--muted)]">{r.ip || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
