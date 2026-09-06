import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { logChange, diffLineItems, type LineSnapshot } from "@/lib/changeLog";
import { computeStandardQuoteTotals } from "@/lib/standardQuoteTotals";
import { derivePricingFlags, withPricingColumns, insertLinesTolerant, resolveLineIdsAndSelection, writeHeaderTolerant } from "@/lib/pricing/quoteLineFlags";
import { parseSpreadsheetBuffer, isSpreadsheetName } from "@/lib/sales/spreadsheetServer";
import { sheetToLines, lineDedupKey, type SheetLine } from "@/lib/sales/spreadsheetLines";

// "Create line items from this spreadsheet" (0119, §3.7). POST with
// { mode }: "preview" reads the file and reports what would happen;
// "replace" drops the quote's lines for the file's; "append" adds them;
// "skip_duplicates" adds only rows that don't match an existing line
// (same product, else same description). Draft quotes only -- the same
// rule the edit page enforces. Writes go through the same helpers the
// PATCH route uses (verified product ids, server-resolved selection,
// pricing flags re-derived, tolerant insert), so nothing here can write a
// line the form couldn't.

type Mode = "preview" | "replace" | "append" | "skip_duplicates";

type ExistingLine = {
  id: string; sl_no: string | null; description: string; uom: string | null; qty: number; rate: number; discount_pct: number; amount: number;
  product_id: string | null; pricing_document_id: string | null; group_id: string | null; group_label: string | null; group_type: string | null;
  break_of: string | null; break_qty: number | null; is_selected: boolean | null; show_on_pdf: boolean | null;
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; attId: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "standard_quotes"))) {
    return NextResponse.json({ error: "Standard Quotes isn't enabled for your workspace" }, { status: 403 });
  }
  const { id, attId } = await params;
  const body = await request.json().catch(() => ({}));
  const mode: Mode = ["preview", "replace", "append", "skip_duplicates"].includes(body?.mode) ? body.mode : "preview";

  const admin = createAdminSupabase();
  const { data: quote } = await admin.from("standard_quotes").select("id, ref, status, header_discount_pct, tax_pct, shipping_amount")
    .eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!quote) return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  if (quote.status !== "draft") return NextResponse.json({ error: "Only a draft quote's lines can be changed" }, { status: 409 });

  const { data: att } = await admin.from("standard_quote_attachments").select("id, file_name, storage_path")
    .eq("id", attId).eq("standard_quote_id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!att) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  if (!isSpreadsheetName(att.file_name)) return NextResponse.json({ error: "Only an .xlsx or .csv attachment can become line items" }, { status: 400 });

  const { data: blob, error: dlErr } = await admin.storage.from("quote-attachments").download(att.storage_path);
  if (dlErr || !blob) return NextResponse.json({ error: dlErr?.message ?? "Could not read the file" }, { status: 500 });

  let sheetLines: SheetLine[];
  let skippedRows = 0;
  try {
    const sheet = await parseSpreadsheetBuffer(Buffer.from(await blob.arrayBuffer()), att.file_name);
    const read = sheetToLines(sheet);
    if (!read.ok) return NextResponse.json({ error: read.error }, { status: 422 });
    sheetLines = read.lines.slice(0, 200);
    skippedRows = read.skipped;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not read the file" }, { status: 422 });
  }
  if (sheetLines.length === 0) return NextResponse.json({ error: "No rows with a description were found in the file" }, { status: 422 });

  // Product column -> this tenant's products, by ref, SKU or exact name.
  const keys = [...new Set(sheetLines.map((l) => l.product_key?.toLowerCase()).filter((k): k is string => !!k))];
  const productByKey = new Map<string, { id: string; name: string; uom: string | null; list_price: number | null }>();
  if (keys.length > 0) {
    const { data: products } = await admin.from("products").select("id, ref, sku, name, uom, list_price").eq("tenant_id", tenantId).eq("status", "active");
    for (const p of products ?? []) {
      for (const k of [p.ref, p.sku, p.name]) if (k) productByKey.set(String(k).toLowerCase(), { id: p.id, name: p.name, uom: p.uom, list_price: p.list_price });
    }
  }
  const unresolved = new Set<string>();
  const incoming = sheetLines.map((l) => {
    const p = l.product_key ? productByKey.get(l.product_key.toLowerCase()) : undefined;
    if (l.product_key && !p) unresolved.add(l.product_key);
    return {
      description: p && l.description === l.product_key ? p.name : l.description,
      uom: l.uom ?? p?.uom ?? null,
      qty: l.qty,
      rate: l.rate > 0 ? l.rate : (p?.list_price ?? 0),
      discount_pct: l.discount_pct,
      product_id: p?.id ?? null,
    };
  });

  const { data: existingRaw } = await admin.from("standard_quote_lines").select("*").eq("standard_quote_id", id).eq("tenant_id", tenantId).order("sl_no");
  const existing = (existingRaw ?? []) as ExistingLine[];
  const existingKeys = new Set(existing.filter((l) => !l.break_of).map(lineDedupKey));
  const duplicates = incoming.filter((l) => existingKeys.has(lineDedupKey(l))).length;

  if (mode === "preview") {
    return NextResponse.json({
      file_name: att.file_name, rows: incoming.length, skipped_rows: skippedRows, existing_lines: existing.filter((l) => !l.break_of).length,
      duplicates, unresolved_products: [...unresolved].slice(0, 10),
      sample: incoming.slice(0, 5),
    });
  }

  const toAdd = mode === "skip_duplicates" ? incoming.filter((l) => !existingKeys.has(lineDedupKey(l))) : incoming;
  const keep = mode === "replace" ? [] : existing;
  const rows = [
    ...keep.map((l) => ({
      local_id: l.id, tenant_id: tenantId, standard_quote_id: id, sl_no: l.sl_no ?? "", description: l.description, uom: l.uom, qty: l.qty, rate: l.rate,
      discount_pct: l.discount_pct, amount: l.amount, product_id: l.product_id, pricing_document_id: l.pricing_document_id,
      group_id: l.group_id, group_label: l.group_label, group_type: l.group_type, break_of: l.break_of, break_qty: l.break_qty,
      is_selected: l.is_selected !== false, show_on_pdf: l.show_on_pdf !== false,
    })),
    ...toAdd.map((l) => ({
      local_id: undefined as string | undefined, tenant_id: tenantId, standard_quote_id: id, sl_no: "", description: l.description, uom: l.uom, qty: l.qty, rate: l.rate,
      discount_pct: l.discount_pct, amount: l.qty * l.rate * (1 - l.discount_pct / 100), product_id: l.product_id, pricing_document_id: null as string | null,
      group_id: null as string | null, group_label: null as string | null, group_type: null as string | null, break_of: null as string | null, break_qty: null as number | null,
      is_selected: true, show_on_pdf: true,
    })),
  ].map((r, i) => ({ ...r, sl_no: String(i + 1) }));
  const cleanLines = resolveLineIdsAndSelection(rows);

  const { error: dErr } = await admin.from("standard_quote_lines").delete().eq("standard_quote_id", id).eq("tenant_id", tenantId);
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });
  if (cleanLines.length > 0) {
    const derived = await derivePricingFlags(admin, tenantId, cleanLines);
    const { error: iErr } = await insertLinesTolerant(admin, "standard_quote_lines", derived.ok ? withPricingColumns(cleanLines, derived.flagsByDocument) : cleanLines);
    if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });
  }
  const subtotal = cleanLines.filter((l) => l.is_selected && !l.break_of).reduce((s, l) => s + l.amount, 0);
  const total = computeStandardQuoteTotals(subtotal, quote.header_discount_pct, quote.tax_pct, quote.shipping_amount).total;
  const { error: uErr } = await writeHeaderTolerant({ subtotal, total, updated_at: new Date().toISOString() }, async (row) => await admin.from("standard_quotes").update(row).eq("id", id).eq("tenant_id", tenantId));
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  const user = await getAuthUser();
  const changes = diffLineItems(
    existing.map((l): LineSnapshot => ({ label: l.description, qty: l.qty, rate: l.rate, amount: l.amount })),
    cleanLines.map((l): LineSnapshot => ({ label: l.description, qty: l.qty, rate: l.rate, amount: l.amount }))
  );
  await logChange(supabase, {
    tenantId, objectType: "standard_quotes", objectId: id, objectLabel: quote.ref,
    action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: `Lines from ${att.file_name}`, from: null, to: `${mode}: ${toAdd.length} added` }, ...changes],
  });

  return NextResponse.json({ ok: true, added: toAdd.length, skipped_duplicates: incoming.length - toAdd.length, total_lines: cleanLines.length });
}
