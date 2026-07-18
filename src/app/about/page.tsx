export const metadata = {
  title: "About",
  description:
    "Vualet is a Dubai-based product family building Mira and more, operated by Afaq Alnaseem Trading LLC.",
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-24">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-vualet-indigo)]">
        About Vualet
      </p>
      <h1
        className="mt-3 text-4xl md:text-5xl font-semibold tracking-tight"
        style={{ fontFamily: "var(--font-display)" }}
      >
        A product family, built in Dubai.
      </h1>
      <div className="mt-6 space-y-5 text-lg text-[var(--muted)] leading-relaxed">
        <p>
          Vualet is a family of software products built in Dubai. Our flagship
          is <span className="text-[var(--foreground)]">Mira</span> — a personal
          assistant that lives in the chat you already use — and more products
          are on the way.
        </p>
        <p>
          Vualet and its products are operated by{" "}
          <span className="text-[var(--foreground)]">
            Afaq Alnaseem Trading LLC
          </span>
          , a company registered in Dubai, United Arab Emirates
          (TRN&nbsp;100475523500003). The technology powering Mira is built on
          Veridian.
        </p>
      </div>
    </div>
  );
}
