import { NextResponse, type NextRequest } from "next/server";
import { logChange } from "@/lib/changeLog";
import { groupSlug } from "@/lib/estimator/types";
import { parseManualLine, isUuid } from "@/lib/estimator/requests";
import { lineCost } from "@/lib/estimator/overrides";
import {
  estimatorAccess, errorResponse, pendingResponse, loadEstimate, verifyForeignIds, priceProductRules,
  nextSortOrder, refreshTotals, isMissingRelation,
} from "@/lib/estimator/server";

// POST /api/estimates/[id]/lines  { description, group?, qty?, uom?, unit_cost?, waste_pct?, component?, product_id?, wbs_code? }
// Adds a manual line (source = "manual"): it survives every recalculation. With a
// product and no unit cost, the cost comes from the pricing engine / product cost.
// Returns { line, lines, totals }. An estimate that already has a quote is locked (409).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, tenantId, userId, email } = await estimatorAccess("edit");
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
    const est = await loadEstimate(supabase, tenantId, id);
    if (est.missing) return pendingResponse();
    if (!est.data) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
    if (est.data.standard_quote_id) return NextResponse.json({ error: "This estimate already has a quote, so its lines can no longer change." }, { status: 409 });

    const parsed = parseManualLine(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
    const v = parsed.value;

    const bad = await verifyForeignIds(supabase, tenantId, { product_id: v.product_id });
    if (bad) return NextResponse.json({ error: bad }, { status: 404 });

    let unitCost = v.unit_cost;
    let sku: string | null = null;
    if (v.product_id) {
      const { data: product } = await supabase.from("products").select("id, sku, uom").eq("id", v.product_id).eq("tenant_id", tenantId).maybeSingle();
      sku = (product as { sku: string | null } | null)?.sku ?? null;
      if (unitCost === null && sku) {
        const priced = await priceProductRules(supabase, tenantId, { estimateId: id, accountId: est.data.account_id, needs: [{ code: "manual", sku, qty: v.qty }] });
        if (priced.unit_costs.manual !== undefined) unitCost = Math.round(priced.unit_costs.manual * 10000) / 10000;
      }
    }

    const sortOrder = await nextSortOrder(supabase, tenantId, id);
    const { data: line, error } = await supabase.from("estimate_lines").insert({
      tenant_id: tenantId, estimate_id: id, sort_order: sortOrder, code: null,
      group_key: groupSlug(v.group), description: v.description, uom: v.uom, qty: v.qty, waste_pct: v.waste_pct,
      unit_cost: unitCost, cost_total: lineCost(v.qty, v.waste_pct, unitCost), component: v.component,
      product_id: v.product_id, source: "manual", element_ref: null, wbs_code: v.wbs_code,
      custom_data: { group: v.group, ...(sku ? { sku } : {}) },
    }).select("*").single();
    if (error || !line) {
      if (isMissingRelation(error)) return pendingResponse();
      return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
    }

    const r = await refreshTotals(supabase, tenantId, est.data);
    await logChange(supabase, {
      tenantId, objectType: "estimates", objectId: id, objectLabel: est.data.ref ?? est.data.name, action: "update",
      actorId: userId, actorEmail: email, changes: [{ field: "Line added", from: null, to: `${v.description}: ${v.qty} ${v.uom ?? ""}`.trim() }],
    });
    return NextResponse.json({ line, lines: r.lines, totals: r.totals }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
