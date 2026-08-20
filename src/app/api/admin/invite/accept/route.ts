import { NextResponse } from "next/server";
import { acceptInvite } from "@/lib/admin-accounts";
import { appendAudit } from "@/lib/admin-audit";
import { randomId } from "@/lib/admin-crypto";

/**
 * Public invite acceptance (backend-generalised §7): an invited admin sets their
 * password using the one-time token from their invite link. The account moves to
 * ACTIVE; MFA enrolment is then forced on first sign-in. Token is verified by
 * hash; a wrong/expired token yields a generic failure.
 */
export async function POST(req: Request) {
  let body: { email?: string; token?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const email = (body.email || "").trim().toLowerCase();
  const token = (body.token || "").trim();
  const password = body.password || "";
  if (!email || !token || password.length < 10) {
    return NextResponse.json(
      { error: "invalid_input", message: "Email, token, and a password of at least 10 characters are required." },
      { status: 400 },
    );
  }

  const account = await acceptInvite(email, token, password);
  if (!account) {
    return NextResponse.json({ error: "invalid_or_expired" }, { status: 400 });
  }

  await appendAudit({
    adminId: account.id,
    role: account.roles.join(","),
    action: "invite.accept",
    target: account.id,
    requestId: randomId("req", 8),
    result: "success",
  });

  return NextResponse.json({ ok: true });
}
