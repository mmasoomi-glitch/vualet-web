import { NextResponse } from "next/server";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-guard";
import { reviewQueue, getMigration, clearFromReview } from "@/lib/channel-binding-store";

/**
 * /api/ops/channel/review — number changes that need a human.
 *
 * A migration lands here when its cutover could not complete. That state is
 * genuinely dangerous: the old number may already be superseded while
 * authority has not moved, so the customer is between two numbers and only a
 * person should decide what happens next.
 *
 * Permission: health.read.
 */
export const dynamic = "force-dynamic";

type MigrationRow = Record<string, unknown>;

export async function GET() {
  try {
    await requireAdmin("health.read");

    const ids = await reviewQueue();
    const items: MigrationRow[] = [];

    for (const migrationId of ids) {
      const migration = (await getMigration(migrationId)) as MigrationRow | null;
      // Skipped rather than emitted as a null. A hole in a review list reads as
      // a bug and costs an operator time working out whether it is one.
      if (!migration) continue;

      // newIdentifierHash is deliberately absent. It is a stable pseudonymous
      // identifier for a phone number, so a console that showed it would let an
      // operator correlate the same person across different accounts.
      items.push({
        migrationId: migration.migrationId,
        accountId: migration.accountId,
        state: migration.state,
        failedReason: migration.failedReason ?? null,
        requestedAt: migration.requestedAt ?? null,
        stepsDone: migration.stepsDone ?? [],
      });
    }

    return NextResponse.json({ count: items.length, items });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

/**
 * Mark one as handled.
 *
 * This removes it from the QUEUE and changes no migration state whatsoever.
 * Marking a review as dealt with is a bookkeeping act; letting an ops endpoint
 * mutate a half-applied cutover would be the most dangerous button in the
 * product, and it is not going to exist by accident.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin("health.read");

    let body: { migrationId?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "migration_required" }, { status: 400 });
    }

    const migrationId = typeof body.migrationId === "string" ? body.migrationId.trim() : "";
    if (!migrationId) {
      return NextResponse.json({ error: "migration_required" }, { status: 400 });
    }

    await clearFromReview(migrationId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
