export const metadata = { title: "Talk to sales" };

export default function ContactSalesPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-24">
      <h1
        className="text-4xl md:text-5xl font-semibold tracking-tight"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Tell us what you need.
      </h1>
      <p className="mt-4 text-lg text-[var(--muted)]">
        Custom SLAs, annual commits, single-tenant deployments, bilingual
        onboarding, or just questions — we read every message.
      </p>
      <form
        action="/api/contact"
        method="post"
        className="mt-10 space-y-4"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input
            name="name"
            required
            placeholder="Your name"
            className="px-4 py-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-sm focus:outline-none focus:border-[var(--color-vualet-indigo)]"
          />
          <input
            type="email"
            name="email"
            required
            placeholder="Work email"
            className="px-4 py-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-sm focus:outline-none focus:border-[var(--color-vualet-indigo)]"
          />
        </div>
        <input
          name="company"
          placeholder="Company"
          className="w-full px-4 py-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-sm focus:outline-none focus:border-[var(--color-vualet-indigo)]"
        />
        <textarea
          name="message"
          required
          rows={5}
          placeholder="What are you trying to do?"
          className="w-full px-4 py-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-sm focus:outline-none focus:border-[var(--color-vualet-indigo)]"
        />
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-sm font-medium text-white bg-[var(--color-vualet-indigo)] hover:bg-[var(--color-vualet-indigo-hover)] transition-colors"
        >
          Send →
        </button>
      </form>
    </div>
  );
}
