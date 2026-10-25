import { authorizeApi, jsonOk } from "../../_auth";
import { createAdminSupabase } from "@/lib/supabase-server";
import { evaluateInvoiceById, loadEinvoiceTenant } from "@/lib/einvoicing/server";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi(req, "invoices");
  if ("error" in auth) return auth.error;
  const { tenantId } = auth;

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

  // Saudi e-invoicing workspaces also get the e-invoice identity, the Ready flag and each line's VAT category. Everyone else gets
  // exactly the keys they always had: nothing is added, not even as null.
  const tenant = await loadEinvoiceTenant(supabase, tenantId);
  const ev = tenant.on && "einvoice_doc_type" in invoice ? await evaluateInvoiceById(supabase, tenantId, id, tenant) : null;
  const einvoiceFields = ev
    ? {
        einvoice_doc_type: ev.docType,
        einvoice_ready: ev.ready,
        einvoice_uuid: invoice.einvoice_uuid ?? null,
        einvoice_seq: invoice.einvoice_seq ?? null,
        original_invoice_id: invoice.original_invoice_id ?? null,
        credit_reason: invoice.credit_reason ?? null,
        supply_date: invoice.supply_date ?? null,
      }
    : {};

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
      ...einvoiceFields,
      lines: (lines ?? []).map((l) => ({
        id: l.id, description: l.description, uom: l.uom, qty: l.qty, rate: l.rate, amount: l.amount,
        ...(ev ? { vat_category: l.vat_category ?? null, vat_rate: l.vat_rate ?? null, vat_exemption_reason: l.vat_exemption_reason ?? null } : {}),
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
