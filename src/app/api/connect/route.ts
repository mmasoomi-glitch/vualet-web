import { NextResponse } from "next/server";
import { getConnect } from "@/lib/store";

// Resolves a post-checkout connect token into the info the welcome page needs:
// plan, status, the customer id (for the billing portal), and the Telegram
// deep-link that binds this purchase to the user's chat with Mira.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "missing token" }, { status: 400 });

  const rec = await getConnect(token);
  if (!rec) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT || "ballerina_10840_bot";
  return NextResponse.json({
    plan: rec.plan,
    status: rec.status,
    customerId: rec.customerId ?? null,
    botUrl: `https://t.me/${bot}?start=${rec.token}`,
  });
}
