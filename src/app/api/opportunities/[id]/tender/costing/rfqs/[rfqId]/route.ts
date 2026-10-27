import { NextResponse } from "next/server";
import { buildCompareView, openCostingRequest } from "@/lib/tender/costing/server";

// The compare-and-award screen of one RFQ of this deal: suppliers side by side per line, the standing awards, and what the screen needs to
// say about validity. An RFQ that is not this deal's (or one of its estimates') is a 404, whichever workspace it is in. No reply link, token
// or email address is returned; the RFQ's own page is where those live.

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; rfqId: string }> }) {
  const { id, rfqId } = await params;
  const gate = await openCostingRequest(id, false);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!gate.req.rfqs) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const view = await buildCompareView(gate.req, rfqId);
    if (!view) return NextResponse.json({ error: "RFQ not found" }, { status: 404 });
    return NextResponse.json(view);
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Could not load the RFQ" }, { status: err.status ?? 500 });
  }
}
