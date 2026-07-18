import type { Metadata } from "next";
import { LegalPage } from "../_components/legal-page";
import styles from "../legal.module.css";

export const metadata: Metadata = {
  title: "Refund Policy",
  description:
    "Vualet and Mira's free trial, subscription refund, and cancellation policy.",
};

export default function RefundPolicyPage() {
  return (
    <LegalPage
      title="Refund Policy"
      lastUpdated="July 17, 2026"
      activeHref="/legal/refund"
      intro="This Refund Policy explains how our free trial works, when subscription fees are refundable, and how to cancel."
    >
      <h2>1. Free trial</h2>
      <p>
        <strong>Pre-launch note:</strong> Mira is currently in a waitlist /
        pre-launch phase. We do <strong>not</strong> collect card details and
        no charges are made during this phase. The terms below describe how
        billing will work once paid subscriptions go live.
      </p>
      <p>
        When paid plans launch, new accounts start with a{" "}
        <strong>14-day free trial</strong>. You will not be charged anything
        during the trial. If you cancel before the trial ends, you will not be
        billed at all. If you take no action, your selected subscription plan
        begins automatically at the end of the trial and your card will be
        charged.
      </p>

      <h2>2. Subscription refunds</h2>
      <p>
        Subscription fees are billed in advance for each billing period
        (monthly or annual). Except as described below or where required by
        applicable consumer-protection law, fees already paid for the current
        billing period are non-refundable, including if you cancel partway
        through a period — you will retain access until the end of the period
        you&apos;ve paid for.
      </p>
      <p>We will issue a refund at our discretion where:</p>
      <ul>
        <li>You were charged in error (for example, a duplicate charge or a charge after a trial cancellation that didn&apos;t process correctly).</li>
        <li>A technical failure on our side prevented you from using the Service for a material part of the billing period.</li>
        <li>Applicable law in your jurisdiction entitles you to a refund or cooling-off period.</li>
      </ul>
      <p>
        Any usage credits included with a plan are provided for use within
        the active subscription period and do not carry a cash refund value
        if unused; they are non-transferable and expire on cancellation or
        lapse of the subscription.
      </p>

      <h2>3. How to cancel</h2>
      <p>
        You can cancel your subscription at any time from your account
        settings, or by emailing{" "}
        <a href="mailto:support@vualet.com">support@vualet.com</a>. Cancelling
        stops future billing; it does not automatically refund the current
        period (see Section 2). After cancellation, you keep access to the
        Service through the end of the period you&apos;ve already paid for.
      </p>

      <h2>4. How to request a refund</h2>
      <p>
        To request a refund, email{" "}
        <a href="mailto:support@vualet.com">support@vualet.com</a> with your
        account email and the reason for the request. We aim to respond
        within 3 business days. Approved refunds are returned to your
        original payment method and may take several business days to appear,
        depending on your bank or card issuer.
      </p>

      <h2>5. Contact</h2>
      <p>
        Billing questions can be sent to{" "}
        <a href="mailto:support@vualet.com">support@vualet.com</a>.
      </p>

      <div className={styles.callout}>
        This Refund Policy is incorporated into our{" "}
        <a href="/legal/terms">Terms of Service</a>. See also our{" "}
        <a href="/legal/privacy">Privacy Policy</a> for how billing data is
        handled.
      </div>
    </LegalPage>
  );
}
