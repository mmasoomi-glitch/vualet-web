import { NextResponse } from "next/server";
import { safeEqual, verifyConnectToken } from "@/lib/connect-token";
import { claimConnectWhatsapp } from "@/lib/whatsapp-claim";
import { getMigration, putMigration, findBindingByChannel } from "@/lib/channel-binding-store";
import { BINDING_STATES } from "@/lib/channel-binding-core.mjs";
import { commitMigration } from "@/lib/number-migration";
import { MIGRATION_STATES } from "@/lib/number-migration-core.mjs";

/**
 * POST /api/pair/bind — THE ENGINE'S CALLBACK, AND THE ONLY PLACE A WHATSAPP
 * CONNECT TOKEN IS EVER CONSUMED.
 *
 * ── WHY THIS ROUTE HAS TO EXIST [decisions#345 Q_C] ───────────────────────
 * The ruling is that the token is consumed ONLY on successful bind — not when
 * it is presented at /api/pair/start, and not when a QR is scanned. The bind
 * happens on the engine: it is the side that watches the WhatsApp socket come
 * up and learns which account answered. But the token is THIS app's — this app
 * minted it, holds MIRA_TOKEN_SECRET, and owns the record that carries plan,
 * status, persona and consent. So the two facts are on different machines and
 * something has to carry one to the other. The engine calls here.
 *
 * The single-use rule therefore lives on this side, where the record is, rather
 * than being reimplemented in the engine against a copy of the truth.
 *
 * ── WHY IT IS A NEW ROUTE AND NOT AN EXTENSION OF POST /api/connect ───────
 * /api/connect's POST is the LIVE Telegram bind path. It requires a numeric
 * `telegramId` and hard-rejects anything else, and every branch of it is
 * exercised by a bot that is in production today. Widening it would put a new
 * channel's edge cases inside the working channel's handler. A separate route
 * leaves that file untouched — scripts/pair-entry-test.mjs asserts it is
 * byte-identical to git — and costs nothing but a path.
 *
 * ── THE CONTRACT (to reconcile with the engine side) ──────────────────────
 *
 *     POST https://mira.vualet.com/api/pair/bind
 *     x-mira-bind-secret: <MIRA_BIND_SECRET>
 *     Content-Type: application/json
 *     { "token": "<connect token>",
 *       "whatsappId": "<account JID, e.g. 12025551234@s.whatsapp.net>",
 *       "tenantId": "<engine tenant id, created AT BIND>"   // optional
 *     }
 *
 *     200 { ok: true, firstBind, plan, status, customerId, persona, role, assistantName }
 *     401 { error: "unauthorized" }      wrong or missing shared secret
 *     403 { error: "invalid token" }     signature does not verify
 *     404 { error: "not_found" }         no such record (expired, or never existed)
 *     409 { error: "foreign" }           ALREADY BOUND TO A DIFFERENT ACCOUNT
 *     409 { error: "wrong_channel" }     a Telegram record; not bindable here
 *     503 { error: "not_configured" }    MIRA_BIND_SECRET unset in production
 *
 * WHAT A SECOND ATTEMPT DOES, precisely, because it is the question the
 * single-use rule exists to answer:
 *   * SAME account, again -> 200, `firstBind: false`, nothing written. The
 *     engine may retry safely; a dropped response must not cost the customer
 *     their token.
 *   * DIFFERENT account -> 409 `foreign`. The first account to bind owns the
 *     token, permanently. This is the whole invariant.
 *
 * ── WHAT IS NOT A GATE [decisions#345 Q_B] ────────────────────────────────
 * The phone number. A mismatch between the number given at signup and the
 * number that scanned is ADVISORY ONLY, never a refusal — overruled on live
 * evidence, because the product deliberately sells a SECOND number that becomes
 * the assistant, and the owner scanned with exactly such a number while his
 * personal line is in another country. This route does not compare them. It
 * cannot: it never receives a number it keeps, only a hash it compares.
 *
 * ── WHAT IS NEVER LOGGED HERE ─────────────────────────────────────────────
 * The token, the JID (which IS a phone number with a suffix), the bind secret,
 * or any part of them. The tenant id and the outcome are logged; they are
 * opaque and they are what makes a support call answerable.
 */

/** The largest body worth reading. A bind is four short strings. */
const CAP = 400;

function tooLong(s: unknown): boolean {
  return typeof s === "string" && s.length > CAP;
}

export async function POST(req: Request) {
  // AUTH FIRST, exactly as POST /api/connect does it, with the SAME secret:
  // this is the same trust relationship (our engine calling our app) and a
  // second secret would be a second thing to rotate and forget. Constant-time
  // compare; the reason is never reflected into the response.
  const secret = process.env.MIRA_BIND_SECRET;
  const presented = req.headers.get("x-mira-bind-secret") ?? "";
  if (secret) {
    if (!safeEqual(presented, secret)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    // FAIL CLOSED. An unset secret in production means anyone who can reach
    // this route could bind any token they can guess, so it refuses rather
    // than degrades — the same call /api/connect already makes.
    console.warn("[pair-bind] MIRA_BIND_SECRET unset in production — refusing engine bind calls.");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  let body: { token?: unknown; whatsappId?: unknown; tenantId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token : "";
  const whatsappId = typeof body.whatsappId === "string" ? body.whatsappId.trim() : "";
  const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";

  if (tooLong(body.token) || tooLong(body.whatsappId) || tooLong(body.tenantId)) {
    return NextResponse.json({ error: "field too long" }, { status: 400 });
  }
  if (!token || !whatsappId) {
    return NextResponse.json({ error: "token and whatsappId required" }, { status: 400 });
  }
  if (!verifyConnectToken(token)) {
    return NextResponse.json({ error: "invalid token" }, { status: 403 });
  }

  // A NUMBER THAT HAS BEEN TAKEN AWAY MAY NOT BIND ANYTHING.
  //
  // Two holes close here. A connect token minted for the old number before a
  // change could still be sitting in a browser tab afterwards, and scanning it
  // would hand that number access again — ghost access that revoking recovery
  // links alone does not cover, because the KV layer has no way to enumerate
  // outstanding tokens and revoke them one by one.
  //
  // And a number a telecom operator has since reassigned would otherwise be
  // able to pair afresh, which is the recycled-number case arriving through the
  // pairing door instead of the messaging one.
  //
  // Checked HERE rather than inside claimConnectWhatsapp because that module is
  // what channel-binding-store imports its hashing from; calling back into the
  // store from there would close an import cycle.
  try {
    const existing = await findBindingByChannel("whatsapp", whatsappId);
    if (
      existing &&
      (existing.state === BINDING_STATES.REVOKED || existing.state === BINDING_STATES.SUPERSEDED)
    ) {
      console.warn(
        `[pair-bind] REFUSED: this WhatsApp account has a ${existing.state} binding. ` +
          "Revoked means revoked; it does not come back by scanning. No number is logged.",
      );
      return NextResponse.json({ error: "revoked" }, { status: 409 });
    }
  } catch (err) {
    // A lookup failure must not become a way past the check. Refusing a real
    // customer for a minute is recoverable; letting a revoked number bind is not.
    console.error("[pair-bind] binding lookup failed; refusing rather than guessing:", err);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  const claim = await claimConnectWhatsapp(token, whatsappId, tenantId || undefined);
  if (!claim.ok) {
    if (claim.reason === "not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    // "foreign" and "wrong_channel" are both conflicts: the record exists and
    // says no. 409 rather than 403 so the engine can tell "your credentials are
    // wrong" from "this token is not yours to bind".
    if (claim.reason === "foreign") {
      console.warn(
        "[pair-bind] REFUSED: this connect token is already bound to a different WhatsApp " +
          "account. The first account to bind owns it. Neither the token nor either account is " +
          "logged.",
      );
    }
    return NextResponse.json({ error: claim.reason }, { status: 409 });
  }

  const rec = claim.rec;
  console.log(
    `[pair-bind] bound first_bind=${claim.firstBind} tenant_id=${rec.tenantId ?? "none"} plan=${rec.plan} status=${rec.status}`,
  );

  // ── NUMBER CHANGE: the scan that just succeeded IS the verification ──────
  //
  // The whole block is inside this guard so the ordinary pairing path is
  // completely unaffected: a record with no migrationId never enters here.
  //
  // Nothing in here may fail the bind. The customer's scan genuinely
  // succeeded, and turning that into an error because OUR bookkeeping broke
  // would punish them for our bug — so the whole thing is wrapped and
  // swallowed, and a half-applied cutover goes to a human instead.
  if (rec.migrationId) {
    try {
      // getMigration returns an opaque record; the shape is asserted here
      // rather than loosening putMigration, which should keep demanding an id.
      type MigrationRecord = { migrationId: string } & Record<string, unknown>;
      let migration = (await getMigration(rec.migrationId)) as MigrationRecord | null;
      if (!migration) {
        console.warn(`[pair-bind] migration ${rec.migrationId} is missing; pairing stands, cutover skipped.`);
      } else {
        if (migration.state === MIGRATION_STATES.VERIFICATION_REQUIRED) {
          // Control of the new number is exactly what a successful scan proves,
          // so this is the moment verification is satisfied.
          migration = { ...migration, state: MIGRATION_STATES.VERIFIED, verifiedAt: Date.now() };
          await putMigration(migration);
        }

        // Deliberately OUTSIDE the branch above. A migration already VERIFIED
        // by an earlier attempt that then crashed must still be able to finish
        // here, which is the whole point of a resumable cutover.
        const committed = await commitMigration(rec.migrationId, whatsappId, Date.now());
        if (committed.ok) {
          console.log(`[pair-bind] migration ${rec.migrationId} committed.`);
        } else {
          // Not a silent retry: the cutover may be half-applied, with the old
          // number already superseded, and that is a state a human should see
          // rather than a loop should keep poking.
          await putMigration({
            ...migration,
            state: MIGRATION_STATES.REVIEW_REQUIRED,
            failedReason: committed.reason,
          });
          console.error(
            `[pair-bind] migration ${rec.migrationId} could not commit (${committed.reason}); sent to review.`,
          );
        }
      }
    } catch (err) {
      // No JID is ever logged here or above: it is a phone number wearing a
      // suffix, and this route is the one place it exists in memory.
      console.error(`[pair-bind] migration bookkeeping failed for ${rec.migrationId}:`, err);
    }
  }

  // The persona is returned because that is the point of the whole token: it
  // carries what the customer shaped on the web across to the assistant that
  // will actually talk to them. It goes ONLY to a caller that presented the
  // bind secret — the GET side of /api/connect deliberately never returns it.
  return NextResponse.json({
    ok: true,
    firstBind: claim.firstBind,
    plan: rec.plan,
    status: rec.status,
    customerId: rec.customerId ?? null,
    persona: rec.persona ?? null,
    role: rec.role ?? null,
    assistantName: rec.assistantName ?? null,
  });
}
