import type { Metadata } from "next";
import { LegalPage } from "../_components/legal-page";
import styles from "../legal.module.css";

export const metadata: Metadata = {
  title: "Terms & Conditions",
  description:
    "The terms governing your use of Mira and Veridian — how Mira answers, your responsibility for the inputs you give it, acceptable use, and liability.",
};

export default function TermsAndConditionsPage() {
  return (
    <LegalPage
      title="Terms & Conditions"
      lastUpdated="July 17, 2026"
      activeHref="/legal/terms"
      intro="This is a plain-language summary followed by the full terms; by using Mira you accept them."
    >
      {/* TODO: counsel review before launch */}
      <div className={styles.calloutLarge}>
        <strong>In plain language.</strong> Mira is built to be honest: it
        answers from what you actually give it, and it will tell you when it
        doesn&apos;t know rather than make something up. But it can only be as
        right as the information you give it — if your inputs, numbers, or
        formulas are wrong, the answer can be wrong too, and that part is on
        you. Don&apos;t try to trick it or misuse it. Treat what Mira gives you
        as helpful information, not professional advice, and check anything
        important before you act on it. Using Mira — or ticking the acceptance
        box when you sign up — means you accept everything below.
      </div>

      <h2>1. Acceptance of these Terms</h2>
      <p>
        These Terms &amp; Conditions (&quot;Terms&quot;) govern your access to
        and use of Mira and the Veridian technology that powers it, together
        with any related products, sites, and services (together, the
        &quot;Service&quot;). The Service is provided by{" "}
        a sole proprietor trading as <strong>Vualet Trading</strong>, Dubai,
        United Arab Emirates (&quot;we,&quot; &quot;us,&quot; the
        &quot;Provider&quot;). Purchases are sold by Dodo Payments, the merchant
        of record for all payment transactions. By using the Service, or by ticking the
        acceptance box when you sign up, you agree to these Terms and enter into
        a binding agreement with the Provider. If you do not agree, do not use
        the Service.
      </p>

      <h2>2. How Mira answers — our design commitment</h2>
      <p>
        Mira is built on Veridian with one core commitment:{" "}
        <strong>it is designed not to fabricate or invent.</strong> Mira answers
        from what it is actually given, and where it does not have a grounded
        answer it is built to tell you that it does not know rather than guess or
        make something up. This is a deliberate design commitment about how Mira
        behaves — a standard we hold ourselves to: it is designed not to invent
        facts to fill a gap.
      </p>
      <p>
        This is a commitment about not inventing — it is not a promise that every
        answer will be correct in every case, because correctness also depends
        on the information you provide (see Section 3). Veridian is our
        proprietary technology; how it achieves this is confidential and is not
        described, licensed, or disclosed.
      </p>

      <h2>3. Accuracy depends on your inputs</h2>
      <p>
        <strong>Garbage in, garbage out.</strong> The correctness of any output
        depends entirely on the correctness of the information, data,
        calculations, and formulations you provide. If you supply information
        that is false, incorrect, incomplete, or misleading — including
        calculations or formulas that are themselves wrong — any resulting
        output may be wrong, and that outcome is <strong>your</strong>{" "}
        responsibility, not the Provider&apos;s.
      </p>
      <p>
        Expecting a correct result from incorrect inputs is not something the
        Provider warrants or can be held responsible for. It is your
        responsibility to ensure that what you give Mira is accurate, complete,
        and appropriate for what you are trying to do.
      </p>

      <h2>4. No tampering or misuse</h2>
      <p>
        You must not tamper with, interfere with, or attempt to manipulate the
        Service, and you must not deliberately feed it false or misleading
        information in order to induce a misleading or incorrect output. Doing
        so — and any consequence that follows from it — is solely your
        responsibility. This includes any attempt to misuse the Service to
        produce a result you then rely on or present as if it were sound.
      </p>

      <h2>5. Not professional advice</h2>
      <p>
        The Service is an informational tool. Nothing it provides is financial,
        legal, tax, medical, or other professional advice, and using it does not
        create any professional or advisory relationship. You are solely
        responsible for independently verifying and evaluating anything you
        intend to act on, and for seeking a qualified, licensed professional
        where that is appropriate.
      </p>

      <h2>6. Service provided &quot;as is&quot;; waiver and release</h2>
      <p>
        To the maximum extent permitted by law, the Service is provided
        &quot;as is&quot; and &quot;as available,&quot; without warranties of
        any kind, whether express, implied, or statutory. By using the Service,
        you accept it on that basis and you{" "}
        <strong>
          waive and release the Provider from any liability, claim, or dispute
        </strong>{" "}
        arising from your own inputs, your misuse of the Service, or your
        reliance on any output. To the maximum extent permitted by law, the
        Provider will not be liable for any indirect, incidental, special,
        consequential, or punitive damages, or for any loss of profit, revenue,
        data, or goodwill, arising out of or relating to your use of the
        Service.
      </p>

      <h2>7. Eligibility and your account</h2>
      <p>
        You must be at least 18 years old and able to enter into a binding
        agreement to use the Service. You are responsible for keeping your
        login credentials confidential and for all activity that occurs under
        your account. Notify us promptly of any unauthorized use.
      </p>

      <h2>8. Intellectual property and confidentiality</h2>
      <p>
        We retain all rights, title, and interest in the Service, including Mira
        and the Veridian technology, and all underlying software, models, and
        systems. You retain ownership of the content you input. You agree not to
        reverse-engineer, decompile, disassemble, or otherwise attempt to
        extract or replicate the underlying methodology or trade secrets of the
        Service, and not to use the Service to build a competing product.
      </p>

      <h2>9. Governing law</h2>
      <p>
        These Terms are governed by the laws of the United Arab Emirates, and
        any dispute arising out of or relating to these Terms or the Service is
        subject to the exclusive jurisdiction of the competent courts of Dubai,
        UAE, unless otherwise required by applicable law.
      </p>

      <h2>10. Changes and contact</h2>
      <p>
        We may update these Terms from time to time. We will update the
        &quot;Last updated&quot; date above and, for material changes, provide
        reasonable notice; continued use of the Service after changes take
        effect constitutes acceptance of the updated Terms. Questions can be
        sent to <a href="mailto:legal@vualet.com">legal@vualet.com</a>.
      </p>

      <div className={styles.callout}>
        By using Mira, or by ticking the acceptance box when you sign up, you
        confirm that you have read, understood, and accepted these Terms.
      </div>
    </LegalPage>
  );
}
