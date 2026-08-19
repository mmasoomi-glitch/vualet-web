import { NextResponse } from "next/server";
import { putConnect } from "@/lib/store";
import { mintConnectToken } from "@/lib/connect-token";

// Mock (no-payment) onboarding path. Creates a connect token that carries the
// persona chosen while shaping Mira, and returns the Telegram deep-link that
// binds this setup to the user's chat. Does NOT touch Stripe and works with zero
// env (store falls back to in-memory).
// Body: { plan?, email?, setup?: { assistantName?, role?, vibe?, persona? } }
//
// Length caps below are input-validation guards (OWASP ASVS 5.1/5.2), not
// business rules: they exist so a malicious/broken client can't shove
// megabytes of text into the store. `persona` is free-form user prose so it
// gets a generous cap; the short fields are effectively labels/enum-ish
// values and get a tight cap.
const CAP_SHORT = 200; // plan, email, setup.assistantName/role/vibe
const CAP_PERSONA = 2000; // setup.persona

function tooLong(s: string | undefined, max: number): boolean {
  return typeof s === "string" && s.length > max;
}

// ── Rate limiting ─────────────────────────────────────────────────────────
// In-memory sliding-window limiter (same pattern as veridian-demo). Each
// provision creates a real tenant record + Telegram deep-link; this is a
// resource faucet that must be gated. 5 provisions per IP per hour.
// Per-instance only (resets on redeploy); no external dependency.
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 3_600_000; // 1 hour
const _hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (_hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  arr.push(now);
  _hits.set(ip, arr);
  // Opportunistic cleanup so the map can't grow unbounded.
  if (_hits.size > 5000) {
    for (const [k, v] of _hits) {
      if (v.every((t) => now - t >= RATE_WINDOW_MS)) _hits.delete(k);
    }
  }
  return arr.length > RATE_LIMIT;
}

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";
}

export async function POST(req: Request) {
  // Rate-limit: prevent open-faucet tenant provisioning. Every call creates a
  // real tenant with trial credits — an unbounded endpoint is a resource drain.
  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many requests. Try again later." },
      { status: 429 },
    );
  }

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

  if (
    tooLong(plan, CAP_SHORT) ||
    tooLong(email, CAP_SHORT) ||
    tooLong(setup?.assistantName, CAP_SHORT) ||
    tooLong(setup?.role, CAP_SHORT) ||
    tooLong(setup?.vibe, CAP_SHORT) ||
    tooLong(setup?.persona, CAP_PERSONA)
  ) {
    return NextResponse.json({ error: "field too long" }, { status: 400 });
  }

  const token = mintConnectToken();

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
