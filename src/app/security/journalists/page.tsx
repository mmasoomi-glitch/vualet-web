import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Security for journalists and researchers",
  description:
    "Verified security properties and honest limits of Vualet's products: Mira VPN, FileHub, and Mira Assistant. No unverifiable claims.",
};

export default function JournalistsSecurityPage() {
  return (
    <main className="container mx-auto px-4 py-12 max-w-3xl space-y-12">
      <section>
        <h1 className="text-3xl font-bold text-[var(--foreground)]">
          Security for journalists and researchers
        </h1>
        <p className="mt-4 text-[var(--muted)]">
          This page is for people whose threat model is real. We will tell you
          what we can prove about our products and what we cannot. Every
          statement here is backed by our engineering records and our own
          testing. We make no claims we cannot verify.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-[var(--foreground)]">
          Mira VPN
        </h2>
        <p className="mt-2 text-[var(--muted)]">
          A VPN whose traffic is designed to look like ordinary web browsing.
        </p>
        <ul className="mt-4 space-y-2 list-disc list-inside text-[var(--foreground)]">
          <li>
            Uses the VLESS + REALITY protocol. REALITY presents the connection
            as normal TLS traffic to a well-known CDN host, so a network
            observer sees a routine HTTPS session rather than a recognisable
            VPN handshake.
          </li>
          <li>
            Runs plain REALITY without the xtls-rprx-vision flow - a deliberate
            simplification that reduces moving parts in the critical path.
          </li>
          <li>
            Independently owned and funded by Vualet. No state backing, and no
            sponsor that answers to a state. This is the company&apos;s own
            declaration of ownership.
          </li>
          <li>
            Field-tested: twenty press accounts were provisioned and have been
            running on it.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-[var(--foreground)]">
          FileHub
        </h2>
        <p className="mt-2 text-[var(--muted)]">
          End-to-end encrypted file storage and sharing, built so the server
          cannot read what you store.
        </p>
        <ul className="mt-4 space-y-2 list-disc list-inside text-[var(--foreground)]">
          <li>
            Verified in a real browser: the server cannot read new uploads.
          </li>
          <li>
            Cross-tenant isolation was tested adversarially and held. One tenant
            could not read another tenant&apos;s object by guessing the key, nor
            by re-using a signed URL.
          </li>
          <li>
            Folder uploads are on the same encrypted path, with the directory
            structure sealed inside encrypted metadata rather than written to
            our disk - so we do not learn your folder names either.
          </li>
          <li>
            Server-side preview and thumbnail generation were removed by
            decision, because generating a preview would require the server to
            read the file.
          </li>
          <li>
            The vault passphrase is separate from the account login password.
          </li>
          <li>
            A file cannot be uploaded into a vault with no recovery key. The
            upload is refused rather than stored unrecoverably.
          </li>
          <li>
            The desktop app and the browser extension ship the same
            cryptography file byte for byte. Neither reimplements crypto
            independently.
          </li>
        </ul>

        <div className="mt-6 border border-[var(--border)] bg-[var(--surface)] p-4 rounded">
          <h3 className="text-lg font-medium text-[var(--foreground)]">
            Honest limit
          </h3>
          <p className="mt-1 text-[var(--muted)]">
            FileHub is not yet certified for commercial sale. Its encryption,
            authentication and isolation are verified; other parts of the
            product are unfinished. We would rather say that here than let you
            find it out later.
          </p>
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-[var(--foreground)]">
          Mira Assistant
        </h2>
        <p className="mt-2 text-[var(--muted)]">
          An assistant that works over WhatsApp, with each customer&apos;s data
          sealed separately.
        </p>
        <ul className="mt-4 space-y-2 list-disc list-inside text-[var(--foreground)]">
          <li>Per-tenant envelope encryption for stored content.</li>
          <li>
            Tenant isolation is covered by an adversarial test suite: a payment
            event for one customer cannot alter another customer&apos;s record,
            and a lookup never returns a neighbour&apos;s data.
          </li>
          <li>
            Crisis detection runs in five languages and was deployed and
            verified on the live system.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-[var(--foreground)]">
          What we do not claim
        </h2>
        <ul className="mt-4 space-y-2 list-disc list-inside text-[var(--foreground)]">
          <li>We do not claim to be unbreakable. No software is.</li>
          <li>We do not run our own audit and call it independent.</li>
          <li>
            We would rather lose a sale than have someone rely on a claim we
            cannot support.
          </li>
        </ul>
      </section>

      <section>
        <p className="text-[var(--muted)]">
          We invite scrutiny. Anything on this page can be questioned directly,
          and we would rather answer a hard question than have you guess. Write
          to{" "}
          <a
            href="mailto:info@vualet.com"
            className="underline text-[var(--color-vualet-indigo-ink)]"
          >
            info@vualet.com
          </a>{" "}
          or use our{" "}
          <a href="/contact" className="underline text-[var(--color-vualet-indigo-ink)]">
            contact page
          </a>
          .
        </p>
      </section>
    </main>
  );
}
