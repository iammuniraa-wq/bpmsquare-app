import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { getTenant, tenantHasFeature } from "@/lib/tenant";
import { logChange, diffForLog } from "@/lib/changeLog";
import { generateNextStandardQuoteRef } from "@/lib/standardQuoteRef";
import { computeStandardQuoteTotals } from "@/lib/standardQuoteTotals";
import { derivePricingFlags, withPricingColumns, insertLinesTolerant, resolveLineIdsAndSelection, writeHeaderTolerant } from "@/lib/pricing/quoteLineFlags";
import { priceDocumentLine } from "@/lib/pricing/quoteLine";
import { PricingConfigError } from "@/lib/pricing/server";
import { opportunityStages, stageDef, initialStage } from "@/lib/sales/opportunity";
import { loadOpportunity, loadOpportunityLines, refreshOpportunityDerived } from "@/lib/sales/opportunityServer";
import type { PricingConfig } from "@/lib/constants";

// Convert a deal into a quote (§4.3): a Standard Quote linked to the deal,
// its lines copied and -- where the engine is on and the line names a
// product -- RE-PRICED on the quote date. Lines the engine can't price
// (needs an RFQ, config error) copy as-is with their deal rate. The deal
// moves to Propose if it was still at its initial stage.
//
// Quotations (the design partner's object) are not a conversion target
// yet: decision 2 keeps that object's flow untouched until asked.

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId, userId;
  try {
    ({ supabase, tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "pipeline")) || !(await tenantHasFeature(supabase, tenantId, "standard_quotes"))) {
    return NextResponse.json({ error: "Pipeline and Standard Quotes must both be enabled" }, { status: 403 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const to = body?.to === "quotation" ? "quotation" : "standard_quote";
  if (to === "quotation") return NextResponse.json({ error: "Converting to a Quotation is not available yet — convert to a Standard Quote" }, { status: 422 });

  const admin = createAdminSupabase();
  const opp = await loadOpportunity(admin, tenantId, id);
  if (!opp) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const lines = await loadOpportunityLines(admin, tenantId, id);
  const tenant = await getTenant();
  const pricingOn = Boolean(tenant?.features?.pricing_engine && tenant?.features?.pricing_engine_quotes);
  const pricingConfig = (tenant?.config?.pricing as PricingConfig | undefined) ?? null;

  let templateId: string | null = null;
  if (body?.template_id) {
    const { data: tmpl } = await admin.from("standard_quote_templates").select("id").eq("id", body.template_id).eq("tenant_id", tenantId).maybeSingle();
    if (!tmpl) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    templateId = tmpl.id;
  } else {
    const { data: defaultTmpl } = await admin.from("standard_quote_templates").select("id").eq("tenant_id", tenantId).eq("is_default", true).maybeSingle();
    templateId = defaultTmpl?.id ?? null;
  }

  // Re-price product lines on the quote date; keep the deal's rate otherwise.
  let repriced = 0;
  let firstTaxPct: number | null = null;
  const priced = await Promise.all(lines.map(async (l) => {
    if (!pricingOn || !l.product_id) return { line: l, rate: l.rate, pricing_document_id: null as string | null };
    try {
      const outcome = await priceDocumentLine(tenantId, { productId: l.product_id, accountId: opp.account_id, quantity: l.qty, documentType: "standard_quote", sourceId: null, actorId: userId, pricingConfig });
      if (!outcome.ok) return { line: l, rate: l.rate, pricing_document_id: null };
      repriced++;
      if (firstTaxPct === null && outcome.tax_pct > 0) firstTaxPct = outcome.tax_pct;
      return { line: l, rate: Math.round(outcome.unit_rate * 100) / 100, pricing_document_id: outcome.document_id ?? null };
    } catch (e) {
      if (!(e instanceof PricingConfigError)) console.error("convert: re-price failed", e);
      return { line: l, rate: l.rate, pricing_document_id: null };
    }
  }));

  const rows = priced.map((p, i) => ({
    local_id: p.line.id, tenant_id: tenantId, sl_no: String(i + 1), description: p.line.description, uom: p.line.uom,
    qty: p.line.qty, rate: p.rate, discount_pct: p.line.discount_pct, amount: p.line.qty * p.rate * (1 - p.line.discount_pct / 100),
    product_id: p.line.product_id ?? null, pricing_document_id: p.pricing_document_id,
    group_id: p.line.group_id ?? null, group_label: p.line.group_label ?? null, group_type: p.line.group_type ?? null,
    break_of: p.line.break_of ?? null, break_qty: p.line.break_qty ?? null, is_selected: p.line.is_selected !== false, show_on_pdf: p.line.show_on_pdf !== false,
  }));
  const cleanLines = resolveLineIdsAndSelection(rows);
  const subtotal = cleanLines.filter((l) => l.is_selected && !l.break_of).reduce((s, l) => s + l.amount, 0);
  const taxPct = firstTaxPct ?? 0;
  const totals = computeStandardQuoteTotals(subtotal, 0, taxPct, 0);

  const baseInsert = {
    tenant_id: tenantId, account_id: opp.account_id, contact_id: opp.contact_id, status: "draft",
    valid_until: null, inquiry_date: null, terms: null, notes: null, intro_text: null,
    header_discount_pct: 0, tax_pct: taxPct, shipping_amount: 0, subtotal, total: totals.total,
    created_by: userId, template_id: templateId, opportunity_id: id,
  };
  let quote: { id: string; ref: string } | null = null;
  let qErr: { message: string; code?: string } | null = null;
  for (let attempt = 0; attempt < 3 && !quote; attempt++) {
    const ref = await generateNextStandardQuoteRef(admin, tenantId);
    const result = await writeHeaderTolerant({ ...baseInsert, ref }, async (row) => await admin.from("standard_quotes").insert(row).select("id, ref").single());
    if (!result.error) quote = result.data as { id: string; ref: string };
    else if (result.error.code === "23505") { qErr = result.error; continue; }
    else { qErr = result.error; break; }
  }
  if (!quote) return NextResponse.json({ error: qErr?.message ?? "Failed to create the quote" }, { status: 500 });

  if (cleanLines.length > 0) {
    const withParent = cleanLines.map((l) => ({ ...l, standard_quote_id: quote!.id }));
    const derived = await derivePricingFlags(admin, tenantId, withParent);
    const { error: linesErr } = await insertLinesTolerant(admin, "standard_quote_lines", derived.ok ? withPricingColumns(withParent, derived.flagsByDocument) : withParent);
    if (linesErr) return NextResponse.json({ error: linesErr.message }, { status: 500 });
  }

  // Stage: an initial-stage deal that now has a quote is being proposed.
  const stages = opportunityStages(tenant?.config);
  const oppPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (opp.stage === initialStage(stages).value && stageDef(stages, "propose") && !stageDef(stages, opp.stage)?.is_closed) oppPatch.stage = "propose";
  await admin.from("opportunities").update(oppPatch).eq("id", id).eq("tenant_id", tenantId);
  await refreshOpportunityDerived(admin, tenantId, id, stages);

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "opportunities", objectId: id, objectLabel: `${opp.ref ?? ""} ${opp.title}`.trim(),
    action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: "Converted to quote", from: null, to: `${quote.ref} (${cleanLines.length} lines, ${repriced} re-priced)` }, ...(oppPatch.stage ? diffForLog("opportunities", { stage: opp.stage }, { stage: oppPatch.stage }) : [])],
  });
  await logChange(supabase, {
    tenantId, objectType: "standard_quotes", objectId: quote.id, objectLabel: quote.ref,
    action: "create", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: "Created from deal", from: null, to: `${opp.ref ?? ""} ${opp.title}`.trim() }],
  });
  return NextResponse.json({ id: quote.id, ref: quote.ref, lines: cleanLines.length, repriced }, { status: 201 });
}
