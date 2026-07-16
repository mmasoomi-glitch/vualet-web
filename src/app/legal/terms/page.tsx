import type { Metadata } from "next";
import { LegalPage } from "../_components/legal-page";
import styles from "../legal.module.css";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms governing your use of Vualet and Mira, including billing, AI disclosure, liability, and intellectual property.",
};

export default function TermsOfServicePage() {
  return (
    <LegalPage
      title="Terms of Service"
      lastUpdated="July 16, 2026"
      activeHref="/legal/terms"
      intro="These Terms of Service (“Terms”) govern your access to and use of Vualet, Mira, and any related products and services (together, the “Service”). By creating an account or using the Service, you agree to these Terms."
    >
      <h2>1. Contracting entity &amp; acceptance</h2>
      <p>
        The Service is provided by <strong>Afaq Alnaseem Trading LLC</strong>,
        a company registered in Dubai, United Arab Emirates (TRN
        100475523500003) (&quot;Company,&quot; &quot;we,&quot; &quot;us&quot;).
        By using the Service you enter into a binding agreement with the
        Company under these Terms.
      </p>

      <h2>2. Eligibility</h2>
      <p>
        You must be at least 18 years old to create an account or use the
        Service. By using the Service, you confirm that you meet this
        requirement and that you have the authority to accept these Terms on
        behalf of yourself or the organization you represent.
      </p>

      <h2>3. Accounts</h2>
      <p>
        You are responsible for maintaining the confidentiality of your login
        credentials and for all activity that occurs under your account.
        Notify us immediately of any unauthorized use of your account.
      </p>

      <h2>4. AI disclosure</h2>
      <p>
        Mira is an artificial intelligence assistant, not a human being or a
        licensed professional. She is built to give helpful answers grounded
        in what you&apos;ve told her, but she can still be wrong. You are
        responsible for independently verifying any information, advice, or
        output before relying on it — see our full{" "}
        <a href="/legal/ai-disclosure">AI Disclosure</a>, which is
        incorporated into these Terms by reference.
      </p>

      <h2>5. Subscriptions, billing &amp; free trial</h2>
      <ul>
        <li>
          New accounts may start with a <strong>7-day free trial</strong>. You
          will not be charged during the trial. Unless you cancel before the
          trial ends, your subscription will begin and billing will start
          automatically, as described in our{" "}
          <a href="/legal/refund">Refund Policy</a>.
        </li>
        <li>
          Paid subscriptions renew automatically for successive billing
          periods (monthly or annual, as selected) until cancelled.
        </li>
        <li>
          Fees are billed in advance and, except as described in our{" "}
          <a href="/legal/refund">Refund Policy</a>, are non-refundable for
          the period already consumed.
        </li>
        <li>
          We may change pricing or plan features with reasonable advance
          notice; continued use after a price change takes effect constitutes
          acceptance of the new pricing.
        </li>
      </ul>

      <h2>6. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the Service for any unlawful, harmful, abusive, or fraudulent purpose.</li>
        <li>Attempt to interfere with, disrupt, or gain unauthorized access to the Service or its underlying infrastructure.</li>
        <li>Use the Service to generate content that infringes third-party rights, harasses others, or violates applicable law.</li>
        <li>Resell, sublicense, or provide the Service to third parties without our written consent.</li>
        <li>Use automated means to scrape, extract, or replicate the Service beyond normal use.</li>
      </ul>
      <p>
        We may suspend or terminate accounts that violate this section, as
        described in Section 12.
      </p>

      <h2>7. Intellectual property; ownership of generated content</h2>
      <ul>
        <li>
          The Company retains all rights, title, and interest in the Service,
          including Mira, our proprietary Veridian technology, and all
          underlying software, models, and systems.
        </li>
        <li>
          You retain ownership of the content you input into the Service
          (your messages, files, and data).
        </li>
        <li>
          <strong>Generated artifacts</strong> — for content, documents, code,
          or applications that Mira creates for you at your request, you
          receive a license to use, modify, and deploy that output for your
          own purposes, subject to these Terms and to our right to reuse
          the underlying models and techniques (not your specific content) to
          operate and improve the Service.
        </li>
      </ul>

      <h2>8. Built-artifact disclaimer</h2>
      <p>
        Where the Service delivers a built artifact (for example, generated
        code, a document, or an application package such as an APK), you are
        responsible for reviewing and testing that artifact before relying on,
        deploying, publishing, or distributing it. The Company disclaims all
        liability for defects, security vulnerabilities, data loss, or misuse
        arising from any generated artifact. Treat generated software the same
        way you would treat any third-party code: review it before you trust
        it.
      </p>

      <h2>9. Third-party providers</h2>
      <p>
        The Service relies on third-party infrastructure, AI, voice, payment,
        and messaging providers to operate. We reserve the right to add,
        change, or remove any underlying provider at any time, without notice,
        provided the Service continues to meet these Terms. We are not
        responsible for outages or issues caused solely by a third-party
        provider outside our control.
      </p>

      <h2>10. Confidentiality &amp; no reverse engineering</h2>
      <p>
        Mira runs on Veridian, our proprietary technology. We do not license
        or disclose how it works. You agree not to reverse-engineer,
        decompile, disassemble, or otherwise attempt to extract the
        underlying methodology, source code, model weights, or trade secrets
        of the Service, and not to use the Service to build a competing
        product.
      </p>

      <h2>11. Disclaimer of warranties</h2>
      <p>
        THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS
        AVAILABLE,&quot; WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS,
        IMPLIED, OR STATUTORY, INCLUDING WARRANTIES OF MERCHANTABILITY,
        FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, OR ACCURACY. WE DO
        NOT WARRANT THAT OUTPUTS FROM MIRA WILL BE ACCURATE, COMPLETE,
        CURRENT, OR RELIABLE, OR THAT THE SERVICE WILL BE UNINTERRUPTED OR
        ERROR-FREE.
      </p>

      <h2>12. No professional advice</h2>
      <p>
        Nothing Mira or the Service provides is medical, legal, financial,
        tax, or other professional advice. You are solely responsible for
        independently verifying and evaluating any output before relying on
        or acting on it, and for seeking a licensed professional where
        appropriate.
      </p>

      <h2>13. Crisis and emergency situations</h2>
      <p>
        Mira is not an emergency service and is not a substitute for
        professional crisis intervention. Any crisis-related safety features
        (such as surfacing hotline information) are provided as a best-effort
        safety measure, not a guarantee of intervention or outcome. In an
        emergency, contact local emergency services immediately.
      </p>

      <h2>14. Limitation of liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE COMPANY WILL NOT BE
        LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR
        PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, REVENUE, DATA, OR GOODWILL,
        ARISING FROM YOUR USE OF THE SERVICE. THE COMPANY&apos;S TOTAL
        AGGREGATE LIABILITY FOR ANY CLAIM ARISING OUT OF OR RELATING TO THESE
        TERMS OR THE SERVICE WILL NOT EXCEED THE FEES YOU PAID TO THE COMPANY
        IN THE THREE (3) MONTHS PRECEDING THE EVENT GIVING RISE TO THE CLAIM.
      </p>

      <h2>15. Indemnification</h2>
      <p>
        You agree to indemnify and hold the Company harmless from any claims,
        damages, or expenses (including reasonable legal fees) arising from
        your misuse of the Service, your violation of these Terms, or your
        use, deployment, or distribution of any content or artifact generated
        through the Service.
      </p>

      <h2>16. Termination</h2>
      <p>
        We may suspend or terminate your access to the Service, with or
        without notice, for violation of these Terms, non-payment, suspected
        fraud or abuse, or as required by law. You may cancel your account at
        any time as described in our <a href="/legal/refund">Refund Policy</a>.
        Sections of these Terms that by their nature should survive
        termination (including Sections 7–15 and 17) will survive.
      </p>

      <h2>17. Governing law &amp; dispute resolution</h2>
      <p>
        These Terms are governed by the laws of the United Arab Emirates. Any
        dispute arising out of or relating to these Terms or the Service will
        be subject to the exclusive jurisdiction of the competent courts of
        Dubai, UAE, unless otherwise required by applicable law.
      </p>

      <h2>18. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. We will update the
        &quot;Last updated&quot; date above and, for material changes,
        provide reasonable advance notice. Continued use of the Service after
        changes take effect constitutes acceptance of the updated Terms.
      </p>

      <h2>19. Contact</h2>
      <p>
        Questions about these Terms can be sent to{" "}
        <a href="mailto:legal@vualet.com">legal@vualet.com</a>.
      </p>

      <div className={styles.callout}>
        This page works together with our{" "}
        <a href="/legal/privacy">Privacy Policy</a>,{" "}
        <a href="/legal/refund">Refund Policy</a>, and{" "}
        <a href="/legal/ai-disclosure">AI Disclosure</a> — all four form part
        of the agreement between you and the Company.
      </div>
    </LegalPage>
  );
}
