import { NextResponse } from "next/server";
import { clearSession } from "@/lib/session";

export const runtime = "nodejs";

/** POST /api/auth/logout — clear the login session. */
export async function POST() {
  await clearSession();
  return NextResponse.json({ ok: true });
}
