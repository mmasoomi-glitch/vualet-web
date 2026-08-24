import Link from "next/link";

export const metadata = {
  title: "The Mira family",
  description:
    "One intelligence, many shapes. Writing, assistant, VPN and more — each a Mira product you can start with today.",
};

type Status = "Free" | "Available" | "Coming soon";

type Product = {
  id: string;
  name: string;
  blurb: string;
  status: Status;
  cta: string;
  href?: string;
  external?: boolean;
};

// Single source of truth for the Mira product family shown in the storefront.
const FAMILY: Product[] = [
  {
    id: "writing",
    name: "Mira Writing",
    blurb:
      "An invisible desktop assistant that cleans the line you just typed — fixing typos, grammar and command syntax while holding your exact meaning, in any language.",
    status: "Free",
    cta: "Download for Windows",
    href: "https://get.mira.vualet.com",
    external: true,
  },
  {
    id: "assistant",
    name: "Mira Assistant",
    blurb:
      "A chat and voice helper that answers, remembers and builds — inside your own WhatsApp, in a group you create, in your language.",
    status: "Available",
    cta: "Start free trial",
    href: "/mira/plans",
  },
  {
    id: "vpn",
    name: "Mira VPN",
    blurb: "Fast, private access that just works — wherever you are.",
    status: "Coming soon",
    cta: "Preview",
    href: "/mira/vpn",
  },
  {
    id: "screenwatcher",
    name: "Mira ScreenWatcher",
    blurb:
      "Ambient, on-screen awareness that preloads context so answers land faster and truer.",
    status: "Coming soon",
    cta: "Notify me",
  },
  {
    id: "locksmith",
    name: "Mira Locksmith",
    blurb:
      "Your constant credentials, entered for you — safely, and only when you ask.",
    status: "Coming soon",
    cta: "Notify me",
  },
];

function Mark() {
  // The Mira "presence" mark — awareness auras around a gradient core.
  return (
    <svg width="40" height="40" viewBox="0 0 200 200" aria-hidden="true">
      <defs>
        <linearGradient id="mg" x1="40" y1="40" x2="160" y2="160" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#E4A130" />
          <stop offset="0.55" stopColor="#C7B8F0" />
          <stop offset="1" stopColor="#6366F1" />
        </linearGradient>
        <radialGradient id="mc" cx="100" cy="100" r="35" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFF3D9" />
          <stop offset="0.4" stopColor="#E4A130" />
          <stop offset="1" stopColor="#C7B8F0" />
        </radialGradient>
      </defs>
      <circle cx="100" cy="100" r="82" fill="none" stroke="url(#mg)" strokeWidth="3" opacity="0.25" />
      <circle cx="100" cy="100" r="60" fill="none" stroke="url(#mg)" strokeWidth="4" opacity="0.55" />
      <circle cx="100" cy="100" r="36" fill="url(#mc)" />
      <circle cx="100" cy="100" r="11" fill="#fff" opacity="0.9" />
    </svg>
  );
}

function StatusPill({ status }: { status: Status }) {
  const soon = status === "Coming soon";
  return (
    <span
      className="text-[10px] font-semibold uppercase tracking-wider rounded-full px-2 py-0.5"
      style={{
        color: soon ? "var(--muted)" : "var(--color-vualet-indigo)",
        border: `1px solid ${soon ? "var(--border)" : "var(--color-vualet-indigo)"}`,
      }}
    >
      {status}
    </span>
  );
}

function Card({ p }: { p: Product }) {
  const inner = (
    <>
      <div className="flex items-start justify-between">
        <Mark />
        <StatusPill status={p.status} />
      </div>
      <h3 className="mt-5 text-lg font-semibold tracking-tight">{p.name}</h3>
      <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{p.blurb}</p>
      <span
        className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold"
        style={{ color: p.href ? "var(--color-vualet-indigo)" : "var(--muted)" }}
      >
        {p.cta}
        {p.href && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        )}
      </span>
    </>
  );

  const cls =
    "group block rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-6 transition-colors hover:border-[var(--color-vualet-indigo)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-vualet-indigo)]";

  if (!p.href) {
    return (
      <div className={cls} aria-disabled="true">
        {inner}
      </div>
    );
  }
  if (p.external) {
    return (
      <a className={cls} href={p.href} target="_blank" rel="noopener noreferrer">
        {inner}
      </a>
    );
  }
  return (
    <Link className={cls} href={p.href}>
      {inner}
    </Link>
  );
}

export default function MiraStore() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-20">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-vualet-indigo)]">
        The Mira family
      </p>
      <h1
        className="mt-3 text-4xl md:text-5xl font-semibold tracking-tight"
        style={{ fontFamily: "var(--font-display)" }}
      >
        One intelligence, many shapes.
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-[var(--muted)]">
        Every Mira product speaks your language and keeps your meaning. Start with one, add
        more as you grow.
      </p>

      <div className="mt-16 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {FAMILY.map((p) => (
          <Card key={p.id} p={p} />
        ))}
      </div>

      <p className="mt-14 text-sm text-[var(--muted)]">
        Mira is part of the{" "}
        <Link href="/" className="underline hover:text-[var(--foreground)]">
          Vualet
        </Link>{" "}
        family — powered by Veridian, from Satellite World (a sole proprietorship).
      </p>
    </div>
  );
}
