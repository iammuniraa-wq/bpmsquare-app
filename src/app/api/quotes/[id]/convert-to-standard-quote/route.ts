import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { logChange } from "@/lib/changeLog";
import { generateNextStandardQuoteRef } from "@/lib/standardQuoteRef";
import { computeStandardQuoteTotals, clampPct } from "@/lib/standardQuoteTotals";
import { derivePricingFlags, withPricingColumns, insertLinesTolerant, verifiedProductIds, resolveLineIdsAndSelection, writeHeaderTolerant } from "@/lib/pricing/quoteLineFlags";
import { emitQuoteCreated } from "@/lib/events/emitters";
import { sourceQuotationMarker } from "@/lib/sales/quotationToStandardQuote";

// Quotation -> a new DRAFT Standard Quote: same account and contact, lines copied (with their option groups and
// quantity breaks). The Quotation is not touched. There is no column that links the two, so the source is written
// at the top of the new quote's notes (sourceQuotationMarker) and that same line stops a second click from making
// a second copy while the first one still exists.

type QuoteLineRow = {
  id: string; sl_no?: string | null; description?: string | null; uom?: string | null; qty?: number | null; rate?: number | null;
  discount_pct?: number | null; amount?: number | null; product_id?: string | null; group_id?: string | null; group_label?: string | null;
  group_type?: string | null; break_of?: string | null; break_qty?: number | null; is_selected?: boolean | null;
};

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  const { data: quote } = await supabase.from("quotes").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!quote) return NextResponse.json({ error: "Quotation not found" }, { status: 404 });
  if (quote.superseded_by) {
    return NextResponse.json({ error: "This version has been superseded -- convert the latest version instead." }, { status: 409 });
  }

  const marker = sourceQuotationMarker(quote.ref as string);
  const { data: existing } = await supabase.from("standard_quotes").select("id, ref").eq("tenant_id", tenantId).like("notes", `${marker}%`).limit(1);
  const already = (existing ?? [])[0] as { id: string; ref: string } | undefined;
  if (already) return NextResponse.json({ error: `A standard quote already exists for this quotation: ${already.ref}`, id: already.id, ref: already.ref }, { status: 409 });

  // The account is the quotation's own (tenant-scoped row); the contact is free text on a quotation, so it is
  // checked against this tenant before it is carried over.
  let contactId: string | null = null;
  if (quote.contact_id) {
    const { data: contact } = await supabase.from("contacts").select("id").eq("id", quote.contact_id).eq("tenant_id", tenantId).maybeSingle();
    contactId = contact?.id ?? null;
  }

  const { data: srcLines } = await supabase.from("quote_lines").select("*").eq("quote_id", id).eq("tenant_id", tenantId).order("sl_no");
  const raw = ((srcLines ?? []) as QuoteLineRow[]).filter((l) => l.description?.trim()).slice(0, 200);
  const knownProducts = await verifiedProductIds(supabase, tenantId, raw);
  const withAmounts = raw.map((l, i) => {
    const qty = Math.max(0, Number(l.qty) || 1);
    const rate = Math.max(0, Number(l.rate) || 0);
    const discountPct = Math.max(0, Math.min(100, Number(l.discount_pct) || 0));
    return {
      local_id: l.id,
      tenant_id: tenantId,
      sl_no: l.sl_no || String(i + 1),
      description: String(l.description),
      uom: l.uom || null,
      qty, rate, discount_pct: discountPct,
      amount: Number.isFinite(Number(l.amount)) ? Number(l.amount) : qty * rate * (1 - discountPct / 100),
      product_id: l.product_id && knownProducts.has(l.product_id) ? l.product_id : null,
      pricing_document_id: null as string | null,
      group_id: l.group_id || null,
      group_label: l.group_label || null,
      group_type: l.group_type === "alternative" ? "alternative" : null,
      break_of: l.break_of || null,
      break_qty: typeof l.break_qty === "number" && Number.isFinite(l.break_qty) ? l.break_qty : null,
      is_selected: l.is_selected !== false,
      show_on_pdf: true,
      rfq_line_id: null as string | null,
    };
  });
  const cleanLines = resolveLineIdsAndSelection(withAmounts);
  const subtotal = cleanLines.filter((l) => l.is_selected).reduce((s, l) => s + l.amount, 0);

  // A fixed discount has no place on a Standard Quote (only a percentage), so it is carried as the equivalent percentage.
  const discountPct = quote.discount_type === "fixed"
    ? (subtotal > 0 ? clampPct(Math.round(((Number(quote.discount_fixed) || 0) / subtotal) * 10000) / 100) : 0)
    : clampPct(quote.discount_pct);
  const taxPct = clampPct(quote.gst_rate);
  const totals = computeStandardQuoteTotals(subtotal, discountPct, taxPct, 0);

  const { data: defaultTmpl } = await supabase.from("standard_quote_templates").select("id").eq("tenant_id", tenantId).eq("is_default", true).maybeSingle();

  const notes = [marker, typeof quote.notes === "string" && quote.notes.trim() ? quote.notes.trim() : null].filter(Boolean).join("\n");
  const baseInsert = {
    tenant_id: tenantId,
    account_id: quote.account_id,
    contact_id: contactId,
    status: "draft",
    valid_until: quote.valid_until ?? null,
    inquiry_date: quote.inquiry_date ?? null,
    terms: typeof quote.terms === "string" && quote.terms.trim() ? quote.terms : null,
    notes,
    intro_text: null,
    header_discount_pct: discountPct,
    tax_pct: taxPct,
    shipping_amount: 0,
    subtotal,
    total: totals.total,
    created_by: userId,
    template_id: defaultTmpl?.id ?? null,
    opportunity_id: null,
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
  if (!created) return NextResponse.json({ error: qErr?.message ?? "Failed to create the standard quote" }, { status: 500 });

  if (cleanLines.length > 0) {
    const rows = cleanLines.map((l) => ({ ...l, standard_quote_id: created!.id }));
    const derived = await derivePricingFlags(supabase, tenantId, rows);
    const { error: linesErr } = await insertLinesTolerant(supabase, "standard_quote_lines", derived.ok ? withPricingColumns(rows, derived.flagsByDocument) : rows);
    if (linesErr) return NextResponse.json({ error: linesErr.message }, { status: 500 });
  }

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "standard_quotes", objectId: created.id, objectLabel: created.ref,
    action: "create", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: "Created from quotation", from: null, to: quote.ref }, { field: "total", from: null, to: totals.total }],
  });
  await emitQuoteCreated(tenantId, { quoteId: created.id, objectType: "standard_quote", ref: created.ref, total: totals.total, accountId: quote.account_id, from: quote.ref, actorId: user?.id });

  return NextResponse.json({ id: created.id, ref: created.ref, lines: cleanLines.length }, { status: 201 });
}
