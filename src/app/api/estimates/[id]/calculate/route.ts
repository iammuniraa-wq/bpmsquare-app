import { NextResponse, type NextRequest } from "next/server";
import { logChange } from "@/lib/changeLog";
import { isUuid } from "@/lib/estimator/requests";
import { estimatorAccess, errorResponse, pendingResponse, loadEstimate, recomputeEstimate } from "@/lib/estimator/server";

// POST /api/estimates/[id]/calculate  { reprice?: boolean }
// Recalculates the estimate from its template and current prices: computed lines
// are replaced, manual lines and hand edits are kept. Returns the new lines and
// totals. An estimate that already has a quote cannot be recalculated (409).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await estimatorAccess("edit");
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
    const before = await loadEstimate(ctx.supabase, ctx.tenantId, id);
    if (before.missing) return pendingResponse();
    if (!before.data) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
    if (before.data.standard_quote_id) {
      return NextResponse.json({ error: "This estimate already has a quote, so it can no longer be recalculated. Create a new estimate to revise it." }, { status: 409 });
    }
    const body = (await req.json().catch(() => ({}))) as { reprice?: unknown };
    const r = await recomputeEstimate(ctx, id, { reprice: body.reprice !== false });
    if (!r.ok) return NextResponse.json({ error: r.error, issues: r.issues }, { status: r.status });
    await logChange(ctx.supabase, {
      tenantId: ctx.tenantId, objectType: "estimates", objectId: id, objectLabel: before.data.ref ?? before.data.name,
      action: "update", actorId: ctx.userId, actorEmail: ctx.email,
      changes: [{ field: "calculation", from: before.data.totals?.price ?? null, to: r.totals.price }],
    });
    return NextResponse.json({ estimate: r.estimate, lines: r.lines, totals: r.totals, warnings: r.totals.warnings ?? [] });
  } catch (e) {
    return errorResponse(e);
  }
}
