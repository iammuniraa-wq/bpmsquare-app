import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { generateNextStandardQuoteRef } from "@/lib/standardQuoteRef";
import { diffForLog, logChange } from "@/lib/changeLog";
import { computeStandardQuoteTotals } from "@/lib/standardQuoteTotals";
import { derivePricingFlags, withPricingColumns, insertLinesTolerant, resolveLineIdsAndSelection, writeHeaderTolerant } from "@/lib/pricing/quoteLineFlags";
import { emitQuoteCreated } from "@/lib/events/emitters";

export const runtime = "nodejs";

// POST /api/standard-quotes/[id]/copy -- "Copy to a new quotation": a NEW record with a NEW number, made from this one
// (source_type = standard_quote). Revise is the same offer changed (same record, next revision); copy is another offer. The copy
// starts as a draft with no revision history and no deal link; the original is never touched. Works with or without revisions.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId, userId;
  try {
    ({ supabase, tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "standard_quotes"))) {
    return NextResponse.json({ error: "Standard Quotes isn't enabled for your workspace" }, { status: 403 });
  }

  const { id } = await params;
  const { data: src } = await supabase.from("standard_quotes").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!src) return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  const { data: srcLines } = await supabase.from("standard_quote_lines").select("*").eq("standard_quote_id", id).eq("tenant_id", tenantId).order("sl_no");

  // The source's own line ids are only used to carry quantity-break links across (break_of); every copied line gets a new id.
  const rows = ((srcLines ?? []) as Record<string, unknown>[]).map((l) => ({
    local_id: String(l.id), tenant_id: tenantId, sl_no: (l.sl_no as string | null) ?? undefined, description: String(l.description ?? ""), uom: (l.uom as string | null) ?? null,
    qty: Number(l.qty) || 0, rate: Number(l.rate) || 0, discount_pct: Number(l.discount_pct) || 0, amount: Number(l.amount) || 0,
    product_id: (l.product_id as string | null) ?? null, pricing_document_id: (l.pricing_document_id as string | null) ?? null,
    group_id: (l.group_id as string | null) ?? null, group_label: (l.group_label as string | null) ?? null, group_type: (l.group_type as string | null) ?? null,
    break_of: (l.break_of as string | null) ?? null, break_qty: (l.break_qty as number | null) ?? null,
    is_selected: l.is_selected !== false, show_on_pdf: l.show_on_pdf !== false, rfq_line_id: (l.rfq_line_id as string | null) ?? null,
  }));
  const cleanLines = resolveLineIdsAndSelection(rows);
  const subtotal = cleanLines.filter((l) => l.is_selected && !l.break_of).reduce((s, l) => s + l.amount, 0);
  const totals = computeStandardQuoteTotals(subtotal, Number(src.header_discount_pct) || 0, Number(src.tax_pct) || 0, Number(src.shipping_amount) || 0);

  const baseInsert = {
    tenant_id: tenantId, account_id: src.account_id, contact_id: src.contact_id, status: "draft", valid_until: null, inquiry_date: null,
    terms: src.terms, notes: src.notes, intro_text: src.intro_text, header_discount_pct: src.header_discount_pct, tax_pct: src.tax_pct, shipping_amount: src.shipping_amount,
    subtotal, total: totals.total, created_by: userId, template_id: src.template_id, opportunity_id: null, print_options: src.print_options ?? null,
    ...(src.custom_data ? { custom_data: src.custom_data } : {}),
    // Framed-document fields and where it was made from (0251); a database without 0251 drops the columns (writeHeaderTolerant).
    project_title: src.project_title ?? null, subject: src.subject ?? null, entity_id: src.entity_id ?? null, doc_sections: src.doc_sections ?? null,
    source_type: "standard_quote", source_id: src.id,
  };

  let created: { id: string; ref: string } | null = null;
  let qErr: { message: string; code?: string } | null = null;
  for (let attempt = 0; attempt < 3 && !created; attempt++) {
    const ref = await generateNextStandardQuoteRef(supabase, tenantId);
    const result = await writeHeaderTolerant({ ...baseInsert, ref }, async (row) => await supabase.from("standard_quotes").insert(row).select("id, ref").single());
    if (!result.error) created = result.data as { id: string; ref: string };
    else if (result.error.code === "23505") { qErr = result.error; continue; }
    else { qErr = result.error; break; }
  }
  if (!created) return NextResponse.json({ error: qErr?.message ?? "Failed to copy the quotation" }, { status: 500 });

  if (cleanLines.length > 0) {
    const lineRows = cleanLines.map((l) => ({ ...l, standard_quote_id: created!.id }));
    const derived = await derivePricingFlags(supabase, tenantId, lineRows);
    const { error: linesErr } = await insertLinesTolerant(supabase, "standard_quote_lines", derived.ok ? withPricingColumns(lineRows, derived.flagsByDocument) : lineRows);
    if (linesErr) return NextResponse.json({ error: linesErr.message }, { status: 500 });
  }

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "standard_quotes", objectId: created.id, objectLabel: created.ref, action: "create", actorId: user?.id, actorEmail: user?.email,
    changes: [...diffForLog("standard_quotes", {}, { account_id: src.account_id, total: subtotal }), { field: "Copied from", from: null, to: src.ref }],
  });
  await emitQuoteCreated(tenantId, { quoteId: created.id, objectType: "standard_quote", ref: created.ref, total: totals.total, accountId: src.account_id as string, actorId: user?.id });
  return NextResponse.json({ id: created.id, ref: created.ref }, { status: 201 });
}
