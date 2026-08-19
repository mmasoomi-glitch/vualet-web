import { NextResponse } from "next/server";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-guard";
import { getCustomers } from "@/lib/admin-stub";
import { toAdminCustomerMetadata } from "@/lib/admin-privacy-contract";

/**
 * Customer directory for admins — METADATA ONLY (backend-generalised §1).
 *
 * The response is built exclusively through toAdminCustomerMetadata(), which
 * projects each record down to the explicit metadata allowlist. There is no
 * code path here that returns a conversation, message, memory, transcript,
 * prompt, output, or document body — and this module never imports a
 * content-bearing store (veridian-memory / veridian-kb). The privacy test
 * enforces both invariants against this file.
 */
export async function GET() {
  try {
    await requireAdmin("customers.read");
    const customers = getCustomers().map((c) => toAdminCustomerMetadata(c as unknown as Record<string, unknown>));
    return NextResponse.json({ customers });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
