"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, PageHeader } from "@/components/admin/ui";
import { ADMIN_ROLES, ROLE_LABELS, type AdminRole } from "@/lib/admin-roles";

/**
 * OWNER DELEGATION (backend-generalised §7): invite admins, assign role(s)/scope/
 * expiry, suspend/reactivate, remove instantly, and view last login + active
 * sessions. Dangerous mutations are reauth-gated: on a 401 reauth_required the
 * page collects a fresh TOTP code, posts /api/admin/reauth, and retries.
 */

type AdminPublic = {
  id: string;
  email: string;
  roles: AdminRole[];
  scope?: string;
  status: "invited" | "active" | "suspended";
  mfaEnrolled: boolean;
  createdAt: string;
  expiresAt?: number;
  lastLoginAt?: string;
};

type SessionInfo = { sid: string; current: boolean; createdAt: string; lastSeen: string; ip?: string; ua?: string };

async function apiWithReauth(url: string, init: RequestInit): Promise<Response> {
  let res = await fetch(url, init);
  if (res.status === 401) {
    const data = await res.clone().json().catch(() => ({}));
    if (data.error === "reauth_required") {
      const code = window.prompt("This action needs a fresh authenticator code:");
      if (!code) return res;
      const rr = await fetch("/api/admin/reauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: code.trim() }),
      });
      if (rr.ok) res = await fetch(url, init);
    }
  }
  return res;
}

export default function TeamPage() {
  const [admins, setAdmins] = useState<AdminPublic[]>([]);
  const [perms, setPerms] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [meRes, listRes] = await Promise.all([fetch("/api/admin/me"), fetch("/api/admin/admins")]);
    if (meRes.ok) setPerms((await meRes.json()).permissions || []);
    if (listRes.ok) {
      setAdmins((await listRes.json()).admins || []);
      setError("");
    } else if (listRes.status === 403) {
      setError("Your role can't view the admin directory.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const canInvite = perms.includes("admin.invite");
  const canManage = perms.includes("admin.role.assign");
  const canRemove = perms.includes("admin.remove");

  return (
    <>
      <PageHeader title="Team & access" subtitle="Per-admin identity, roles, MFA status, and active sessions. Metadata only — no customer content." />
      {error && <p className="mb-4 text-sm text-[var(--color-vualet-danger)]">{error}</p>}

      {canInvite && <InviteForm onDone={load} />}

      <Card className="mt-4 overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold">Admins</h2>
        </div>
        {loading ? (
          <p className="p-5 text-sm text-[var(--muted)]">Loading…</p>
        ) : admins.length === 0 ? (
          <p className="p-5 text-sm text-[var(--muted)]">No admins yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {admins.map((a) => (
              <AdminRow key={a.id} admin={a} canManage={canManage} canRemove={canRemove} onChange={load} />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function InviteForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [scope, setScope] = useState("");
  const [expiry, setExpiry] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function toggle(r: AdminRole) {
    setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await apiWithReauth("/api/admin/admins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        roles,
        scope: scope || undefined,
        expiresAt: expiry ? new Date(expiry).getTime() : undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setMsg({ kind: "ok", text: data.emailed ? `Invite emailed to ${email}.` : `Invite created. Share this link: ${data.inviteUrl}` });
      setEmail("");
      setRoles([]);
      setScope("");
      setExpiry("");
      onDone();
    } else {
      setMsg({ kind: "err", text: data.message || "Couldn't create invite." });
    }
    setBusy(false);
  }

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold">Invite an admin</h2>
      <form onSubmit={submit} className="mt-3 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-[var(--muted)]">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--color-vualet-indigo)]"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-[var(--muted)]">Scope (optional)</span>
            <input
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              placeholder="e.g. EU tenants"
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--color-vualet-indigo)]"
            />
          </label>
        </div>
        <div>
          <span className="text-xs font-medium text-[var(--muted)]">Roles</span>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {ADMIN_ROLES.map((r) => (
              <button
                type="button"
                key={r}
                onClick={() => toggle(r)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  roles.includes(r)
                    ? "border-[var(--color-vualet-indigo)] bg-[var(--color-vualet-indigo)] text-white"
                    : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
                title={ROLE_LABELS[r]}
              >
                {ROLE_LABELS[r]}
              </button>
            ))}
          </div>
        </div>
        <label className="block max-w-xs">
          <span className="text-xs font-medium text-[var(--muted)]">Access expires (optional)</span>
          <input
            type="date"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--color-vualet-indigo)]"
          />
        </label>
        {msg && (
          <p className={`text-sm break-all ${msg.kind === "ok" ? "text-[var(--color-vualet-success)]" : "text-[var(--color-vualet-danger)]"}`}>
            {msg.text}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !email || roles.length === 0}
          className="rounded-lg bg-[var(--color-vualet-indigo)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-vualet-indigo-hover)] transition-colors disabled:opacity-60"
        >
          {busy ? "Inviting…" : "Send invite"}
        </button>
      </form>
    </Card>
  );
}

function AdminRow({
  admin,
  canManage,
  canRemove,
  onChange,
}: {
  admin: AdminPublic;
  canManage: boolean;
  canRemove: boolean;
  onChange: () => void;
}) {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [busy, setBusy] = useState(false);

  // One place for the parts every admin action shares: the busy flag, the failure
  // alert and the refresh callback. Only the request itself differs per action.
  async function runAction(send: () => Promise<Response>): Promise<void> {
    setBusy(true);
    const res = await send();
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.message || "Action failed.");
    }
    setBusy(false);
    onChange();
  }

  async function patch(body: Record<string, unknown>) {
    await runAction(() =>
      apiWithReauth(`/api/admin/admins/${admin.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  }

  async function remove() {
    // The confirm stays FIRST: a cancelled confirm must not touch the busy flag
    // and must not fire onChange().
    if (!confirm(`Remove ${admin.email}? Their sessions are killed immediately.`)) return;
    await runAction(() =>
      apiWithReauth(`/api/admin/admins/${admin.id}`, { method: "DELETE" })
    );
  }

  async function loadSessions() {
    const res = await fetch(`/api/admin/sessions?aid=${admin.id}`);
    if (res.ok) setSessions((await res.json()).sessions || []);
    else alert("Can't view this admin's sessions.");
  }

  async function revoke(sid: string) {
    const res = await apiWithReauth("/api/admin/sessions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sid }),
    });
    if (res.ok) loadSessions();
    else alert("Couldn't revoke.");
  }

  const statusColor =
    admin.status === "active"
      ? "text-[var(--color-vualet-success)]"
      : admin.status === "suspended"
        ? "text-[var(--color-vualet-danger)]"
        : "text-[var(--muted)]";

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{admin.email}</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            <span className={statusColor}>{admin.status}</span>
            {" · "}
            {admin.roles.map((r) => ROLE_LABELS[r]).join(", ") || "no roles"}
            {admin.scope ? ` · scope: ${admin.scope}` : ""}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            {admin.mfaEnrolled ? "MFA on" : "MFA not set up"}
            {" · last login "}
            {admin.lastLoginAt ? new Date(admin.lastLoginAt).toLocaleString() : "never"}
            {admin.expiresAt ? ` · expires ${new Date(admin.expiresAt).toLocaleDateString()}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={loadSessions} className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs hover:bg-[var(--background)]">
            Sessions
          </button>
          {canManage && admin.status === "active" && (
            <button onClick={() => patch({ status: "suspended" })} disabled={busy} className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs hover:bg-[var(--background)] disabled:opacity-50">
              Suspend
            </button>
          )}
          {canManage && admin.status === "suspended" && (
            <button onClick={() => patch({ status: "active" })} disabled={busy} className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs hover:bg-[var(--background)] disabled:opacity-50">
              Reactivate
            </button>
          )}
          {canRemove && (
            <button onClick={remove} disabled={busy} className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--color-vualet-danger)] hover:bg-[var(--background)] disabled:opacity-50">
              Remove
            </button>
          )}
        </div>
      </div>

      {sessions && (
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
          {sessions.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">No active sessions.</p>
          ) : (
            <ul className="space-y-2">
              {sessions.map((s) => (
                <li key={s.sid} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-[var(--muted)] truncate">
                    {s.current ? "● current · " : ""}
                    {s.ip || "unknown ip"} · last seen {new Date(s.lastSeen).toLocaleString()}
                  </span>
                  <button onClick={() => revoke(s.sid)} className="rounded border border-[var(--border)] px-2 py-0.5 hover:bg-[var(--surface)]">
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
