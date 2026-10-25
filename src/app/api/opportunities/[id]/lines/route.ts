import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { getTenant, tenantHasFeature } from "@/lib/tenant";
import { logChange, diffLineItems, type LineSnapshot } from "@/lib/changeLog";
import { derivePricingFlags, withPricingColumns, insertLinesTolerant, verifiedProductIds, verifiedRfqLineIds, resolveLineIdsAndSelection } from "@/lib/pricing/quoteLineFlags";
import { opportunityStages } from "@/lib/sales/opportunity";
import { loadOpportunity, loadOpportunityLines, refreshOpportunityDerived } from "@/lib/sales/opportunityServer";
import { linesVersion } from "@/lib/sales/dealLines";
import { boqOrderedLines, dealHasBoq, restoreBoqLinks, snapshotBoqLinks } from "@/lib/tender/boq/lineSync";

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
    rfq_line_id?: string | null;
  };
  const raw: RawLine[] = Array.isArray(body.lines) ? body.lines.filter((l: RawLine) => l?.description?.trim()).slice(0, 200) : [];
  const knownProducts = await verifiedProductIds(admin, tenantId, raw);
  const knownRfqLines = await verifiedRfqLineIds(admin, tenantId, raw);
  const beforeLines = await loadOpportunityLines(admin, tenantId, id);
  // This editor keeps at most 200 lines. A deal that already has more (a tender BOQ) must not be saved here, or the rest would be deleted.
  if (beforeLines.length > 200) return NextResponse.json({ error: `This deal has ${beforeLines.length} lines, more than this editor can save (200). Change them on the BOQ tab.` }, { status: 409 });

  // A deal with an uploaded BOQ has a second writer (the BOQ tab). An editor that sends the version of the lines it loaded is refused
  // when those lines are no longer the saved ones, so a stale copy can never overwrite or delete what the BOQ wrote. A caller that sends
  // no version (the RFQ price apply, the API) and every deal without a BOQ are unchanged.
  const baseVersion = typeof body.base_version === "string" && body.base_version ? body.base_version : null;
  const hasBoq = await dealHasBoq(admin, tenantId, id);
  if (hasBoq && baseVersion && baseVersion !== linesVersion(beforeLines)) {
    return NextResponse.json({ error: "The lines of this deal changed (the BOQ was updated) since you opened them. Reload the lines, then make your edit again.", code: "lines_changed" }, { status: 409 });
  }
  const itemNoOf = new Map(beforeLines.map((l) => [l.id, l.sl_no]));
  const withAmounts = raw.map((l, i) => {
    const qty = Math.max(0, parseFloat(l.qty ?? "") || 1);
    const rate = Math.max(0, parseFloat(l.rate ?? "") || 0);
    const discountPct = Math.max(0, Math.min(100, parseFloat(l.discount_pct ?? "") || 0));
    return {
      local_id: typeof l.local_id === "string" && l.local_id ? l.local_id : undefined,
      tenant_id: tenantId, opportunity_id: id, sl_no: l.sl_no || (hasBoq && l.local_id ? itemNoOf.get(l.local_id) : null) || String(i + 1),
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
      rfq_line_id: l.rfq_line_id && knownRfqLines.has(l.rfq_line_id) ? l.rfq_line_id : null,
    };
  });
  const cleanLines = resolveLineIdsAndSelection(withAmounts);
  // The delete below clears each BOQ row's link to its line; read the links first so they can be pointed at the new lines.
  const boqLinks = hasBoq ? await snapshotBoqLinks(admin, tenantId, id) : new Map<string, string>();

  const { error: dErr } = await admin.from("opportunity_lines").delete().eq("opportunity_id", id).eq("tenant_id", tenantId);
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });
  if (cleanLines.length > 0) {
    const derived = await derivePricingFlags(admin, tenantId, cleanLines);
    const { error: iErr } = await insertLinesTolerant(admin, "opportunity_lines", derived.ok ? withPricingColumns(cleanLines, derived.flagsByDocument) : cleanLines);
    if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });
  }
  if (boqLinks.size > 0) {
    const moves = withAmounts.flatMap((l, i) => (l.local_id && boqLinks.has(l.local_id) ? [{ boqRowId: boqLinks.get(l.local_id)!, lineId: cleanLines[i].id }] : []));
    await restoreBoqLinks(admin, tenantId, id, moves);
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
  const saved = await loadOpportunityLines(admin, tenantId, id);
  return NextResponse.json({
    ok: true, lines: hasBoq ? await boqOrderedLines(admin, tenantId, id, saved) : saved, version: linesVersion(saved),
    amount: derivedHeader?.amount ?? 0, probability: derivedHeader?.probability ?? 0,
  });
}
