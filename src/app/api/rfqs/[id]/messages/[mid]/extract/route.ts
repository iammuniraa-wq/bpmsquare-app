import { NextResponse, type NextRequest } from "next/server";
import { rfqAccess, errorResponse, loadRfqBundle } from "@/lib/rfq/server";
import { extractSupplierReply, RfqExtractError } from "@/lib/rfq/extract";
import { getTenant } from "@/lib/tenant";
import type { RfqAttachment } from "@/lib/rfq/types";

// POST -- read one inbound supplier message (its files and text) with AI and
// return PROPOSED prices for the buyer to check in the Enter-reply form.
// Nothing is saved here; RFQ edit access required (it costs a model call).
export const maxDuration = 120;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; mid: string }> }) {
  try {
    const { admin, tenantId } = await rfqAccess(true);
    const { id, mid } = await params;
    const { data: msg } = await admin.from("rfq_messages").select("id, rfq_supplier_id, direction, body_text, attachments")
      .eq("id", mid).eq("tenant_id", tenantId).eq("rfq_id", id).maybeSingle();
    if (!msg) return NextResponse.json({ error: "Message not found" }, { status: 404 });
    if (msg.direction !== "in" && !((msg.attachments as RfqAttachment[] | null) ?? []).length) {
      return NextResponse.json({ error: "Only a supplier's reply, or a message with a file, can be read." }, { status: 422 });
    }
    const b = await loadRfqBundle(admin, tenantId, id, { messages: false });
    if (!b) return NextResponse.json({ error: "RFQ not found" }, { status: 404 });
    const tenant = await getTenant();
    const result = await extractSupplierReply(admin, {
      tenantId, rfqId: id, lines: b.lines,
      bodyText: (msg.body_text as string | null) ?? null,
      attachments: ((msg.attachments as RfqAttachment[] | null) ?? []).filter((a) => !!a.path),
      tenantCurrency: tenant?.config?.currency ?? "INR",
    });
    return NextResponse.json({ rfq_supplier_id: msg.rfq_supplier_id, ...result });
  } catch (e) {
    if (e instanceof RfqExtractError) return NextResponse.json({ error: e.message }, { status: 422 });
    return errorResponse(e);
  }
}
