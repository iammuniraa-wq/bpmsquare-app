import { NextResponse } from "next/server";
import { tenantHasFeature } from "@/lib/tenant";
import { dealMissingCosts, openEstimatesRequest } from "@/lib/tender/estimates/server";
import { estimateOriginLabel, missingRfqLines } from "@/lib/tender/estimates/rfqLines";

// "Raise RFQ for missing costs" (migration 0227), the list half. GET answers, for each estimate of the deal, the cost lines that have no
// unit cost or one older than the workspace's RFQ price validity (Settings > RFQ, 180 days by default), already shaped as the RFQ form's
// starting lines. The form (any number of suppliers, no minimum) then posts to /api/rfqs with origin_type "estimate".

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openEstimatesRequest(id, "view");
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const r = gate.req;
  const out = await dealMissingCosts(r);
  const rfqOn = await tenantHasFeature(r.admin, r.tenantId, "rfq");
  return NextResponse.json({
    pending: out.pending, valid_days: out.valid_days, rfq_enabled: rfqOn,
    estimates: out.estimates.map((e) => ({
      id: e.estimate.id, ref: e.estimate.ref, name: e.estimate.name, count: e.lines.length,
      origin_label: estimateOriginLabel(e.estimate.ref, r.opp.ref),
      lines: missingRfqLines(e.lines.map((l) => ({ line: l, reason: l.reason, age_days: l.age_days }))),
    })),
  });
}
