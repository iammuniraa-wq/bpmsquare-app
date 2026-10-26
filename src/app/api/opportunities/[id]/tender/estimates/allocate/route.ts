import { NextResponse, type NextRequest } from "next/server";
import { openEstimatesRequest, proposeAllocationFor } from "@/lib/tender/estimates/server";

// "Allocate to BOQ" (migration 0227), the proposal half. GET ?estimate=<id>&mode=match|spread&by=amount|quantity&output=<key>
// answers the rows the panel shows. Nothing is written: the person ticks rows and the panel sends them to POST ../estimates, which
// checks every id and cost again and writes in one step.

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openEstimatesRequest(id, "view");
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const sp = req.nextUrl.searchParams;
  const estimate = sp.get("estimate");
  if (!estimate) return NextResponse.json({ error: "Choose an estimate" }, { status: 422 });
  const out = await proposeAllocationFor(gate.req, estimate, {
    mode: sp.get("mode") === "spread" ? "spread" : "match", by: sp.get("by") === "quantity" ? "quantity" : "amount", output: sp.get("output"),
  });
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ estimate: out.estimate, outputs: out.outputs, rows: out.rows, existing: out.existing });
}
