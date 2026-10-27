import { NextResponse, type NextRequest } from "next/server";
import { awardAndPrice, openCostingRequest, type AwardBody } from "@/lib/tender/costing/server";

// POST { rfq_id, line_id, response_id, fx_rate?, reason?, replace?, markup_pct? }   "Award and price" one line
// POST { rfq_id, rfq_supplier_id, all: true, ... }                                    every line that supplier quoted
// POST { rfq_id, apply_only: true, line_id? }                                          write awards that already stand onto their BOQ rows
// The one place a tender RFQ is awarded. It records the decision exactly as the RFQ's own award does (who, when, and why when the price is
// not the lowest valid one: 422 reason_required; 409 already_awarded / on_purchase_order; 503 while migration 0224 is pending), then stores
// the supplier's price as the row's COST, adds the markup (the one typed on the screen, else the row's, else the workspace default 15), sets
// the price source to "RFQ-0012, awarded" and keeps the date the supplier gave the price. Cost and markup are never exported.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openCostingRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const body = (await req.json().catch(() => ({}))) as AwardBody;
  try {
    const out = await awardAndPrice(gate.req, body);
    if (!out.ok) return NextResponse.json({ error: out.error, ...(out.extra ?? {}) }, { status: out.status });
    const first = out.results[0];
    return NextResponse.json({ ...out, ...(out.results.length === 1 && first ? { status: first.status, unit_cost: first.unit_cost, not_lowest: first.not_lowest, warning: first.warning } : {}) });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Could not award" }, { status: err.status ?? 500 });
  }
}
