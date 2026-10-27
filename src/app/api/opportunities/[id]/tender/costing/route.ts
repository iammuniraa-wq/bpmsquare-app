import { NextResponse } from "next/server";
import { buildCostingState, openCostingRequest } from "@/lib/tender/costing/server";

// The Costing tab of a tender deal (docs/design/gcc-tender-deals.md section 25): the deal's estimates and RFQs in one list, each with the
// BOQ rows it prices, its state, its total and its age, plus the four figures above it. Read only. Creating an estimate is the ordinary
// estimate screen, an RFQ is the ordinary RFQ form, and an award is POST ./award.

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openCostingRequest(id, false);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  return NextResponse.json(await buildCostingState(gate.req));
}
