import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { getTenant, tenantHasFeature } from "@/lib/tenant";
import { logChange, diffLineItems, type LineSnapshot } from "@/lib/changeLog";
import { derivePricingFlags, withPricingColumns, insertLinesTolerant, verifiedProductIds, resolveLineIdsAndSelection } from "@/lib/pricing/quoteLineFlags";
import { opportunityStages } from "@/lib/sales/opportunity";
import { loadOpportunity, loadOpportunityLines, refreshOpportunityDerived } from "@/lib/sales/opportunityServer";

// PUT: replace a deal's lines (§4.3) -- the same shape and the same
// guards as the Standard Quote line save: products verified against the
// tenant, selection resolved server-side, pricing flags derived from the
// verified document, tolerant insert. Recomputes the deal's amount.

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "pipeline"))) {
    return NextResponse.json({ error: "Pipeline isn't enabled for your workspace" }, { status: 403 });
  }
  const { id } = await params;
  const admin = createAdminSupabase();
  const opp = await loadOpportunity(admin, tenantId, id);
  if (!opp) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  type RawLine = {
    local_id?: string; sl_no?: string; description?: string; uom?: string; qty?: string; rate?: string; discount_pct?: string;
    product_id?: string | null; pricing_document_id?: string | null;
    group_id?: string | null; group_label?: string | null; group_type?: string | null;
    break_of?: string | null; break_qty?: number | null; is_selected?: boolean; show_on_pdf?: boolean;
  };
  const raw: RawLine[] = Array.isArray(body.lines) ? body.lines.filter((l: RawLine) => l?.description?.trim()).slice(0, 200) : [];
  const knownProducts = await verifiedProductIds(admin, tenantId, raw);
  const withAmounts = raw.map((l, i) => {
    const qty = Math.max(0, parseFloat(l.qty ?? "") || 1);
    const rate = Math.max(0, parseFloat(l.rate ?? "") || 0);
    const discountPct = Math.max(0, Math.min(100, parseFloat(l.discount_pct ?? "") || 0));
    return {
      local_id: typeof l.local_id === "string" && l.local_id ? l.local_id : undefined,
      tenant_id: tenantId, opportunity_id: id, sl_no: l.sl_no || String(i + 1),
      description: String(l.description), uom: l.uom || null, qty, rate, discount_pct: discountPct,
      amount: qty * rate * (1 - discountPct / 100),
      product_id: l.product_id && knownProducts.has(l.product_id) ? l.product_id : null,
      pricing_document_id: typeof l.pricing_document_id === "string" && l.pricing_document_id ? l.pricing_document_id : null,
      group_id: typeof l.group_id === "string" && l.group_id ? l.group_id : null,
      group_label: typeof l.group_label === "string" && l.group_label ? l.group_label : null,
      group_type: l.group_type === "alternative" ? "alternative" : null,
      break_of: typeof l.break_of === "string" && l.break_of ? l.break_of : null,
      break_qty: typeof l.break_qty === "number" && Number.isFinite(l.break_qty) ? l.break_qty : null,
      is_selected: l.is_selected !== false,
      show_on_pdf: l.show_on_pdf !== false,
    };
  });
  const cleanLines = resolveLineIdsAndSelection(withAmounts);
  const beforeLines = await loadOpportunityLines(admin, tenantId, id);

  const { error: dErr } = await admin.from("opportunity_lines").delete().eq("opportunity_id", id).eq("tenant_id", tenantId);
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });
  if (cleanLines.length > 0) {
    const derived = await derivePricingFlags(admin, tenantId, cleanLines);
    const { error: iErr } = await insertLinesTolerant(admin, "opportunity_lines", derived.ok ? withPricingColumns(cleanLines, derived.flagsByDocument) : cleanLines);
    if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });
  }

  const tenant = await getTenant();
  const derivedHeader = await refreshOpportunityDerived(admin, tenantId, id, opportunityStages(tenant?.config));

  const changes = diffLineItems(
    beforeLines.map((l): LineSnapshot => ({ label: l.description, qty: l.qty, rate: l.rate, amount: l.amount })),
    cleanLines.map((l): LineSnapshot => ({ label: l.description, qty: l.qty, rate: l.rate, amount: l.amount }))
  );
  if (changes.length > 0) {
    const user = await getAuthUser();
    await logChange(supabase, {
      tenantId, objectType: "opportunities", objectId: id, objectLabel: `${opp.ref ?? ""} ${opp.title}`.trim(),
      action: "update", actorId: user?.id, actorEmail: user?.email, changes,
    });
  }
  return NextResponse.json({ ok: true, lines: await loadOpportunityLines(admin, tenantId, id), amount: derivedHeader?.amount ?? 0, probability: derivedHeader?.probability ?? 0 });
}
