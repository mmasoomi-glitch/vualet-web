"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Logo } from "@/components/logo";

/**
 * Invite acceptance (backend-generalised §7): an invited admin lands here from
 * their emailed link (?email=&token=), sets a password, and is activated. MFA
 * enrolment is then forced at first sign-in.
 */
export default function AdminInvitePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--surface-2)]" />}>
      <AdminInvite />
    </Suspense>
  );
}

function AdminInvite() {
  const router = useRouter();
  const params = useSearchParams();
  const email = params.get("email") || "";
  const token = params.get("token") || "";

  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== pw2) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/invite/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, token, password: pw }),
      });
      if (res.ok) {
        setDone(true);
        setTimeout(() => router.push("/admin-login"), 1500);
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.message || "This invite is invalid or has expired.");
    } catch {
      setError("Couldn't reach the server. Try again.");
    }
    setBusy(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--surface-2)] px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 justify-center mb-8">
          <Logo size={36} />
          <span className="text-xl font-semibold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
            Vualet Admin
          </span>
        </div>

        <form onSubmit={submit} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Accept your invite</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {email ? <>Set a password for <span className="font-medium">{email}</span>.</> : "Set your admin password."}
            </p>
          </div>

          {!email || !token ? (
            <p className="text-sm text-[var(--color-vualet-danger)]">This link is missing its invite token. Ask your owner to re-send it.</p>
          ) : done ? (
            <p className="text-sm text-[var(--color-vualet-success)]">Password set. Redirecting to sign-in…</p>
          ) : (
            <>
              <label className="block">
                <span className="text-xs font-medium text-[var(--muted)]">Password (min 10 characters)</span>
                <input
                  type="password"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  autoComplete="new-password"
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--color-vualet-indigo)]"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-[var(--muted)]">Confirm password</span>
                <input
                  type="password"
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                  autoComplete="new-password"
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--color-vualet-indigo)]"
                />
              </label>
              {error && <p className="text-sm text-[var(--color-vualet-danger)]">{error}</p>}
              <button
                type="submit"
                disabled={busy || pw.length < 10 || !pw2}
                className="w-full rounded-lg bg-[var(--color-vualet-indigo-ink)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-vualet-indigo-ink-hover)] transition-colors disabled:opacity-60"
              >
                {busy ? "Saving…" : "Set password"}
              </button>
              <p className="text-xs text-[var(--muted)]">You'll set up an authenticator app when you first sign in.</p>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
