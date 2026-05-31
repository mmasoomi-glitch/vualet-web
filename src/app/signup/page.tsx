export const metadata = { title: "Start free" };

export default function SignupPage() {
  return (
    <div className="mx-auto max-w-md px-6 py-24">
      <h1
        className="text-3xl font-semibold tracking-tight"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Start your free trial
      </h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Sign-up wires up to Clerk in the next deploy. For now, drop your email
        and we&apos;ll invite you to the alpha.
      </p>
      <form
        action="/api/waitlist"
        method="post"
        className="mt-8 space-y-4"
      >
        <input
          type="email"
          name="email"
          required
          placeholder="you@company.com"
          className="w-full px-4 py-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-sm focus:outline-none focus:border-[var(--color-vualet-indigo)]"
        />
        <button
          type="submit"
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium text-white bg-[var(--color-vualet-indigo)] hover:bg-[var(--color-vualet-indigo-hover)] transition-colors"
        >
          Join the waitlist
        </button>
      </form>
    </div>
  );
}
