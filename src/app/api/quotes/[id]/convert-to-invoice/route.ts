import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { generateNextInvoiceRef } from "@/lib/invoiceRef";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId, userId;
  try {
    ({ supabase, tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;

  const { data: quote } = await supabase
    .from("quotes")
    .select("id, account_id, contact_id, entity_id, status")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!quote) return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  if (quote.status !== "approved") {
    return NextResponse.json({ error: "Only an approved quote can be converted to an invoice" }, { status: 400 });
  }

  const { data: existing } = await supabase.from("invoices").select("id, ref").eq("quote_id", id).eq("tenant_id", tenantId).maybeSingle();
  if (existing) return NextResponse.json({ error: `An invoice already exists for this quote: ${existing.ref}` }, { status: 409 });

  const { data: quoteLines } = await supabase
    .from("quote_lines")
    .select("sl_no, description, uom, qty, rate, amount")
    .eq("quote_id", id)
    .order("sl_no");

  const total = (quoteLines ?? []).reduce((s, l) => s + (l.amount ?? 0), 0);

  let invoice: { id: string; ref: string } | null = null;
  let invErr: { message: string; code?: string } | null = null;
  for (let attempt = 0; attempt < 3 && !invoice; attempt++) {
    const ref = await generateNextInvoiceRef(supabase, tenantId);
    const result = await supabase
      .from("invoices")
      .insert({
        tenant_id: tenantId,
        account_id: quote.account_id,
        contact_id: quote.contact_id,
        entity_id: quote.entity_id,
        quote_id: id,
        ref,
        status: "draft",
        total,
        issued_at: new Date().toISOString(),
        created_by: userId,
      })
      .select("id, ref")
      .single();
    if (!result.error) {
      invoice = result.data;
    } else if (result.error.code === "23505") {
      invErr = result.error;
      continue;
    } else {
      invErr = result.error;
      break;
    }
  }

  if (!invoice) return NextResponse.json({ error: invErr?.message ?? "Failed to create invoice" }, { status: 500 });

  if (quoteLines && quoteLines.length > 0) {
    const { error: linesErr } = await supabase.from("invoice_lines").insert(
      quoteLines.map((l) => ({
        tenant_id: tenantId,
        invoice_id: invoice!.id,
        sl_no: l.sl_no,
        description: l.description,
        uom: l.uom,
        qty: l.qty,
        rate: l.rate,
        amount: l.amount,
      }))
    );
    if (linesErr) return NextResponse.json({ error: linesErr.message }, { status: 500 });
  }

  return NextResponse.json(invoice, { status: 201 });
}
