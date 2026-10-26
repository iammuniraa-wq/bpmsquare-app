import { NextResponse, type NextRequest } from "next/server";
import { tenantHasFeature } from "@/lib/tenant";
import { bundles } from "@/lib/tender/boq/server";
import { applyLinks, buildEstimatesState, openEstimatesRequest, previewOutputs } from "@/lib/tender/estimates/server";

// Estimates that price the BOQ (GCC tender deals, slice 3c-1, migration 0227). Every route in this folder opens through
// openEstimatesRequest(): flags gcc_tender + pipeline, the Pipeline view (edit to write), a tender deal of THIS workspace, the estimator
// module and the Estimates view. Anything else is the same 404 and no table is read. A request never carries a cost.
//
// GET  ?estimate=<id>&boq=<id>    the estimate's outputs with the cost per unit each gives that BOQ line
// GET                              the deal's estimates and links (the Prices tab's state)
// POST { items: [{ boq_id, estimate_id, output, basis, share_pct }], markup_pct? }   link and price (all or nothing)

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openEstimatesRequest(id, "view");
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const r = gate.req;
  const estimate = req.nextUrl.searchParams.get("estimate");
  if (estimate) {
    const boqId = req.nextUrl.searchParams.get("boq");
    const b = await bundles(r, boqId ?? undefined);
    const item = b?.items[0];
    if (!item) return NextResponse.json({ error: "Line not found" }, { status: 404 });
    const out = await previewOutputs(r, estimate, Number(item.line.qty));
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
    return NextResponse.json({ estimate: out.estimate, outputs: out.outputs, boq: { id: item.boq.id, qty: Number(item.line.qty), uom: item.boq.file_uom ?? item.line.uom ?? null } });
  }
  const [state, rfqOn] = await Promise.all([buildEstimatesState(r), tenantHasFeature(r.admin, r.tenantId, "rfq")]);
  return NextResponse.json({ ...state, rfq_enabled: rfqOn });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openEstimatesRequest(id, "write");
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const body = (await req.json().catch(() => null)) as { items?: unknown; markup_pct?: unknown } | null;
  if (!body || !Array.isArray(body.items)) return NextResponse.json({ error: "items are required" }, { status: 422 });
  const out = await applyLinks(gate.req, body.items, { markup: body.markup_pct });
  if (!out.ok) return NextResponse.json({ error: out.error, ...(out.extra ?? {}) }, { status: out.status });
  return NextResponse.json({ ok: true, linked: out.linked, repriced: out.repriced, failed: out.failed });
}
