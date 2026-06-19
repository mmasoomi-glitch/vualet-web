// Mira VPN — AI Customer Support via DeepSeek
// POST /api/support/chat
// { message: "...", account_id?: "...", email?: "..." }
//
// DeepSeek API key from env DEEPSEEK_API_KEY (never hardcoded, never committed).
// Falls back to a canned response if the key is not configured.
//
// Account-aware: if account_id is provided, queries the Mira backend's
// /peers endpoint to check connection state, bytes used, tier.

const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";
const MIRA_BACKEND = "http://178.104.251.30/v1";

const SYSTEM_PROMPT = [
  "You are Mira, the AI support assistant for Mira VPN by Vualet.",
  "You help customers with:",
  "- Connection issues (Mira VPN won't connect, slow speeds)",
  "- Billing questions (subscription, cancellation, payment methods)",
  "- Account setup (how to install, how to enter activation code)",
  "- Troubleshooting (clear cache, reinstall, switch server)",
  "",
  "Rules:",
  "1. Be warm, brief, and accurate. Two sentences max where possible.",
  "2. Never mention competitors (NordVPN, Psiphon, ExpressVPN).",
  "3. Never suggest the user download anything from an external site.",
  "4. Never guess at account details — if you don't know, say 'I'll check your account and get back to you.'",
  "5. If the user is frustrated or you cannot resolve after 2 exchanges, escalate: 'I've opened a ticket for you. Someone from Vualet will follow up within 24 hours.' Then call the ticket creation endpoint.",
  "6. Never mention WireGuard, wintun, or protocol internals. Say 'Mira network driver.'",
  "7. Do not discuss pricing for countries or regions — say 'Pricing is the same worldwide: free forever, or $9.99/month.'",
  "8. For VPN not connecting: suggest (a) restart the app (b) try again in 1 minute (c) check firewall/antivirus is not blocking Mira.",
].join("\n");

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { message?: string; account_id?: string; email?: string };
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }

  const { message, account_id, email } = body;
  if (!message?.trim()) return Response.json({ reply: "I didn't catch that — can you try again?" });

  // Account lookup if we have an ID
  let accountContext = "";
  if (account_id) {
    try {
      const peersResp = await fetch(`${MIRA_BACKEND}/peers`);
      const peers = await peersResp.json();
      const match = (peers as any[]).find(
        (p: any) => p.pubkey?.startsWith(account_id) || p.ip === account_id
      );
      if (match) {
        accountContext = [
          `[Account context]`,
          `IP: ${match.ip}`,
          `Tier: ${match.tier}`,
          `Connected since: ${match.registered_at ?? "unknown"}`,
          `Data used: ${Math.round((match.tx_bytes + match.rx_bytes) / 1_048_576)} MB`,
        ].join(" · ");
      }
    } catch { /* proceed without context */ }
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return Response.json({
      reply: "I'm having trouble reaching our support system right now. Please email us or try again in a few minutes.",
      fallback: true,
    });
  }

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    ...(accountContext ? [{ role: "system" as const, content: accountContext }] : []),
    { role: "user" as const, content: message },
  ];

  try {
    const ds = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "deepseek-chat", messages, max_tokens: 300, temperature: 0.6 }),
    });
    const result = await ds.json();
    const reply: string = result.choices?.[0]?.message?.content || "I'm not sure how to help with that — let me escalate to our team.";

    // Auto-escalate if the reply suggests opening a ticket
    if (reply.toLowerCase().includes("ticket") || reply.toLowerCase().includes("escalat")) {
      try {
        await fetch(`${MIRA_BACKEND}/tickets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email || "chat-escalation",
            subject: `Chat escalation: ${message.slice(0, 80)}`,
            body: message,
          }),
        });
      } catch { /* best-effort */ }
    }

    return Response.json({ reply, ticket_created: reply.toLowerCase().includes("ticket") });
  } catch {
    return Response.json({ reply: "I'm having trouble right now. Can you try again in a minute? If this persists, a human will follow up." });
  }
}
