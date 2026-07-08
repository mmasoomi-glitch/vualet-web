"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Logo } from "@/components/logo";

// Public sign-in for the ops dashboard. Middleware redirects every
// unauthenticated /admin request here; POST /api/admin/login verifies
// ADMIN_PASSWORD server-side and sets the signed httpOnly session cookie.
export default function AdminLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--surface-2)]" />}>
      <AdminLogin />
    </Suspense>
  );
}

function AdminLogin() {
  const router = useRouter();
  const params = useSearchParams();
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) {
        const next = params.get("next");
        router.push(next && next.startsWith("/admin") ? next : "/admin");
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(
        res.status === 503
          ? data.message || "Admin sign-in isn't configured on this deployment."
          : "Wrong password.",
      );
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

        <form onSubmit={handleSubmit} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Admin sign-in</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">Internal ops dashboard. Team members only.</p>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-[var(--muted)]">Password</span>
            <input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="••••••••"
              autoFocus
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--color-vualet-indigo)]"
            />
          </label>

          {error && <p className="text-sm text-[var(--color-vualet-danger)]">{error}</p>}

          <button
            type="submit"
            disabled={busy || !pw}
            className="w-full rounded-lg bg-[var(--color-vualet-indigo)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-vualet-indigo-hover)] transition-colors disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
