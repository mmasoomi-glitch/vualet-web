import { NextResponse } from "next/server";
import { dodo, appUrl, paymentsConfigured } from "@/lib/dodo";

// Returns a Dodo customer-portal link so a subscriber can manage/cancel billing.
// Body: { customer_id }  (until auth lands, the welcome page passes this through).
export async function POST(req: Request) {
  if (!paymentsConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  let customerId: string | undefined;
  try {
    customerId = (await req.json())?.customer_id;
  } catch {
    /* fall through */
  }
  if (!customerId) {
    return NextResponse.json({ error: "missing customer_id" }, { status: 400 });
  }

  try {
    const session = await dodo().customers.customerPortal.create(customerId, {
      send_email: false,
    } as Record<string, unknown>);
    const url = (session as { link?: string; url?: string }).link ?? (session as { url?: string }).url;
    if (!url) throw new Error("Dodo returned no portal link.");
    return NextResponse.json({ url });
  } catch (err) {
    console.error("[portal] failed:", err);
    return NextResponse.json(
      { error: "portal_failed", message: "Couldn't open billing portal.", redirect: `${appUrl()}/mira/account` },
      { status: 502 },
    );
  }
}
