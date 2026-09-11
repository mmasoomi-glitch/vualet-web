/**
 * Changing a WhatsApp number — the executor.
 *
 * The account, tenant, subscription and context survive untouched. Only the
 * channel binding is replaced.
 *
 * ── WHY REVOKE COMES BEFORE ACTIVATE ──────────────────────────────────────
 * If the process dies between the two, the customer is briefly disconnected
 * and a retry finishes the job. The other order leaves two live numbers on one
 * account, which is an account-takeover window. A short outage is a far better
 * failure than a security hole.
 *
 * ── WHY EVERY STEP IS PERSISTED IMMEDIATELY ───────────────────────────────
 * The store has no multi-key transaction, so the cutover cannot be one atomic
 * write. Instead each step records itself the moment it succeeds, which makes
 * a crash RESUMABLE rather than repeatable: a retry skips what is already done
 * instead of revoking twice or minting a second binding.
 *
 * ── WHAT ACTUALLY COMMITS ─────────────────────────────────────────────────
 * The engine that authorises an inbound sender is a separate service on
 * another host that cannot be modified, and it reads `whatsappIdHash` on the
 * subscription record. Writing that single field IS the cutover; everything
 * before it is preparation. That is why it happens last.
 */

import { MIGRATION_STATES, advance, isCommitted } from "@/lib/number-migration-core.mjs";
import {
  getBinding,
  createBinding,
  transitionBinding,
  putMigration,
  getMigration,
  revokeAllRecoveries,
  channelIdHash,
  BINDING_STATES,
  REASON_CODES,
} from "@/lib/channel-binding-store";
import { getSubscription, putSubscription } from "@/lib/store";

type Migration = {
  migrationId: string;
  accountId: string;
  oldBindingId: string | null;
  newIdentifierHash: string;
  newBindingId: string | null;
  state: string;
  stepsDone?: string[];
};

type Result =
  | { ok: true; migration: Migration; newBindingId: string }
  | { ok: false; reason: string; migration?: Migration };

export async function commitMigration(
  migrationId: string,
  newRawIdentifier: string,
  nowMs: number,
): Promise<Result> {
  try {
    const loaded = (await getMigration(migrationId)) as Migration | null;
    if (!loaded) return { ok: false, reason: "No such migration." };

    // THE IDEMPOTENCY GUARANTEE. Calling this twice must not revoke twice, mint
    // a second binding, or rewrite authority that is already correct.
    if (isCommitted(loaded)) {
      return { ok: true, migration: loaded, newBindingId: loaded.newBindingId ?? "" };
    }

    if (loaded.state !== MIGRATION_STATES.VERIFIED && loaded.state !== MIGRATION_STATES.COMMITTING) {
      return {
        ok: false,
        reason: `A migration in ${String(loaded.state)} is not ready to commit.`,
        migration: loaded,
      };
    }

    let migration = loaded;

    /**
     * Run one step, then record it and persist before moving on.
     *
     * The side effect is SKIPPED when the step is already recorded, which is
     * what makes a resumed migration safe — advance() would tolerate the
     * repeat, but revoking a binding twice or creating a second one would not.
     */
    const runStep = async (
      name: string,
      effect: () => Promise<{ ok: true } | { ok: false; reason: string }>,
    ): Promise<{ ok: true } | { ok: false; reason: string }> => {
      const done = Array.isArray(migration.stepsDone) ? migration.stepsDone : [];
      if (!done.includes(name)) {
        const effected = await effect();
        if (!effected.ok) return effected;
      }
      const advanced = advance(migration, name, nowMs);
      if (!advanced.ok) return { ok: false, reason: advanced.reason as string };
      migration = advanced.record as Migration;
      await putMigration(migration);
      return { ok: true };
    };

    // 1. The number being committed must be the number that was verified.
    // Without this, a verified migration could be committed onto a different
    // number than the one whose control was proven.
    const verify = await runStep("VERIFY_NEW", async () => {
      const hash = channelIdHash("whatsapp", newRawIdentifier);
      return hash === migration.newIdentifierHash
        ? { ok: true as const }
        : { ok: false as const, reason: "This is not the number that was verified." };
    });
    if (!verify.ok) return { ok: false, reason: verify.reason, migration };

    // 2. Reuse an existing new binding if a previous attempt got this far.
    const prepare = await runStep("PREPARE_NEW_BINDING", async () => {
      if (!migration.newBindingId) {
        const created = await createBinding({
          accountId: migration.accountId,
          channelType: "whatsapp",
          rawIdentifier: newRawIdentifier,
          nowMs,
        });
        migration = { ...migration, newBindingId: created.bindingId };
        await putMigration(migration);
      }
      return { ok: true as const };
    });
    if (!prepare.ok) return { ok: false, reason: prepare.reason, migration };

    const newBindingId = migration.newBindingId as string;

    // 3. The old number stops working here, BEFORE the new one starts.
    const revoke = await runStep("REVOKE_OLD_BINDING", async () => {
      if (migration.oldBindingId) {
        const old = await getBinding(migration.oldBindingId);
        if (old && old.state !== BINDING_STATES.SUPERSEDED && old.state !== BINDING_STATES.REVOKED) {
          const moved = await transitionBinding(migration.oldBindingId, BINDING_STATES.SUPERSEDED, {
            nowMs,
            reasonCode: REASON_CODES.USER_CHANGED_NUMBER,
            supersededBy: newBindingId,
          });
          if (!moved.ok) return { ok: false as const, reason: moved.reason };
        }
      }
      // No live reconnect link may survive a number change: one issued to the
      // old number moments earlier would otherwise still re-pair it.
      await revokeAllRecoveries(migration.accountId, nowMs);
      return { ok: true as const };
    });
    if (!revoke.ok) return { ok: false, reason: revoke.reason, migration };

    // 4. Now the new number starts working.
    const activate = await runStep("ACTIVATE_NEW_BINDING", async () => {
      const fresh = await getBinding(newBindingId);
      if (!fresh) return { ok: false as const, reason: "The new binding is missing." };
      if (fresh.state === BINDING_STATES.ACTIVE) return { ok: true as const };
      const moved = await transitionBinding(newBindingId, BINDING_STATES.ACTIVE, { nowMs });
      return moved.ok ? { ok: true as const } : { ok: false as const, reason: moved.reason };
    });
    if (!activate.ok) return { ok: false, reason: activate.reason, migration };

    // 5. THE ACTUAL CUTOVER: the one field the engine reads.
    const commit = await runStep("COMMIT_AUTHORITY", async () => {
      const sub = await getSubscription(migration.accountId);
      if (!sub) {
        // Refuse rather than invent one. A migration that cannot find the
        // subscription must stop with the old number already superseded — a
        // recoverable state — instead of manufacturing entitlement.
        return { ok: false as const, reason: "No subscription for this account." };
      }
      // ONLY the identifier changes. The subscription belongs to the account,
      // not to the number: status, plan and every period or expiry field are
      // untouched, so a customer who migrates on day 12 of 30 keeps their 18
      // days rather than restarting or losing them.
      await putSubscription(migration.accountId, { ...sub, whatsappIdHash: migration.newIdentifierHash });
      return { ok: true as const };
    });
    if (!commit.ok) return { ok: false, reason: commit.reason, migration };

    return { ok: true, migration, newBindingId };
  } catch (err) {
    console.error("[number-migration]", err);
    return { ok: false, reason: "unexpected_error" };
  }
}
