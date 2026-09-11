import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getSubscriptionByEmail, putConnect } from "@/lib/store";
import { mintConnectToken } from "@/lib/connect-token";
import { normalisePhone } from "@/lib/phone";
import { buildMigration, assessRisk, MIGRATION_STATES } from "@/lib/number-migration-core.mjs";
import {
  channelIdHash,
  findBindingByChannel,
  bindingsOfAccount,
  putMigration,
  newId,
  BINDING_STATES,
} from "@/lib/channel-binding-store";

/**
 * POST /api/channel/migrate — request a WhatsApp number change.
 *
 * ── THIS ROUTE REQUESTS AND NEVER COMMITS ─────────────────────────────────
 * It records the intent and hands back a pairing session for the NEW number.
 * Nothing is revoked, nothing is activated, and the subscription is not
 * touched. The cutover only happens once the new number has proved itself by
 * scanning, because a number a customer merely TYPED is a claim — they may
 * have mistyped it, or never have had it at all, and committing on a claim
 * would strand them on a number they cannot receive messages on.
 *
 * ── WHY THIS ONE NEEDS A SESSION AND A RECONNECT DOES NOT ─────────────────
 * Reconnecting the same number is proved by that number itself: the link goes
 * to it and the QR scan shows it is live. Changing to a DIFFERENT number
 * cannot be proved that way, because a SIM-swap attacker holding the victim's
 * phone would pass every phone-based check there is. The web session is
 * established by email, which a SIM swap does not capture, so it is the
 * factor that actually binds this request to the account owner.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session?.email) {
      return NextResponse.json(
        { error: "not_signed_in", message: "Sign in to change your WhatsApp number." },
        { status: 401 },
      );
    }

    let body: { newNumber?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }

    const raw = typeof body.newNumber === "string" ? body.newNumber.trim() : "";
    if (!raw) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }

    const normalised = normalisePhone(raw, { defaultCallingCode: "971" });
    if (!normalised.ok) {
      return NextResponse.json(
        {
          error: "bad_number",
          message: "That doesn't look like a complete number. Include the country code and try again.",
        },
        { status: 400 },
      );
    }
    const e164 = normalised.e164;

    const found = await getSubscriptionByEmail(session.email);
    if (!found) {
      return NextResponse.json(
        {
          error: "no_subscription",
          message: "We couldn't find a subscription on this account. Contact support and we'll sort it out.",
        },
        { status: 404 },
      );
    }
    const accountId = found.customerId;

    // Absent is allowed. A customer may be changing number precisely because
    // the old one is already dead, and refusing them here would mean the
    // people who most need this could not use it.
    const bindings = await bindingsOfAccount(accountId);
    const current = bindings.find(
      (b) => b.channelType === "whatsapp" && b.state === BINDING_STATES.ACTIVE,
    );
    const oldBindingId = current ? current.bindingId : null;

    const existing = await findBindingByChannel("whatsapp", e164);

    if (existing && existing.accountId !== accountId) {
      // The message says only that the number cannot be used. Confirming that
      // it belongs to somebody would turn this route into an oracle for
      // testing which phone numbers have accounts here.
      return NextResponse.json(
        {
          error: "number_in_use",
          message: "That number can't be used for this account. Contact support and we'll help.",
        },
        { status: 409 },
      );
    }

    if (existing && existing.accountId === accountId && existing.state === BINDING_STATES.ACTIVE) {
      return NextResponse.json(
        { error: "same_number", message: "That's already the number on your account." },
        { status: 400 },
      );
    }

    // A number change always arrives from a context we have not seen before,
    // so it never counts as a zero-signal event.
    const risk = assessRisk({ newDevice: true });
    const newIdentifierHash = channelIdHash("whatsapp", e164);

    const built = buildMigration({
      migrationId: newId("mig"),
      accountId,
      oldBindingId,
      newIdentifierHash,
      nowMs: Date.now(),
      initiatedFrom: "WEB_SESSION",
      riskLevel: risk.level,
    });
    if (!built.ok || !built.record) {
      return NextResponse.json(
        { error: "cannot_start", message: built.reason ?? "Could not start the change." },
        { status: 400 },
      );
    }
    const record = built.record as { migrationId: string } & Record<string, unknown>;

    // The pure core is plain JS, so TypeScript cannot narrow its union and
    // treats every field of `record` as optional. The shape is asserted here
    // rather than loosening putMigration, which should keep demanding an id.
    const migration = { ...record, state: MIGRATION_STATES.VERIFICATION_REQUIRED };
    await putMigration(migration);

    const pairToken = mintConnectToken();
    await putConnect({
      token: pairToken,
      plan: "migrate",
      status: "pending",
      channel: "whatsapp",
      customerId: accountId,
      // Stamping the expected hash means this pairing session can only ever be
      // completed by the number the customer actually asked for. A scan from
      // anything else is refused at the bind step, so a migration cannot be
      // quietly redirected onto a third number between request and commit.
      expectedChannelIdHash: newIdentifierHash,
      // The scan IS the verification, so the bind step needs to know which
      // migration it completes.
      migrationId: migration.migrationId,
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({
      ok: true,
      migrationId: migration.migrationId,
      pairToken,
      riskLevel: risk.level,
      requiresStrongAuth: risk.requiresStrongAuth,
    });
  } catch (err) {
    console.error("[channel-migrate]", err);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
