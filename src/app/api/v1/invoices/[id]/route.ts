import { resolveTenantFromBearer, ERR_401_TENANT, jsonOk } from "../../_auth";
import { createAdminSupabase } from "@/lib/supabase-server";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await resolveTenantFromBearer(req);
  if (!tenantId) return ERR_401_TENANT();

  const { id } = await params;
  const supabase = createAdminSupabase();
  const { data: invoice, error } = await supabase.from("invoices").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!invoice) return Response.json({ error: "Not found" }, { status: 404 });

  const [{ data: lines }, { data: account }, { data: payments }] = await Promise.all([
    supabase.from("invoice_lines").select("*").eq("invoice_id", id).order("sl_no"),
    supabase.from("accounts").select("id, name").eq("id", invoice.account_id).maybeSingle(),
    supabase.from("invoice_payments").select("amount, paid_on, method").eq("invoice_id", id).order("paid_on", { ascending: false }),
  ]);

  return jsonOk({
    data: {
      id: invoice.id,
      ref: invoice.ref,
      status: invoice.status,
      account,
      quote_id: invoice.quote_id,
      work_order_id: invoice.work_order_id,
      case_id: invoice.case_id,
      contract_id: invoice.contract_id,
      due_date: invoice.due_date,
      notes: invoice.notes,
      terms: invoice.terms,
      total: invoice.total,
      paid_amount: invoice.paid_amount,
      balance_due: Math.max(0, invoice.total - invoice.paid_amount),
      custom_data: invoice.custom_data,
      issued_at: invoice.issued_at,
      lines: (lines ?? []).map((l) => ({
        id: l.id, description: l.description, uom: l.uom, qty: l.qty, rate: l.rate, amount: l.amount,
      })),
      payments: payments ?? [],
      _links: { self: `/api/v1/invoices/${invoice.id}` },
    },
    _links: { self: `/api/v1/invoices/${id}` },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
