import { NextResponse, type NextRequest } from "next/server";
import { validateTemplate } from "@/lib/estimator/template";
import { parsePreviewRequest } from "@/lib/estimator/requests";
import {
  estimatorAccess, errorResponse, pendingResponse, loadTemplate, templateBody, loadTenantMeta, computeAndPrice,
} from "@/lib/estimator/server";

// POST /api/estimates/preview { template_id, params?, margin_pct? }
// The live preview for a template that prices product lines: the same two passes
// as /calculate (quantities, then a unit cost for each product rule), but it
// STORES NOTHING -- no estimate, no lines, no pricing document, no meter row --
// so the working page can call it as the person types. Product lines are priced
// from the catalogue's own cost (the pricing engine stores a document on every
// call, so it is left to the real calculation); the saved estimate uses the
// engine where it has a price. The page applies `unit_costs` with the same
// pure code the server runs, so both sides show the same figures.
//   200 { unit_costs, sources, unresolved, unpriced, warnings, vat_pct, price, price_incl_vat }
//   422 { error, issues } when the inputs do not compute
// Estimator users only (they already see costs on the internal screens).
export async function POST(req: NextRequest) {
  try {
    const { supabase, tenantId } = await estimatorAccess("view");
    const parsed = parsePreviewRequest(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
    const v = parsed.value;

    const tpl = await loadTemplate(supabase, tenantId, v.template_id);
    if (tpl.missing) return pendingResponse();
    if (!tpl.data) return NextResponse.json({ error: "Template not found." }, { status: 404 });
    const valid = validateTemplate(templateBody(tpl.data));
    if (!valid.ok) return NextResponse.json({ error: "This template has problems and cannot be used yet.", issues: valid.issues }, { status: 422 });

    const meta = await loadTenantMeta(tenantId);
    const out = await computeAndPrice(supabase, {
      tenantId, estimateId: null, accountId: null, template: templateBody(tpl.data),
      params: v.params, margin_pct: v.margin_pct, vat_pct: meta.vat_pct, catalogueOnly: true,
    });
    if (!out.ok) return NextResponse.json({ error: out.issues[0]?.message ?? "These inputs do not compute.", issues: out.issues }, { status: 422 });

    return NextResponse.json({
      unit_costs: out.pricing.unit_costs,
      sources: out.pricing.sources,
      unresolved: out.pricing.unresolved,
      unpriced: out.pricing.unpriced,
      warnings: [...out.result.warnings, ...out.pricing.warnings],
      vat_pct: meta.vat_pct,
      price: out.result.summary.price,
      price_incl_vat: out.result.summary.price_incl_vat,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
