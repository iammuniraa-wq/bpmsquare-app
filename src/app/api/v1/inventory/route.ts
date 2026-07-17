import { resolveTenantFromBearer, ERR_401_TENANT, jsonOk } from "../_auth";
import { createAdminSupabase } from "@/lib/supabase-server";

export async function GET(req: Request) {
  const tenantId = await resolveTenantFromBearer(req);
  if (!tenantId) return ERR_401_TENANT();

  const { searchParams } = new URL(req.url);
  const lowStock = searchParams.get("low_stock") === "true";

  const { data, error } = await createAdminSupabase().from("inventory_items").select("*").eq("tenant_id", tenantId).order("name");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let items = data ?? [];
  if (lowStock) items = items.filter((i) => i.reorder_level != null && i.qty_on_hand <= i.reorder_level);

  return jsonOk({
    data: items.map((i) => ({
      id: i.id,
      sku: i.sku,
      name: i.name,
      description: i.description,
      category: i.category,
      uom: i.uom,
      qty_on_hand: i.qty_on_hand,
      reorder_level: i.reorder_level,
      unit_cost: i.unit_cost,
      supplier_id: i.supplier_id,
      status: i.status,
      custom_data: i.custom_data,
      _links: { self: `/api/v1/inventory/${i.id}` },
    })),
    meta: { count: items.length, generated_at: new Date().toISOString() },
    _links: { self: "/api/v1/inventory" },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
