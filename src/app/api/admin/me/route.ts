import { NextResponse } from "next/server";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-guard";
import { toPublic } from "@/lib/admin-accounts";
import { permissionsFor } from "@/lib/admin-roles";

/** Current admin identity for the UI (no secrets). */
export async function GET() {
  try {
    const ctx = await requireAdmin();
    return NextResponse.json({
      admin: toPublic(ctx.admin),
      permissions: permissionsFor(ctx.admin.roles),
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
