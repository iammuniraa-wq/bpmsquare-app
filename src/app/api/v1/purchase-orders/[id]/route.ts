import { resolveTenantFromBearer, ERR_401_TENANT, jsonOk } from "../../_auth";
import { createAdminSupabase } from "@/lib/supabase-server";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await resolveTenantFromBearer(req);
  if (!tenantId) return ERR_401_TENANT();

  const { id } = await params;
  const supabase = createAdminSupabase();
  const { data: po, error } = await supabase.from("purchase_orders").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!po) return Response.json({ error: "Not found" }, { status: 404 });

  const [{ data: lines }, { data: supplier }] = await Promise.all([
    supabase.from("purchase_order_lines").select("*").eq("po_id", id).order("sl_no"),
    supabase.from("suppliers").select("id, name, email, phone").eq("id", po.supplier_id).maybeSingle(),
  ]);

  return jsonOk({
    data: {
      id: po.id,
      ref: po.ref,
      status: po.status,
      supplier,
      quote_id: po.quote_id,
      case_id: po.case_id,
      order_date: po.order_date,
      expected_date: po.expected_date,
      notes: po.notes,
      terms: po.terms,
      total: po.total,
      custom_data: po.custom_data,
      created_at: po.created_at,
      lines: (lines ?? []).map((l) => ({
        id: l.id,
        inventory_item_id: l.inventory_item_id,
        description: l.description,
        uom: l.uom,
        qty_ordered: l.qty_ordered,
        qty_received: l.qty_received,
        rate: l.rate,
        amount: l.amount,
      })),
      _links: { self: `/api/v1/purchase-orders/${po.id}` },
    },
    _links: { self: `/api/v1/purchase-orders/${id}` },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
