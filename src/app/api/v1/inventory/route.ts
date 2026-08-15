import { resolveTenantFromBearer, ERR_401_TENANT } from "../_auth";
import { createAdminSupabase } from "@/lib/supabase-server";
import { enrichedList } from "../_list";
import type { QueryableField } from "@/lib/api/query";

const INVENTORY_QUERYABLE: QueryableField[] = [
  { path: "id", type: "string" },
  { path: "sku", type: "string", searchable: true },
  { path: "name", type: "string", searchable: true },
  { path: "description", type: "string", searchable: true },
  { path: "category", type: "string", searchable: true },
  { path: "uom", type: "string" },
  { path: "qty_on_hand", type: "number" },
  { path: "reorder_level", type: "number" },
  { path: "unit_cost", type: "number" },
  { path: "supplier_id", type: "string" },
  { path: "status", type: "string" },
];

export async function GET(req: Request) {
  const tenantId = await resolveTenantFromBearer(req);
  if (!tenantId) return ERR_401_TENANT();

  const { searchParams } = new URL(req.url);
  const lowStock = searchParams.get("low_stock") === "true";

  const { data, error } = await createAdminSupabase().from("inventory_items").select("*").eq("tenant_id", tenantId).order("name");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let items = data ?? [];
  if (lowStock) items = items.filter((i) => i.reorder_level != null && i.qty_on_hand <= i.reorder_level);

  const rows = items.map((i) => ({
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
  }));

  return enrichedList(req, rows, INVENTORY_QUERYABLE, {
    self: "/api/v1/inventory",
    legacyFilters: [{ path: "status", value: searchParams.get("status") }],
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
