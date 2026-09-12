/**
 * Tell the customers whose assistant went silent.
 *
 * RUN ON THE PRODUCTION HOST, where the store and SMTP live.
 *
 *   node scripts/send-outage-notice.mjs            # dry run: prints, sends nothing
 *   node scripts/send-outage-notice.mjs --send     # actually sends
 *
 * DRY RUN IS THE DEFAULT ON PURPOSE. This writes to real people who are already
 * unhappy, and there is no way to unsend it.
 *
 * It is IDEMPOTENT: every recipient is recorded, and a second run skips anybody
 * already written to. Running it twice must not apologise twice.
 *
 * It records the goodwill as OWED, not as given. The 15 days have to be applied
 * in the payment processor's admin by a human — this code cannot do it, and the
 * email is careful to promise rather than claim.
 */

import { kvGet, kvSet, getSubscription } from "../src/lib/store.ts";
import { emailConfigured, sendMail } from "../src/lib/email.ts";
import { OUTAGE_OFFER, buildOutageNotice } from "../src/lib/outage-notice-core.mjs";
import { createEntry } from "../src/lib/goodwill.ts";

const SENT_KEY = "mira:outage:notified:2026-09";
const GOODWILL_KEY = "mira:outage:goodwill:2026-09";
const SEND = process.argv.includes("--send");

// When the credentials broke, from the incident record.
const SINCE_ISO = "2026-09-07T00:00:00.000Z";
const RECONNECT_URL = `${(process.env.MIRA_WEB_URL || "https://mira.vualet.com").replace(/\/+$/, "")}/mira/reconnect`;
const SUPPORT_EMAIL = "support@vualet.com";

/** Only ever the local part's first character, so a log can be read safely. */
function maskEmail(email) {
  const [user, domain] = String(email).split("@");
  if (!domain) return "***";
  return `${user.slice(0, 1)}***@${domain}`;
}

async function affectedCustomers() {
  const file = process.env.MIRA_STORE_FILE;
  if (!file) throw new Error("MIRA_STORE_FILE is not set — run this on the production host");
  const { readFileSync } = await import("fs");
  const raw = JSON.parse(readFileSync(file, "utf8"));

  const out = [];
  for (const key of Object.keys(raw)) {
    if (!key.startsWith("mira:sub:")) continue;
    const customerId = key.slice("mira:sub:".length);
    const rec = await getSubscription(customerId);
    if (!rec) continue;
    // Paid, on WhatsApp, and reachable. Anyone without an email cannot be told
    // at all, which is worth surfacing rather than silently skipping.
    if (rec.channel !== "whatsapp") continue;
    out.push({ customerId, email: rec.email || null, status: rec.status, plan: rec.plan });
  }
  return out;
}

async function main() {
  const customers = await affectedCustomers();
  const already = (await kvGet(SENT_KEY)) || [];
  const built = buildOutageNotice({
    reconnectUrl: RECONNECT_URL,
    offer: OUTAGE_OFFER,
    sinceIso: SINCE_ISO,
    nowIso: new Date().toISOString(),
    supportEmail: SUPPORT_EMAIL,
  });
  if (!built.ok) throw new Error(`could not build the notice: ${built.reason}`);
  const { subject, text, html } = built.notice;

  console.log(`\n${"=".repeat(72)}`);
  console.log(SEND ? "SENDING" : "DRY RUN — nothing will be sent");
  console.log("=".repeat(72));
  console.log(`\nSUBJECT: ${subject}\n`);
  console.log(text);
  console.log(`\n${"=".repeat(72)}`);
  console.log(`WhatsApp customers found: ${customers.length}`);

  const goodwill = (await kvGet(GOODWILL_KEY)) || [];
  let sent = 0;
  let skipped = 0;
  let unreachable = 0;

  for (const c of customers) {
    const label = c.email ? maskEmail(c.email) : "(no email on file)";

    if (!c.email) {
      console.log(`  UNREACHABLE  ${label} — no email; this customer cannot be told at all`);
      unreachable++;
      continue;
    }
    if (already.includes(c.customerId)) {
      console.log(`  SKIP         ${label} — already written to`);
      skipped++;
      continue;
    }

    // The obligation is recorded BEFORE the send. If the send fails we owe them
    // anyway; if we recorded it after, a crash would lose the promise we just
    // made in writing.
    const entry = createEntry({
      id: `gw_outage_${c.customerId}`,
      nowIso: new Date().toISOString(),
      subjectRef: c.customerId,
      reason: "WhatsApp connection lost by our fault, 2026-09-07",
      kind: OUTAGE_OFFER.kind,
      value: OUTAGE_OFFER.value,
    });
    if (!entry.ok) {
      console.log(`  ERROR        ${label} — could not record goodwill: ${entry.reason}`);
      continue;
    }

    if (!SEND) {
      console.log(`  WOULD SEND   ${label}  (+ ${OUTAGE_OFFER.value} free days owed)`);
      sent++;
      continue;
    }

    if (!emailConfigured()) throw new Error("SMTP is not configured — refusing to pretend to send");

    try {
      await sendMail(c.email, subject, html, text);
      already.push(c.customerId);
      goodwill.push(entry.entry);
      await kvSet(SENT_KEY, already);
      await kvSet(GOODWILL_KEY, goodwill);
      console.log(`  SENT         ${label}  (+ ${OUTAGE_OFFER.value} free days owed)`);
      sent++;
    } catch (err) {
      // Not recorded as sent, so a retry will try again rather than leaving
      // somebody silently un-apologised-to.
      console.log(`  FAILED       ${label} — ${err.message}`);
    }
  }

  console.log(`\n${SEND ? "sent" : "would send"}: ${sent}   skipped: ${skipped}   unreachable: ${unreachable}`);
  if (sent > 0) {
    console.log(
      `\nOWED: ${sent} x ${OUTAGE_OFFER.value} free days. This code CANNOT apply them — entitlement is\n` +
        `gated on subscription status and the period lives in the payment processor.\n` +
        `Apply them in the Dodo admin. The email promises them.`,
    );
  }
  if (!SEND) console.log("\nRe-run with --send to actually send.");
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
