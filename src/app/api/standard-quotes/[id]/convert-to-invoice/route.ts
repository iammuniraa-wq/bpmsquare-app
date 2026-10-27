import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { generateNextInvoiceRef } from "@/lib/invoiceRef";
import { diffForLog, logChange } from "@/lib/changeLog";
import { tenantHasFeature } from "@/lib/tenant";
import { isSchemaPending } from "@/lib/marketing/pending";
import { findInvoiceForStandardQuote, buildInvoiceFromQuote, SQ_LINK_KEY } from "@/lib/sales/standardQuoteInvoice";

// Standard Quote -> DRAFT invoice. Mirrors /api/quotes/[id]/convert-to-invoice (the Quotation route): the
// quote must have been won (here: accepted), one live invoice per quote, lines copied, change history written.

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
  if (!(await tenantHasFeature(supabase, tenantId, "invoices"))) {
    return NextResponse.json({ error: "Invoices is not enabled for this tenant" }, { status: 403 });
  }

  const { id } = await params;
  const { data: quote } = await supabase
    .from("standard_quotes")
    .select("*")
    .eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!quote) return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  if (quote.status !== "accepted") {
    return NextResponse.json({ error: "Only an accepted quote can be turned into an invoice" }, { status: 400 });
  }

  const existing = await findInvoiceForStandardQuote(supabase, tenantId, id);
  if (existing) return NextResponse.json({ error: `An invoice already exists for this quote: ${existing.ref}`, id: existing.id, ref: existing.ref }, { status: 409 });

  const { data: quoteLines } = await supabase
    .from("standard_quote_lines")
    .select("*")
    .eq("standard_quote_id", id).eq("tenant_id", tenantId)
    .order("sl_no");
  const built = buildInvoiceFromQuote(quote, quoteLines ?? []);

  const baseInsert = {
    tenant_id: tenantId,
    account_id: quote.account_id,
    contact_id: quote.contact_id ?? null,
    status: "draft",
    total: built.total,
    terms: quote.terms ?? null,
    notes: `Raised from standard quote ${quote.ref}`,
    issued_at: new Date().toISOString(),
    created_by: userId,
  };

  let invoice: { id: string; ref: string } | null = null;
  let invErr: { message: string; code?: string } | null = null;
  // Linked by invoices.standard_quote_id (0209). While that column is missing, the link rides in custom_data.
  let useColumn = true;
  for (let attempt = 0; attempt < 4 && !invoice; attempt++) {
    const ref = await generateNextInvoiceRef(supabase, tenantId);
    const row: Record<string, unknown> = useColumn ? { ...baseInsert, ref, standard_quote_id: id } : { ...baseInsert, ref, custom_data: { [SQ_LINK_KEY]: id } };
    const result = await supabase.from("invoices").insert(row).select("id, ref").single();
    if (!result.error) {
      invoice = result.data;
    } else if (useColumn && isSchemaPending(result.error)) {
      useColumn = false;
      continue;
    } else if (result.error.code === "23505") {
      invErr = result.error;
      continue;
    } else {
      invErr = result.error;
      break;
    }
  }
  if (!invoice) return NextResponse.json({ error: invErr?.message ?? "Failed to create invoice" }, { status: 500 });

  if (built.lines.length > 0) {
    const { error: linesErr } = await supabase.from("invoice_lines").insert(
      built.lines.map((l) => ({ tenant_id: tenantId, invoice_id: invoice!.id, ...l })),
    );
    if (linesErr) return NextResponse.json({ error: linesErr.message }, { status: 500 });
  }

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "invoices", objectId: invoice.id, objectLabel: invoice.ref,
    action: "create", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: "Created from standard quote", from: null, to: quote.ref }, ...diffForLog("invoices", {}, { total: built.total })],
  });

  return NextResponse.json(invoice, { status: 201 });
}
