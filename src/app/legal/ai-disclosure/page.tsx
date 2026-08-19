import type { Metadata } from "next";
import { LegalPage } from "../_components/legal-page";
import styles from "../legal.module.css";

export const metadata: Metadata = {
  title: "AI Disclosure",
  description:
    "Mira is an AI assistant. Plain-language disclosure of what that means before you rely on anything she says.",
};

export default function AiDisclosurePage() {
  return (
    <LegalPage
      title="AI Disclosure"
      lastUpdated="July 17, 2026"
      activeHref="/legal/ai-disclosure"
      intro="Short version, up front: Mira is an AI. Read this before you rely on anything she tells you. This is the same plain-language notice shown on the consent screen before your first conversation with Mira."
    >
      <div className={styles.calloutLarge}>
        <p style={{ marginTop: 0 }}>
          <strong>Mira is an AI assistant.</strong> She&apos;s built to give
          helpful answers grounded in what you&apos;ve told her, and she is
          designed <strong>not to fabricate or invent</strong>: where she
          doesn&apos;t have a grounded answer, she is built to tell you she
          doesn&apos;t know rather than guess.
        </p>
        <p>
          The correctness of any answer still depends on the accuracy of the
          information you give her. Wrong or incomplete inputs can produce
          wrong outputs — garbage in, garbage out — and making sure your inputs
          are right is your responsibility. Mira is an informational tool, not
          a licensed professional, and nothing she says is financial, legal, or
          medical advice. Always verify anything important independently before
          you act on it.
        </p>
        <p style={{ marginBottom: 0 }}>
          <strong>In an emergency, contact local emergency services — not
          Mira.</strong>
        </p>
      </div>

      <h2>What this means in practice</h2>
      <ul>
        <li>Mira is designed not to fabricate: where she doesn&apos;t have a grounded answer, she is built to say she doesn&apos;t know rather than invent one.</li>
        <li>The accuracy of what she gives back depends on the accuracy of what you give her — incomplete, outdated, or incorrect information from you can lead to incorrect output, and getting your inputs right is your responsibility.</li>
        <li>She is not a doctor, lawyer, accountant, therapist, or financial advisor, and nothing she outputs should be treated as advice from one.</li>
        <li>For anything with real consequences — a medical symptom, a legal question, a financial decision, a safety concern — verify with a qualified professional or a trusted, independent source.</li>
        <li>If Mira builds something for you (text, code, a document, an app package), review and test it yourself before you rely on, publish, or deploy it.</li>
      </ul>

      <h2>Why we show you this</h2>
      <p>
        We want you to know you&apos;re talking to an AI, and to understand
        how to use her responsibly, before you rely on anything she tells you.
        This notice is
        shown on the consent screen the first time you use Mira, and it is
        incorporated into our full{" "}
        <a href="/legal/terms">Terms of Service</a> as a contractual
        disclosure.
      </p>

      <h2>Related pages</h2>
      <p>
        See our <a href="/legal/privacy">Privacy Policy</a> for how your
        conversations with Mira are stored and used, and our{" "}
        <a href="/legal/terms">Terms of Service</a> for the full legal terms,
        including our warranty disclaimer and limitation of liability.
      </p>

      <div className={styles.callout}>
        Questions about how Mira works or this disclosure? Contact{" "}
        <a href="mailto:legal@vualet.com">legal@vualet.com</a>.
      </div>
    </LegalPage>
  );
}
