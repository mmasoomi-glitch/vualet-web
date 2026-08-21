import { NextResponse } from "next/server";
import { getConnect, claimConnect } from "@/lib/store";
import { verifyConnectToken, safeEqual } from "@/lib/connect-token";
import { channelOfRecord, whatsappPairUrl } from "@/lib/pairing";

// Two callers, two shapes:
//   GET  ?token=…            — the welcome page. Public, but the token must carry a
//                              valid HMAC. Returns display info only — NEVER the persona.
//                              Channel-aware: WhatsApp records get { channel, pairUrl },
//                              Telegram (and every pre-channel record) keeps { channel, botUrl }.
//   POST {token, telegramId} — the Telegram bot, authenticated with the shared
//                              x-mira-bind-secret header. Performs the single-use claim
//                              (first telegramId owns the token) and returns the persona.

function botUrlFor(token: string): string {
  const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT || "ballerina_10840_bot";
  return `https://t.me/${bot}?start=${token}`;
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "missing token" }, { status: 400 });
  if (!verifyConnectToken(token)) return NextResponse.json({ error: "invalid token" }, { status: 403 });

  const rec = await getConnect(token);
  if (!rec) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // WHICH CHANNEL THIS CUSTOMER IS ON. The welcome page reads THIS route, not
  // /api/begin, so if the channel never reached here every customer would be
  // shown the Telegram branch forever — including the WhatsApp-first ones we
  // now sell to. A record with no channel field predates the field and can only
  // be a Telegram signup (see channelOfRecord).
  const channel = channelOfRecord(rec);

  if (channel === "whatsapp") {
    // pairUrl may be null when the pairing surface is not configured yet. We
    // still answer 200 with the rest of the record: this is a READ of something
    // already provisioned, so refusing it would blank the customer's plan and
    // status too. The welcome page has an explicit "unusable" state for a 2xx
    // with no link and renders no call-to-action there — an absent link degrades
    // into honest silence, whereas a guessed link would be a dead end. Note the
    // deliberate absence of botUrl: handing a WhatsApp customer a t.me link is
    // the exact bug this branch exists to prevent.
    return NextResponse.json({
      plan: rec.plan,
      status: rec.status,
      customerId: rec.customerId ?? null,
      assistantName: rec.assistantName ?? null,
      channel,
      pairUrl: whatsappPairUrl(rec.token),
    });
  }

  return NextResponse.json({
    plan: rec.plan,
    status: rec.status,
    customerId: rec.customerId ?? null,
    assistantName: rec.assistantName ?? null,
    channel,
    botUrl: botUrlFor(rec.token),
  });
}

export async function POST(req: Request) {
  const secret = process.env.MIRA_BIND_SECRET;
  const presented = req.headers.get("x-mira-bind-secret") ?? "";
  if (secret) {
    if (!safeEqual(presented, secret)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    console.warn("[mira] MIRA_BIND_SECRET unset in production — refusing bot bind calls.");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  let body: { token?: string; telegramId?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { token, telegramId } = body;
  if (!token || typeof telegramId !== "number" || !Number.isFinite(telegramId)) {
    return NextResponse.json({ error: "token and numeric telegramId required" }, { status: 400 });
  }
  if (!verifyConnectToken(token)) return NextResponse.json({ error: "invalid token" }, { status: 403 });

  const claim = await claimConnect(token, telegramId);
  if (!claim.ok) {
    return NextResponse.json(
      { error: claim.reason },
      { status: claim.reason === "foreign" ? 409 : 404 },
    );
  }

  const rec = claim.rec;
  return NextResponse.json({
    plan: rec.plan,
    status: rec.status,
    customerId: rec.customerId ?? null,
    persona: rec.persona ?? null,
    role: rec.role ?? null,
    assistantName: rec.assistantName ?? null,
    botUrl: botUrlFor(rec.token),
  });
}
