export const metadata = {
  title: "Changelog",
  description: "What's new across Vualet and its products.",
};

export default function ChangelogPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-24 text-center">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-vualet-indigo)]">
        Changelog
      </p>
      <h1
        className="mt-3 text-4xl md:text-5xl font-semibold tracking-tight"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Coming soon.
      </h1>
      <p className="mx-auto mt-4 max-w-xl text-lg text-[var(--muted)] leading-relaxed">
        We&apos;re just getting started. Every release, improvement, and new
        product across the Vualet family will be logged here.
      </p>
    </div>
  );
}
