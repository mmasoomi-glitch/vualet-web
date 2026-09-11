"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Logo } from "@/components/logo";

/**
 * Multi-step admin sign-in (backend-generalised §5):
 *   1. email + password           → POST /api/admin/login
 *   2a. first-time → MFA ENROLL    → POST /api/admin/mfa/enroll (show secret/URI)
 *   2b. returning  → MFA VERIFY     → POST /api/admin/mfa/verify (6-digit code)
 * The full session cookie is only minted after the TOTP code is verified.
 */
// Both MFA steps ask for the same code and previously duplicated the whole field,
// so a change to one would miss the other. Declared at MODULE scope, not nested in
// the page component: a nested component is a new type on every render, which would
// remount the input and drop focus mid-typing.
function CodeEntryFields(props: {
  code: string;
  setCode: (v: string) => void;
  error: string;
  busy: boolean;
  submitLabel: string;
}): React.ReactElement {
  return (
    <>
      <label className="block">
        <span className="text-xs font-medium text-[var(--muted)]">6-digit code</span>
        <input
          inputMode="numeric"
          value={props.code}
          onChange={(e) => props.setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000"
          autoFocus
          className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm tracking-[0.3em] outline-none focus:border-[var(--color-vualet-indigo)]"
        />
      </label>
      {props.error && <p className="text-sm text-[var(--color-vualet-danger)]">{props.error}</p>}
      <button
        type="submit"
        disabled={props.busy || props.code.length !== 6}
        className="w-full rounded-lg bg-[var(--color-vualet-indigo-ink)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-vualet-indigo-ink-hover)] transition-colors disabled:opacity-60"
      >
        {props.busy ? "Verifying…" : props.submitLabel}
      </button>
    </>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--surface-2)]" />}>
      <AdminLogin />
    </Suspense>
  );
}

type Step = "creds" | "enroll" | "mfa";

function AdminLogin() {
  const router = useRouter();
  const params = useSearchParams();

  const [step, setStep] = useState<Step>("creds");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [code, setCode] = useState("");
  const [enroll, setEnroll] = useState<{ secret: string; otpauth: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function go() {
    const next = params.get("next");
    router.push(next && next.startsWith("/admin") ? next : "/admin");
  }

  async function submitCreds(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: pw }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.next === "enroll") {
        // Kick off enrolment to get the seed for the QR / manual entry.
        const er = await fetch("/api/admin/mfa/enroll", { method: "POST" });
        const ed = await er.json().catch(() => ({}));
        if (er.ok) {
          setEnroll({ secret: ed.secret, otpauth: ed.otpauth });
          setStep("enroll");
        } else {
          setError("Couldn't start MFA enrolment. Try again.");
        }
      } else if (res.ok && data.next === "mfa") {
        setStep("mfa");
      } else if (res.status === 503) {
        setError(data.message || "Admin sign-in isn't configured on this deployment.");
      } else if (res.status === 429) {
        setError(data.message || "Too many attempts. Try again later.");
      } else {
        setError("Wrong email or password.");
      }
    } catch {
      setError("Couldn't reach the server. Try again.");
    }
    setBusy(false);
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: code }),
      });
      if (res.ok) {
        go();
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error === "mfa_not_ready" ? "Session expired — start again." : "Wrong or expired code.");
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

        {step === "creds" && (
          <form onSubmit={submitCreds} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4">
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Admin sign-in</h1>
              <p className="mt-1 text-sm text-[var(--muted)]">Internal ops. Per-admin identity + authenticator MFA required.</p>
            </div>
            <label className="block">
              <span className="text-xs font-medium text-[var(--muted)]">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                autoComplete="username"
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
                autoComplete="current-password"
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--color-vualet-indigo)]"
              />
            </label>
            {error && <p className="text-sm text-[var(--color-vualet-danger)]">{error}</p>}
            <button
              type="submit"
              disabled={busy || !email || !pw}
              className="w-full rounded-lg bg-[var(--color-vualet-indigo-ink)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-vualet-indigo-ink-hover)] transition-colors disabled:opacity-60"
            >
              {busy ? "Checking…" : "Continue"}
            </button>
          </form>
        )}

        {step === "enroll" && enroll && (
          <form onSubmit={submitCode} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4">
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Set up authenticator</h1>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Add this account to Google Authenticator, 1Password, or Authy, then enter the 6-digit code to finish.
              </p>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
              <p className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Manual entry key</p>
              <p className="mt-1 font-mono text-sm break-all select-all">{enroll.secret}</p>
              <a
                href={enroll.otpauth}
                className="mt-2 inline-block text-xs text-[var(--color-vualet-indigo-ink)] hover:underline break-all"
              >
                Open in authenticator app →
              </a>
            </div>
            <CodeEntryFields code={code} setCode={setCode} error={error} busy={busy} submitLabel="Finish setup & sign in" />
          </form>
        )}

        {step === "mfa" && (
          <form onSubmit={submitCode} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4">
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Two-factor</h1>
              <p className="mt-1 text-sm text-[var(--muted)]">Enter the 6-digit code from your authenticator app.</p>
            </div>
            <CodeEntryFields code={code} setCode={setCode} error={error} busy={busy} submitLabel="Sign in" />
          </form>
        )}
      </div>
    </div>
  );
}
