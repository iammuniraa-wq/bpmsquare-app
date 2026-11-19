import { NextResponse } from "next/server";
import { rfqAccess, errorResponse, mailChannelBlocker } from "@/lib/rfq/server";
import { getTenant } from "@/lib/tenant";
import { rfqConfig } from "@/lib/rfq/types";

// GET /api/rfqs/send-check -> { can_send, reason }
// Asked by the RFQ create forms BEFORE "Send", so the button never pretends to send through a mail channel that
// cannot (own mailbox chosen, mailbox not connected). Reads only the caller's own tenant and returns no
// credential, only the sentence the RFQ page shows after a failed send.

export async function GET() {
  try {
    const ctx = await rfqAccess(false);
    const tenant = await getTenant();
    if (!tenant || tenant.id !== ctx.tenantId) return NextResponse.json({ error: "Workspace not resolved" }, { status: 400 });
    const reason = await mailChannelBlocker(ctx.admin, ctx.tenantId, rfqConfig(tenant.config?.rfq));
    return NextResponse.json({ can_send: !reason, reason });
  } catch (e) {
    return errorResponse(e);
  }
}
