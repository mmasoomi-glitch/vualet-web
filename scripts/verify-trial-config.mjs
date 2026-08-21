#!/usr/bin/env node
/**
 * VERIFY THE ADVERTISED FREE TRIAL AGAINST THE LIVE DODO PRODUCTS.
 *
 * Run: npm run verify:trial
 *
 * WHY THIS EXISTS AS A SCRIPT RATHER THAN A RUNTIME CHECK. Eight public pages
 * promise a 14-day free trial. src/lib/dodo.ts now SENDS trial_period_days on
 * every create, which overrides the product and is the actual guarantee — but
 * the risk being guarded against is somebody editing the trial off a PRODUCT in
 * the Dodo dashboard, and two things follow from that:
 *
 *   1. The checkout response cannot detect it. Dodo's CreateSubscriptionResponse
 *      does not echo trial_period_days at all (gotchas#264), so the response-side
 *      length check is permanently unfalsifiable. Products, by contrast, DO
 *      report it: GET /products/{id} returns trial_period_days, trial_type and
 *      trial_amount. So the check is pointed at the thing that can change.
 *
 *   2. It must not sit on the checkout path. Three extra round trips in front of
 *      a paying customer would trade real conversions for a check that does not
 *      need to be live. This runs on demand or on a schedule instead.
 *
 * AND — the point of it being a script — IT EXITS NON-ZERO ON DRIFT. A
 * console.error inside the Next server goes to `journalctl -u mira-web` and
 * pages nobody; there is no Sentry, Datadog, PagerDuty or Slack webhook in this
 * product to route it to. A failing command, by contrast, is noticed by
 * construction: it reddens a terminal, fails a cron job, and breaks a CI step.
 * That is the honest substitute for alerting infrastructure we do not have.
 *
 * TO SCHEDULE IT (nothing here does this for you — deliberately; adding a cron
 * entry or a CI job is an infrastructure change, not a code change):
 *   daily, on the box:  cd /opt/mira-web && npm run verify:trial
 *   the non-zero exit is the signal; the printed report is the detail.
 *
 * SAFETY: read-only. It issues GET /products/{id} and nothing else — it creates
 * nothing, charges nothing and modifies nothing. It needs DODO_API_KEY and the
 * three DODO_PRODUCT_* ids in the environment, and it refuses to pretend it
 * verified anything when they are missing.
 */
import { verifyTrialProducts, fetchDodoProduct, TRIAL_PERIOD_DAYS } from "../src/lib/dodo.ts";

const MODE = process.env.DODO_MODE === "live" ? "live" : "test";

if (!process.env.DODO_API_KEY) {
  // NOT a pass. An unconfigured environment has verified nothing, and saying so
  // is the whole point — a "green" run that checked nothing is worse than a red
  // one, because it retires the question.
  console.error(
    "[verify:trial] CANNOT VERIFY: DODO_API_KEY is unset, so no product was read.\n" +
      "               This is NOT a pass. Provide the key (and the three DODO_PRODUCT_* ids)\n" +
      "               and run again, or run it on the box where runtime.conf supplies them.",
  );
  process.exit(2);
}

const report = await verifyTrialProducts({ fetchProduct: fetchDodoProduct });

console.log(`[verify:trial] Dodo mode: ${MODE}`);
console.log(`[verify:trial] advertised promise: a ${TRIAL_PERIOD_DAYS}-day FREE trial on every paid plan`);
console.log(`[verify:trial] products checked: ${report.checked}`);

for (const v of report.verdicts) {
  const head = `  ${v.ok ? "OK  " : "FAIL"}  ${v.plan.padEnd(10)} ${v.productId ?? "(no product id configured)"}`;
  if (v.observed) {
    console.log(
      `${head}  trial_period_days=${JSON.stringify(v.observed.trialPeriodDays)}` +
        ` trial_type=${JSON.stringify(v.observed.trialType)}` +
        ` trial_amount=${JSON.stringify(v.observed.trialAmount)}`,
    );
  } else {
    console.log(head);
  }
  for (const problem of v.problems) console.log(`          - ${problem}`);
}

if (report.ok) {
  console.log(`[verify:trial] PASS — every product grants the ${TRIAL_PERIOD_DAYS}-day free trial we advertise.`);
  process.exit(0);
}

console.error(
  `\n[verify:trial] FAIL — ${report.problems.length} problem(s). The public pages promise a ` +
    `${TRIAL_PERIOD_DAYS}-day free trial that the products do not grant.\n` +
    `               Customers may be charged against an advertised promise. Fix the product\n` +
    `               configuration in the Dodo dashboard, then run this again.`,
);
process.exit(1);
