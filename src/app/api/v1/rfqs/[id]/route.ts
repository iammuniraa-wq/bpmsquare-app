import { authorizeApi, jsonOk } from "../../_auth";
import { createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { loadRfqBundle } from "@/lib/rfq/server";

// One RFQ with its lines, suppliers, quoted prices and awards. Never
// returned: the reply-link nonce (a credential), internal notes, and the
// message bodies (supplier correspondence stays in the app).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi(req, "rfqs");
  if ("error" in auth) return auth.error;
  const admin = createAdminSupabase();
  if (!(await tenantHasFeature(admin, auth.tenantId, "rfq"))) return Response.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;
  let b;
  try {
    b = await loadRfqBundle(admin, auth.tenantId, id, { messages: false });
  } catch {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (!b) return Response.json({ error: "Not found" }, { status: 404 });
  const { notes_internal: _n, tenant_id: _t, ...rfq } = b.rfq as unknown as Record<string, unknown>;
  return jsonOk({
    data: {
      ...rfq,
      lines: b.lines.map((l) => ({
        id: l.id, sl_no: l.sl_no, product_id: l.product_id, description: l.description, spec: l.spec, uom: l.uom, qty: l.qty,
        required_by: l.required_by, status: l.status, awarded_response_id: l.awarded_response_id, awarded_unit_cost: l.awarded_unit_cost,
      })),
      suppliers: b.suppliers.map((s) => ({
        id: s.id, supplier_id: s.supplier_id, supplier_name: s.suppliers?.name ?? null, status: s.status,
        sent_at: s.sent_at, viewed_at: s.viewed_at, replied_at: s.replied_at, supplier_quote_ref: s.supplier_quote_ref,
        currency: s.currency, incoterm: s.incoterm, freight_amount: s.freight_amount, payment_terms: s.payment_terms, valid_until: s.valid_until,
      })),
      responses: b.responses.map((r) => ({
        id: r.id, rfq_supplier_id: r.rfq_supplier_id, rfq_line_id: r.rfq_line_id, status: r.status, unit_price: r.unit_price,
        currency: r.currency, fx_rate: r.fx_rate, lead_time_days: r.lead_time_days, moq: r.moq, offered_description: r.offered_description,
        valid_until: r.valid_until, source: r.source, is_awarded: r.is_awarded, submitted_at: r.submitted_at,
      })),
      _links: { self: `/api/v1/rfqs/${id}` },
    },
    _links: { self: `/api/v1/rfqs/${id}` },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
