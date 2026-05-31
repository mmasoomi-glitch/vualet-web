export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-md px-6 py-24">
      <h1
        className="text-3xl font-semibold tracking-tight"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Sign in
      </h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Authentication powered by Clerk lands in the next deploy.
      </p>
    </div>
  );
}
