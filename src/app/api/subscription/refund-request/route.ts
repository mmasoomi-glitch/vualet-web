import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getSession } from "@/lib/session";
import { getSubscriptionByEmail } from "@/lib/store";
import { emailConfigured, sendMail } from "@/lib/email";

/**
 * Refund REQUEST — deliberately not a refund (defect E, jury verdict #102).
 *
 * The jury drew the line here explicitly: cancelling is the customer's own
 * right and is self-serve (/api/subscription/cancel), but a refund moves real
 * money OUT and is a fraud surface, so it stays behind human approval. This
 * route therefore records the request durably, notifies the operator, and
 * tells the customer plainly what happens next. It NEVER calls the payment
 * provider — refundDodoPayment() exists in src/lib/dodo.ts for an authorised
 * operator path, and is intentionally not reachable from here.
 *
 * Durability follows the same pattern as /api/contact: an append-only JSONL
 * file that survives restarts and redeploys with no external dependency. Set
 * REFUND_REQUEST_FILE to a path OUTSIDE the deploy tree in production so a
 * redeploy cannot wipe pending requests. Email is best-effort on top — if SMTP
 * is down the request is still on disk, so a customer's request is never lost.
 *
 * Anti-IDOR: identity comes only from the verified session; the caller cannot
 * name whose subscription to refund.
 */
const REFUND_FILE =
  process.env.REFUND_REQUEST_FILE || path.join(process.cwd(), "data", "refund-requests.jsonl");

const OPERATOR_EMAIL = process.env.MIRA_SUPPORT_EMAIL || "info@vualet.com";
const MAX_REASON = 2000;

type RefundRequest = {
  at: string;
  email: string;
  reason: string;
  customerId?: string;
  subscriptionId?: string;
  plan?: string;
  status?: string;
};

async function record(entry: RefundRequest): Promise<void> {
  await fs.mkdir(path.dirname(REFUND_FILE), { recursive: true });
  await fs.appendFile(REFUND_FILE, JSON.stringify(entry) + "\n", "utf8");
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.email) {
    return NextResponse.json(
      { error: "not_signed_in", message: "Sign in to request a refund." },
      { status: 401 },
    );
  }

  let reason = "";
  try {
    const body = (await req.json()) as { reason?: string };
    reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, MAX_REASON) : "";
  } catch {
    /* reason is optional — an empty body is a valid request */
  }

  // Attach whatever subscription context we have, so the operator does not have
  // to go hunting. Absence is not an error: a customer who predates the email
  // index still deserves their request to reach a human.
  const found = await getSubscriptionByEmail(session.email);

  const entry: RefundRequest = {
    at: new Date().toISOString(),
    email: session.email,
    reason,
    customerId: found?.customerId,
    subscriptionId: found?.rec.subscriptionId,
    plan: found?.rec.plan,
    status: found?.rec.status,
  };

  try {
    await record(entry);
  } catch (err) {
    // If we cannot even record it, say so honestly rather than implying the
    // request is safely queued.
    console.error("[refund-request] could not record:", err);
    return NextResponse.json(
      {
        error: "not_recorded",
        message: `We couldn't file that automatically. Please email ${OPERATOR_EMAIL} and we'll handle it personally.`,
      },
      { status: 502 },
    );
  }

  // Best-effort operator notification. A failure here must NOT fail the request,
  // because the durable record above is the source of truth.
  if (emailConfigured()) {
    const subject = `Refund request — ${session.email}`;
    const lines = [
      `Customer: ${session.email}`,
      `Plan: ${entry.plan ?? "unknown"}`,
      `Status: ${entry.status ?? "unknown"}`,
      `Customer id: ${entry.customerId ?? "unknown"}`,
      `Subscription id: ${entry.subscriptionId ?? "unknown"}`,
      `Requested: ${entry.at}`,
      "",
      `Reason: ${reason || "(none given)"}`,
    ];
    const text = lines.join("\n");
    const html = `<pre style="font:14px/1.5 ui-monospace,monospace">${lines
      .map((l) => l.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
      .join("\n")}</pre>`;
    try {
      await sendMail(OPERATOR_EMAIL, subject, html, text);
    } catch (err) {
      console.error("[refund-request] operator email failed (request still recorded):", err);
    }
  }

  return NextResponse.json({
    ok: true,
    message:
      "Refund request received. A person reviews every refund — we'll be in touch shortly. If you also want billing to stop now, cancel your plan above; that takes effect immediately.",
  });
}
