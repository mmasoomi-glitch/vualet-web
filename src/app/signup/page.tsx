import { redirect } from "next/navigation";

export const metadata = { title: "Start free" };

// Mira is self-serve → straight into the plan/checkout funnel.
// Everything else captures a real waitlist email.
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; plan?: string; joined?: string; error?: string }>;
}) {
  const sp = await searchParams;
  if (sp.product === "mira") {
    redirect(sp.plan ? `/mira/plans?plan=${sp.plan}` : "/mira/plans");
  }

  const joined = sp.joined === "1";

  return (
    <div className="mx-auto max-w-md px-6 py-24">
      <h1
        className="text-3xl font-semibold tracking-tight"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {joined ? "You're on the list" : "Start your free trial"}
      </h1>

      {joined ? (
        <p className="mt-3 text-sm text-[var(--muted)]">
          We&apos;ll email you the moment your invite is ready. In the meantime,{" "}
          <a href="/mira" className="underline">
            meet Mira
          </a>{" "}
          — she&apos;s live today.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-[var(--muted)]">
            This product is in private alpha. Drop your email and we&apos;ll invite you.
            Looking for <a href="/mira" className="underline">Mira</a>? She&apos;s live now.
          </p>
          {sp.error === "1" && (
            <p className="mt-3 text-sm text-red-500">Please enter a valid email.</p>
          )}
          <form action="/api/waitlist" method="post" className="mt-8 space-y-4">
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
        </>
      )}
    </div>
  );
}
