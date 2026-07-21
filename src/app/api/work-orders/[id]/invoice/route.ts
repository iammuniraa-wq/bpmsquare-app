import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { generateNextInvoiceRef } from "@/lib/invoiceRef";

export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId, userId;
  try {
    ({ supabase, tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;

  const { data: wo, error: woErr } = await supabase
    .from("work_orders")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .single();

  if (woErr || !wo) return NextResponse.json({ error: "Work order not found" }, { status: 404 });
  if (wo.status !== "completed") return NextResponse.json({ error: "Work order must be completed first" }, { status: 400 });

  let total = 0;
  let contactId: string | null = null;
  let entityId: string | null = null;
  let quoteId: string | null = null;
  let contractId: string | null = null;
  let lineRows: { sl_no: string | null; description: string; uom: string | null; qty: number; rate: number; amount: number }[] = [];

  if (wo.auth_kind === "quote" && wo.auth_id) {
    const [{ data: quote }, { data: quoteLines }] = await Promise.all([
      supabase.from("quotes").select("contact_id, entity_id").eq("id", wo.auth_id).eq("tenant_id", tenantId).maybeSingle(),
      supabase.from("quote_lines").select("sl_no, description, uom, qty, rate, amount").eq("quote_id", wo.auth_id).eq("tenant_id", tenantId).order("sl_no"),
    ]);
    quoteId = wo.auth_id;
    contactId = quote?.contact_id ?? null;
    entityId = quote?.entity_id ?? null;
    lineRows = (quoteLines ?? []).map((l) => ({
      sl_no: l.sl_no ?? null, description: l.description, uom: l.uom ?? null,
      qty: l.qty, rate: l.rate, amount: l.amount,
    }));
    total = lineRows.reduce((s, l) => s + (l.amount ?? 0), 0);
  } else if (wo.auth_kind === "contract" && wo.auth_id) {
    // An AMC contract bills a flat period value covering many work orders over its term --
    // one completed WO has no natural fractional claim on that value, so we don't fabricate a
    // total. The invoice lands in draft with 0 lines; finance adds lines reflecting the actual
    // billing arrangement before sending.
    contractId = wo.auth_id;
  }

  // Retry a few times on a (tenant_id, ref) collision -- same pattern as quotes/purchase-orders.
  let invoice: { id: string; ref: string } | null = null;
  let invErr: { message: string; code?: string } | null = null;
  for (let attempt = 0; attempt < 3 && !invoice; attempt++) {
    const ref = await generateNextInvoiceRef(supabase, tenantId);
    const result = await supabase
      .from("invoices")
      .insert({
        tenant_id: tenantId,
        account_id: wo.account_id,
        contact_id: contactId,
        entity_id: entityId,
        quote_id: quoteId,
        case_id: wo.case_id ?? null,
        contract_id: contractId,
        ref,
        work_order_id: id,
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

  if (lineRows.length > 0) {
    const { error: linesErr } = await supabase
      .from("invoice_lines")
      .insert(lineRows.map((l) => ({ ...l, tenant_id: tenantId, invoice_id: invoice!.id })));
    if (linesErr) return NextResponse.json({ error: linesErr.message }, { status: 500 });
  }

  await supabase.from("work_orders").update({ status: "invoiced" }).eq("id", id).eq("tenant_id", tenantId);

  return NextResponse.json({ id: invoice.id, ref: invoice.ref }, { status: 201 });
}
