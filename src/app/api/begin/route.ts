import { NextResponse } from "next/server";
import { putConnect } from "@/lib/store";

// Mock (no-payment) onboarding path. Creates a connect token that carries the
// persona chosen while shaping Mira, and returns the Telegram deep-link that
// binds this setup to the user's chat. Does NOT touch Dodo and works with zero
// env (store falls back to in-memory).
// Body: { plan?, email?, setup?: { assistantName?, role?, vibe?, persona? } }
export async function POST(req: Request) {
  let body: {
    plan?: string;
    email?: string;
    setup?: { assistantName?: string; role?: string; vibe?: string; persona?: string };
  };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const { plan, email, setup } = body;
  const token = crypto.randomUUID();

  await putConnect({
    token,
    plan: plan ?? "trial",
    status: "pending",
    persona: setup?.persona,
    role: setup?.role,
    assistantName: setup?.assistantName,
    email,
    createdAt: new Date().toISOString(),
  });

  const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT || "ballerina_10840_bot";
  return NextResponse.json({
    token,
    botUrl: `https://t.me/${bot}?start=${token}`,
  });
}
