import { NextResponse, type NextRequest } from "next/server";
import { logChange } from "@/lib/changeLog";
import { tenantHasFeature } from "@/lib/tenant";
import { resolvePermissions, canCreateWorkcenter } from "@/lib/permissions";
import { isUuid } from "@/lib/estimator/requests";
import { estimatorAccess, errorResponse, pendingResponse, loadEstimate, assembleEstimateQuote, EstimateQuoteError } from "@/lib/estimator/server";

// POST /api/estimates/[id]/quote
// Creates the Standard Quote for an estimate: one customer-facing line per group
// (or per line, per the template), priced at cost + margin, the tenant's tax on the
// header, finish-level alternatives when the template flags a select input for them.
// No unit cost or margin is ever written to the quote.
//   201 { quoteId, ref, subtotal, tax_pct, total, lines, alternatives, notes }
//   409 { error, quoteId } when the estimate already has a quote
//   422 { error } when a product line is unresolved or unpriced
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, tenantId, userId, email, role } = await estimatorAccess("edit");
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });

    if (!(await tenantHasFeature(supabase, tenantId, "standard_quotes"))) {
      return NextResponse.json({ error: "Standard Quotes isn't enabled for your workspace, so this estimate has nowhere to become a quote." }, { status: 409 });
    }
    const perms = await resolvePermissions(supabase, tenantId, userId, role);
    if (!canCreateWorkcenter(perms, "standard_quotes")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const before = await loadEstimate(supabase, tenantId, id);
    if (before.missing) return pendingResponse();
    if (!before.data) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
    if (before.data.standard_quote_id) {
      return NextResponse.json({ error: "This estimate already has a quote.", quoteId: before.data.standard_quote_id }, { status: 409 });
    }

    try {
      const result = await assembleEstimateQuote(tenantId, id, { userId });
      const label = before.data.ref ?? before.data.name;
      await logChange(supabase, {
        tenantId, objectType: "estimates", objectId: id, objectLabel: label, action: "update", actorId: userId, actorEmail: email,
        changes: [{ field: "status", from: before.data.status, to: "quoted" }, { field: "standard_quote_id", from: null, to: result.ref }],
      });
      await logChange(supabase, {
        tenantId, objectType: "standard_quotes", objectId: result.quoteId, objectLabel: result.ref, action: "create", actorId: userId, actorEmail: email,
        changes: [{ field: "created from estimate", from: null, to: label }],
      });
      return NextResponse.json(result, { status: 201 });
    } catch (e) {
      if (e instanceof EstimateQuoteError) {
        return NextResponse.json({ error: e.message, ...(e.quoteId ? { quoteId: e.quoteId } : {}) }, { status: e.status });
      }
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
