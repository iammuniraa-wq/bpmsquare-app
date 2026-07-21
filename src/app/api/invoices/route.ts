import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { generateNextInvoiceRef } from "@/lib/invoiceRef";

export async function GET(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const accountId = searchParams.get("account_id");

  let query = supabase.from("invoices").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  if (accountId) query = query.eq("account_id", accountId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  let supabase, tenantId, userId;
  try {
    ({ supabase, tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const body = await request.json();
  const {
    account_id, contact_id, entity_id, quote_id, case_id, contract_id,
    due_date, discount_type, discount_pct, discount_fixed, notes, terms, lines,
  } = body;

  if (!account_id) {
    return NextResponse.json({ error: "account_id is required" }, { status: 400 });
  }

  const { data: acct } = await supabase.from("accounts").select("id").eq("id", account_id).eq("tenant_id", tenantId).maybeSingle();
  if (!acct) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  // Every other foreign id comes straight from the request body -- verify each one
  // actually belongs to this tenant before it's woven into the new invoice, same as
  // the purchase-orders route already does for quote_id/case_id. Without this, a
  // tenant-A caller could splice in a tenant-B quote/contact/case/contract id.
  if (contact_id) {
    const { data: contact } = await supabase.from("contacts").select("id").eq("id", contact_id).eq("tenant_id", tenantId).maybeSingle();
    if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }
  if (quote_id) {
    const { data: quote } = await supabase.from("quotes").select("id").eq("id", quote_id).eq("tenant_id", tenantId).maybeSingle();
    if (!quote) return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }
  if (case_id) {
    const { data: caseRow } = await supabase.from("service_cases").select("id").eq("id", case_id).eq("tenant_id", tenantId).maybeSingle();
    if (!caseRow) return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }
  if (contract_id) {
    const { data: contract } = await supabase.from("contracts").select("id").eq("id", contract_id).eq("tenant_id", tenantId).maybeSingle();
    if (!contract) return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }
  if (entity_id) {
    const { data: tenantRow } = await supabase.from("tenants").select("config").eq("id", tenantId).single();
    const entities = (tenantRow?.config as { entities?: { id: string }[] } | null)?.entities ?? [];
    if (!entities.some((e) => e.id === entity_id)) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }
  }

  const cleanLines = Array.isArray(lines)
    ? lines
        .filter((l) => l?.description?.trim())
        .slice(0, 200)
        .map((l, i) => {
          const qty = Math.max(0, parseFloat(l.qty) || 1);
          const rate = Math.max(0, parseFloat(l.rate) || 0);
          return {
            tenant_id: tenantId,
            sl_no: l.sl_no || String(i + 1),
            description: String(l.description).slice(0, 500),
            uom: l.uom || null,
            qty,
            rate,
            amount: qty * rate,
          };
        })
    : [];

  const total = cleanLines.reduce((s, l) => s + l.amount, 0);

  const baseInsert = {
    tenant_id: tenantId,
    account_id,
    contact_id: contact_id || null,
    entity_id: entity_id || null,
    quote_id: quote_id || null,
    case_id: case_id || null,
    contract_id: contract_id || null,
    work_order_id: null,
    status: "draft",
    total,
    due_date: due_date || null,
    discount_type: discount_type ?? "pct",
    discount_pct: parseFloat(discount_pct) || 0,
    discount_fixed: parseFloat(discount_fixed) || 0,
    notes: notes || null,
    terms: terms || null,
    created_by: userId,
  };

  let invoice: { id: string; ref: string } | null = null;
  let invErr: { message: string; code?: string } | null = null;
  for (let attempt = 0; attempt < 3 && !invoice; attempt++) {
    const ref = await generateNextInvoiceRef(supabase, tenantId);
    const result = await supabase.from("invoices").insert({ ...baseInsert, ref }).select("id, ref").single();
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

  if (cleanLines.length > 0) {
    const { error: linesErr } = await supabase
      .from("invoice_lines")
      .insert(cleanLines.map((l) => ({ ...l, invoice_id: invoice!.id })));
    if (linesErr) return NextResponse.json({ error: linesErr.message }, { status: 500 });
  }

  return NextResponse.json(invoice, { status: 201 });
}
