import type { Metadata } from "next";
import { LegalPage } from "../_components/legal-page";
import styles from "../legal.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Vualet and Mira collect, use, retain, and protect your data — account, message, usage, and voice information.",
};

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      lastUpdated="July 17, 2026"
      activeHref="/legal/privacy"
      intro="This Privacy Policy explains what information Vualet and Mira (“we,” “us,” “our”) collect when you use our products, why we collect it, who we share it with, and the rights you have over it."
    >
      <h2>1. Who we are</h2>
      <p>
        Vualet and Mira are services provided by a sole proprietor trading as{" "}
        <strong>Satellite World</strong>, based in Dubai, United Arab Emirates.
        Your payment contract is with Dodo Payments, our merchant of record.
        This policy applies to our website, apps, in-product Mira assistant, and
        any other service that links to it.
      </p>

      <h2>2. Information we collect</h2>
      <p>We collect the following categories of information:</p>
      <ul>
        <li>
          <strong>Account information</strong> — your name, email address, phone
          number, business or organization details, and login credentials when
          you sign up or manage your account.
        </li>
        <li>
          <strong>Messages and conversation content</strong> — what you send to
          Mira and the responses she gives, including any files, documents, or
          artifacts you request her to create or that you upload for her to work
          with.
        </li>
        <li>
          <strong>Usage data</strong> — device and browser type, IP address,
          pages visited, features used, timestamps, crash and diagnostic logs,
          and similar technical data generated as you use the service.
        </li>
        <li>
          <strong>Voice data</strong> — if you use a voice feature, we collect
          the audio you provide and the transcript generated from it, for as
          long as needed to deliver and improve that feature.
        </li>
        <li>
          <strong>Billing information</strong> — plan, billing address, and
          transaction history. Full card numbers are handled by our payment
          processor and are never stored on our servers.
        </li>
      </ul>

      <h2>3. How we use your information</h2>
      <ul>
        <li>To operate, maintain, and provide the features you use, including
          Mira&apos;s conversation memory and any content she generates for you.</li>
        <li>To process payments, manage subscriptions, and send billing
          notices.</li>
        <li>To secure the service, detect abuse or fraud, and enforce our{" "}
          <a href="/legal/terms">Terms of Service</a>.</li>
        <li>To respond to support requests and communicate service updates.</li>
        <li>To improve reliability, performance, and product quality, using
          aggregated or de-identified data wherever practical.</li>
        <li>To meet legal, tax, and regulatory obligations.</li>
      </ul>

      <h2>4. Who we share information with</h2>
      <p>
        We do not sell your personal information. We share data only with the
        following categories of service providers, each of whom is bound by
        contractual confidentiality and data-protection obligations, and only
        to the extent necessary for them to perform their function:
      </p>
      <ul>
        <li>
          <strong>Payment processors</strong>, to process subscription charges
          and refunds.
        </li>
        <li>
          <strong>Messaging platforms</strong> (for example, WhatsApp or similar
          channels you choose to connect), to deliver and receive messages on
          your behalf.
        </li>
        <li>
          <strong>Third-party AI providers</strong>, to generate Mira&apos;s
          responses and process voice and text input. We work with reputable
          providers under data-processing agreements and reserve the right to
          change providers at any time without changing the protections in this
          policy. We intentionally do not publish which specific providers
          power any given feature, as this is part of our proprietary
          technology stack.
        </li>
        <li>
          <strong>Cloud hosting and infrastructure providers</strong>, to store
          and run the service securely.
        </li>
        <li>
          <strong>Legal and regulatory authorities</strong>, where required by
          law, court order, or to protect our rights, users, or the public.
        </li>
      </ul>

      <h2>5. Data retention</h2>
      <p>
        We retain your account and conversation data for as long as your
        subscription is active, encrypted at rest and in transit. If your
        subscription lapses, we retain your data for a limited grace period
        so you can resume service, after which it is deleted or anonymized
        unless you request earlier deletion or we are required to retain it
        for legal or accounting purposes. You can request deletion at any
        time — see Section 7.
      </p>

      <h2>6. Your rights</h2>
      <p>
        Depending on where you live, you may have rights to access, correct,
        export, restrict, object to, or delete your personal data. We honor
        these rights for all users, in line with the EU/EEA General Data
        Protection Regulation (GDPR) and the UAE Personal Data Protection Law
        (PDPL) where applicable, including:
      </p>
      <ul>
        <li><strong>Access</strong> — request a copy of the personal data we hold about you.</li>
        <li><strong>Correction</strong> — ask us to fix inaccurate or incomplete data.</li>
        <li><strong>Deletion</strong> — ask us to delete your account and associated data, subject to legal retention requirements.</li>
        <li><strong>Portability</strong> — request your data in a portable format.</li>
        <li><strong>Objection / restriction</strong> — object to or limit certain processing.</li>
      </ul>
      <p>
        To exercise any of these rights, contact us at{" "}
        <a href="mailto:info@vualet.com">info@vualet.com</a>. We will
        respond within the timeframe required by applicable law.
      </p>

      <h2>7. Data security</h2>
      <p>
        We use industry-standard technical and organizational measures —
        including encryption in transit and at rest, access controls, and
        logging — to protect your information. No method of transmission or
        storage is 100% secure, and we cannot guarantee absolute security.
      </p>

      <h2>8. International data transfers</h2>
      <p>
        Your information may be processed in the United Arab Emirates and
        other countries where our service providers operate. Where we
        transfer personal data internationally, we use appropriate safeguards
        (such as standard contractual clauses or equivalent mechanisms)
        consistent with GDPR and other applicable data-protection frameworks.
      </p>

      <h2>9. Children&apos;s privacy</h2>
      <p>
        Our service is intended for users aged 18 and older. We do not
        knowingly collect personal information from anyone under 18. If you
        believe a minor has provided us with personal data, contact us and we
        will remove it.
      </p>

      <h2>10. Cookies and similar technologies</h2>
      <p>
        We use cookies and similar technologies to keep you signed in,
        remember preferences, and understand how the service is used. You can
        control cookies through your browser settings; disabling them may
        limit some functionality.
      </p>

      <h2>11. Changes to this policy</h2>
      <p>
        We may update this Privacy Policy from time to time. We will update
        the &quot;Last updated&quot; date above and, for material changes,
        provide reasonable notice (such as an in-product or email notice)
        before the changes take effect.
      </p>

      <h2>12. Contact us</h2>
      <p>
        For any questions about this Privacy Policy or how we handle your
        data, contact <strong>Satellite World</strong> at{" "}
        <a href="mailto:info@vualet.com">info@vualet.com</a>.
      </p>

      <div className={styles.callout}>
        See also our <a href="/legal/ai-disclosure">AI Disclosure</a> for how
        Mira&apos;s conversation data specifically is used, and our{" "}
        <a href="/legal/terms">Terms of Service</a> for the full contractual
        terms governing your use of the service.
      </div>
    </LegalPage>
  );
}
