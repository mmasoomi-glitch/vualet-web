import { NextResponse } from "next/server";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-guard";
import { channelTimeline, verifyChannelChain } from "@/lib/channel-event-log";
import { bindingsOfAccount } from "@/lib/channel-binding-store";

/**
 * GET /api/ops/channel/timeline?account=<id> — the support and security view.
 *
 * The whole point is that support never has to guess what happened and never
 * has to type it from memory into a notes field. Everything here is generated
 * from the canonical event chain.
 *
 * Permission: health.read (owner/security/ops/auditor).
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireAdmin("health.read");

    const url = new URL(req.url);
    const account = (url.searchParams.get("account") || "").trim();
    if (!account) {
      return NextResponse.json({ error: "account_required" }, { status: 400 });
    }
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 200, 1), 500);

    const [timeline, chain, bindings] = await Promise.all([
      channelTimeline(account, limit),
      // Returned alongside the timeline so an operator can see at a glance
      // whether the evidence they are about to rely on still verifies. A
      // timeline nobody can vouch for is not evidence.
      verifyChannelChain(),
      bindingsOfAccount(account),
    ]);

    // channelIdHash is deliberately dropped. It is a stable pseudonymous
    // identifier for a phone number, so a console that displays it lets an
    // operator correlate the same person across different accounts — exactly
    // the linkage the hashing exists to prevent.
    const safeBindings = bindings.map((b) => ({
      bindingId: b.bindingId,
      channelType: b.channelType,
      state: b.state,
      pairedAt: b.pairedAt,
      lastSeenAt: b.lastSeenAt,
      revokedAt: b.revokedAt,
      revocationReason: b.revocationReason,
      supersededByBindingId: b.supersededByBindingId,
    }));

    return NextResponse.json({ account, chain, bindings: safeBindings, timeline });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
