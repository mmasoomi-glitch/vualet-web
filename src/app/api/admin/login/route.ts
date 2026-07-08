import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/connect-token";
import { ADMIN_COOKIE, ADMIN_SESSION_TTL_MS, adminConfigured, mintAdminSession } from "@/lib/admin-session";

// POST { password } → verifies against ADMIN_PASSWORD and sets the signed
// httpOnly session cookie middleware checks on every /admin request.
// DELETE → sign out (clears the cookie).
export async function POST(req: Request) {
  if (!adminConfigured()) {
    return NextResponse.json(
      { error: "not_configured", message: "Set ADMIN_PASSWORD and ADMIN_SESSION_SECRET to enable the admin panel." },
      { status: 503 },
    );
  }

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (!body.password || !safeEqual(body.password, process.env.ADMIN_PASSWORD!)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, mintAdminSession(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_SESSION_TTL_MS / 1000,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
