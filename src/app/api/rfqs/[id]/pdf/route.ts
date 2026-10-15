import { NextResponse, type NextRequest } from "next/server";
import { rfqAccess, errorResponse, loadRfqBundle, renderRfqPdf } from "@/lib/rfq/server";
import { getTenant } from "@/lib/tenant";

// GET -- the printable RFQ exactly as suppliers receive it (no customer, no
// prices, no supplier names), for the buyer to preview or print.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { admin, tenantId } = await rfqAccess(false);
    const { id } = await params;
    const tenant = await getTenant();
    if (!tenant || tenant.id !== tenantId) return NextResponse.json({ error: "Workspace not resolved" }, { status: 400 });
    const b = await loadRfqBundle(admin, tenantId, id, { messages: false });
    if (!b) return NextResponse.json({ error: "RFQ not found" }, { status: 404 });
    const pdf = await renderRfqPdf(admin, tenant, b);
    if (!pdf) return NextResponse.json({ error: "The PDF couldn't be produced right now." }, { status: 502 });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${(b.rfq.ref ?? "RFQ").replace(/[^A-Za-z0-9-]/g, "")}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
