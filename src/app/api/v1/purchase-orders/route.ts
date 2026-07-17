import { resolveTenantFromBearer, ERR_401_TENANT, jsonOk } from "../_auth";
import { createAdminSupabase } from "@/lib/supabase-server";

export async function GET(req: Request) {
  const tenantId = await resolveTenantFromBearer(req);
  if (!tenantId) return ERR_401_TENANT();

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const supplierId = searchParams.get("supplier_id");

  const supabase = createAdminSupabase();
  let query = supabase.from("purchase_orders").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  if (supplierId) query = query.eq("supplier_id", supplierId);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const supplierIds = [...new Set((data ?? []).map((p) => p.supplier_id))];
  const { data: suppliers } = supplierIds.length
    ? await supabase.from("suppliers").select("id, name").in("id", supplierIds)
    : { data: [] };
  const supplierNameById = new Map((suppliers ?? []).map((s) => [s.id, s.name]));

  return jsonOk({
    data: (data ?? []).map((po) => ({
      id: po.id,
      ref: po.ref,
      status: po.status,
      supplier: { id: po.supplier_id, name: supplierNameById.get(po.supplier_id) ?? null },
      quote_id: po.quote_id,
      case_id: po.case_id,
      order_date: po.order_date,
      expected_date: po.expected_date,
      total: po.total,
      created_at: po.created_at,
      _links: { self: `/api/v1/purchase-orders/${po.id}` },
    })),
    meta: { count: (data ?? []).length, generated_at: new Date().toISOString() },
    _links: { self: "/api/v1/purchase-orders" },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
