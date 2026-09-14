/**
 * Tell the customers who are paying and have no working assistant.
 *
 * RUN ON THE PRODUCTION HOST, where the store and SMTP live:
 *
 *   node scripts/send-outage-notice.mjs            # dry run: prints, sends nothing
 *   node scripts/send-outage-notice.mjs --send     # actually sends
 *
 * ── WHY THIS IS SELF-CONTAINED ────────────────────────────────────────────
 * The production host runs Node 20, which cannot strip TypeScript. So this
 * imports nothing from src/lib/*.ts and reads the store file and speaks SMTP
 * directly. The one thing it does import is the notice copy, which is .mjs
 * precisely so the words a customer reads are defined in one place and covered
 * by tests rather than retyped here.
 *
 * ── WHY DRY RUN IS THE DEFAULT ────────────────────────────────────────────
 * This writes to real people who are already unhappy, and there is no unsend.
 * The first draft of the copy blamed a change on our side; checking the store
 * immediately before sending showed that could not be proven. Dry run is the
 * default because that check only happens if there is a step at which to make it.
 *
 * It is IDEMPOTENT: every recipient is recorded and a second run skips them.
 * Running it twice must not apologise twice.
 *
 * It records the goodwill as OWED, never as given. The 15 days must be applied
 * in the payment processor's admin by a human — entitlement here is gated on
 * subscription status and the billing period is not ours to move — which is
 * exactly why the email promises rather than claims.
 */

import fs from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import { OUTAGE_OFFER, buildOutageNotice } from "../src/lib/outage-notice-core.mjs";

const SENT_KEY = "mira:outage:notified:2026-09";
const GOODWILL_KEY = "mira:outage:goodwill:2026-09";
const SEND = process.argv.includes("--send");

/**
 * When they started paying — NOT when a connection broke.
 *
 * We cannot evidence a break. None of these subscriptions carries a tenant id
 * or a bound identifier and their connect records had expired by the time this
 * ran, so "we broke it" and "they never finished pairing" are indistinguishable
 * from here. What IS certain is the date they began paying and the fact that
 * they have had no working assistant since. That is the interval we owe for,
 * and it is the larger, more honest one.
 */
const SINCE_ISO = "2026-09-05T00:00:00.000Z";
const SUPPORT_EMAIL = "support@vualet.com";

/**
 * Load runtime.conf WITHOUT a shell.
 *
 * It is systemd's EnvironmentFile format: values are literal and unquoted, so
 * `MIRA_SMTP_FROM=Mira <login@vualet.com>` is valid there and a redirection to
 * bash. Sourcing a file like this is how a private key got executed and printed
 * earlier in this project, so it is parsed plainly here, line by line.
 */
function loadRuntimeConf(file) {
  if (!fs.existsSync(file)) return 0;
  const SEP = new RegExp(String.fromCharCode(13) + "?" + String.fromCharCode(10));
  let loaded = 0;
  for (const line of fs.readFileSync(file, "utf8").split(SEP)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;
    if (process.env[key] === undefined) {
      process.env[key] = trimmed.slice(eq + 1);
      loaded++;
    }
  }
  return loaded;
}

/* ── the store, in the same shape src/lib/store.ts writes ──────────────── */

function storeFile() {
  const file = (process.env.MIRA_STORE_FILE || "").trim();
  if (!file) throw new Error("MIRA_STORE_FILE is not set — run this on the production host");
  return file;
}

const readAll = () => JSON.parse(fs.readFileSync(storeFile(), "utf8"));

function readKey(all, key) {
  const entry = all[key];
  if (!entry || typeof entry.v !== "string") return null;
  try {
    return JSON.parse(entry.v);
  } catch {
    return null;
  }
}

/** Temp then rename, the same durability the store itself uses. */
function writeKey(key, value) {
  const file = storeFile();
  const all = readAll();
  all[key] = { v: JSON.stringify(value) };
  const tmp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(all));
  fs.renameSync(tmp, file);
}

/* ── mail, the same transport src/lib/email.ts configures ──────────────── */

const smtpConfigured = () =>
  Boolean(process.env.MIRA_SMTP_HOST && process.env.MIRA_SMTP_USER && process.env.MIRA_SMTP_PASS);

let transport = null;
async function sendMail(to, subject, html, text) {
  if (!smtpConfigured()) throw new Error("SMTP is not configured");
  if (!transport) {
    const port = Number(process.env.MIRA_SMTP_PORT || 587);
    transport = nodemailer.createTransport({
      host: process.env.MIRA_SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.MIRA_SMTP_USER, pass: process.env.MIRA_SMTP_PASS },
    });
  }
  const from = process.env.MIRA_SMTP_FROM || `Mira <${process.env.MIRA_SMTP_USER}>`;
  await transport.sendMail({ from, to, subject, text, html });
}

/* ── who is affected ───────────────────────────────────────────────────── */

/** First character of the local part only, so a log can be read safely. */
function maskEmail(email) {
  const [user, domain] = String(email).split("@");
  if (!domain) return "***";
  return `${user.slice(0, 1)}***@${domain}`;
}

function affectedCustomers(all) {
  const out = [];
  for (const key of Object.keys(all)) {
    if (!key.startsWith("mira:sub:")) continue;
    const rec = readKey(all, key);
    if (!rec || rec.channel !== "whatsapp") continue;
    out.push({
      customerId: key.slice("mira:sub:".length),
      email: typeof rec.email === "string" && rec.email.includes("@") ? rec.email : null,
      status: rec.status,
      plan: rec.plan,
    });
  }
  return out;
}

/**
 * The obligation record.
 *
 * Deliberately the same shape as src/lib/goodwill.ts, which is the canonical
 * definition and is tested: an opaque subjectRef (never a phone or an email),
 * a reason a human will read months from now, and status "owed" until an
 * operator discharges it. It cannot be imported here because the host cannot
 * load TypeScript.
 */
function goodwillEntry(customerId, nowIso) {
  return {
    id: `gw_outage_${customerId}`,
    createdAt: nowIso,
    subjectRef: customerId,
    incidentId: null,
    // Read by a human months from now. It must not assert the cause we could
    // not establish, only the obligation, which is not in doubt.
    reason: "Paid from 2026-09-05 with no connected WhatsApp; cause not established",
    kind: OUTAGE_OFFER.kind,
    value: OUTAGE_OFFER.value,
    status: "owed",
    appliedAt: null,
    appliedBy: null,
    note: null,
  };
}

async function main() {
  loadRuntimeConf(process.env.MIRA_RUNTIME_CONF || "/opt/mira-web/runtime.conf");

  const all = readAll();
  const customers = affectedCustomers(all);
  const already = readKey(all, SENT_KEY) || [];
  const goodwill = readKey(all, GOODWILL_KEY) || [];

  const base = (process.env.MIRA_WEB_URL || "https://mira.vualet.com").replace(/\/+$/, "");
  const built = buildOutageNotice({
    reconnectUrl: `${base}/mira/reconnect`,
    offer: OUTAGE_OFFER,
    sinceIso: SINCE_ISO,
    nowIso: new Date().toISOString(),
    supportEmail: SUPPORT_EMAIL,
  });
  if (!built.ok) throw new Error(`could not build the notice: ${built.reason}`);
  const { subject, text, html } = built.notice;

  const rule = "=".repeat(72);
  console.log(`\n${rule}`);
  console.log(SEND ? "SENDING — this is not a drill" : "DRY RUN — nothing will be sent");
  console.log(rule);
  console.log(`\nSUBJECT: ${subject}\n`);
  console.log(text);
  console.log(`\n${rule}`);
  console.log(`WhatsApp customers found: ${customers.length}`);

  let sent = 0;
  let skipped = 0;
  let unreachable = 0;

  for (const c of customers) {
    const label = c.email ? maskEmail(c.email) : "(no email on file)";

    if (!c.email) {
      console.log(`  UNREACHABLE  ${label} — cannot be told at all`);
      unreachable++;
      continue;
    }
    if (already.includes(c.customerId)) {
      console.log(`  SKIP         ${label} — already written to`);
      skipped++;
      continue;
    }
    if (!SEND) {
      console.log(`  WOULD SEND   ${label}  (+ ${OUTAGE_OFFER.value} free days owed)`);
      sent++;
      continue;
    }

    try {
      await sendMail(c.email, subject, html, text);
      // Recorded only AFTER a successful send, so a failure retries rather than
      // leaving somebody silently un-apologised-to. The obligation is recorded
      // in the same breath: we owe them the moment the promise is delivered.
      already.push(c.customerId);
      goodwill.push(goodwillEntry(c.customerId, new Date().toISOString()));
      writeKey(SENT_KEY, already);
      writeKey(GOODWILL_KEY, goodwill);
      console.log(`  SENT         ${label}  (+ ${OUTAGE_OFFER.value} free days owed)`);
      sent++;
    } catch (err) {
      console.log(`  FAILED       ${label} — ${err.message}`);
    }
  }

  console.log(`\n${SEND ? "sent" : "would send"}: ${sent}   skipped: ${skipped}   unreachable: ${unreachable}`);
  if (sent > 0 && SEND) {
    console.log(
      `\nOWED: ${sent} x ${OUTAGE_OFFER.value} free days, recorded under ${GOODWILL_KEY}.\n` +
        `This code CANNOT apply them: entitlement is gated on subscription status and the\n` +
        `billing period lives in the payment processor. Apply them in the Dodo admin —\n` +
        `the email promises them.`,
    );
  }
  if (!SEND) console.log("\nRe-run with --send to actually send.");
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
