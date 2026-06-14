"use client";

// ============================================================================
// ADMIN GATE — PLACEHOLDER access control. NOT SECURE.
// ============================================================================
// Renders a sign-in screen until a (fake) `admin_session` exists, then shows
// the admin shell. This runs entirely in the browser and verifies NOTHING.
//
// >>> REPLACE WITH REAL SERVER-SIDE AUTH BEFORE PRODUCTION <<<
// Do the real gate in middleware.ts / a server component so unauthenticated
// users never receive the admin HTML or data in the first place.
// ============================================================================

import { useEffect, useState, type ReactNode } from "react";
import { Logo } from "@/components/logo";
import { readAdminSession, setAdminSession } from "@/lib/admin-auth";
import { Sidebar } from "./sidebar";

export function AdminGate({ children }: { children: ReactNode }) {
  // `null` = still checking (avoids a flash of the sign-in screen on reload).
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    setAuthed(readAdminSession());
  }, []);

  if (authed === null) {
    return <div className="min-h-screen bg-[var(--background)]" />;
  }

  if (!authed) {
    return <SignIn onSignIn={() => setAuthed(true)} />;
  }

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <Sidebar />
      <div className="md:pl-60">
        <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8">{children}</main>
      </div>
    </div>
  );
}

function SignIn({ onSignIn }: { onSignIn: () => void }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // PLACEHOLDER: accept anything. Real flow must POST to a server endpoint
    // that verifies credentials / SSO and sets a signed httpOnly cookie.
    setAdminSession();
    onSignIn();
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
            <span className="text-xs font-medium text-[var(--muted)]">Work email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@vualet.com"
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--color-vualet-indigo)]"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-[var(--muted)]">Password</span>
            <input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="••••••••"
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--color-vualet-indigo)]"
            />
          </label>

          <button
            type="submit"
            className="w-full rounded-lg bg-[var(--color-vualet-indigo)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-vualet-indigo-hover)] transition-colors"
          >
            Sign in
          </button>

          <p className="text-[11px] leading-relaxed text-[var(--muted)] border-t border-[var(--border)] pt-3">
            <strong className="text-[var(--color-vualet-danger)]">Placeholder auth.</strong> Any input signs you in. This
            must be replaced with real server-side authentication before production.
          </p>
        </form>
      </div>
    </div>
  );
}
