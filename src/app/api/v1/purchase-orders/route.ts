import { resolveTenantFromBearer, ERR_401_TENANT } from "../_auth";
import { createAdminSupabase } from "@/lib/supabase-server";
import { enrichedList } from "../_list";
import type { QueryableField } from "@/lib/api/query";

const PO_QUERYABLE: QueryableField[] = [
  { path: "id", type: "string" },
  { path: "ref", type: "string", searchable: true },
  { path: "status", type: "string" },
  { path: "supplier.id", type: "string" },
  { path: "supplier.name", type: "string", searchable: true },
  { path: "quote_id", type: "string" },
  { path: "case_id", type: "string" },
  { path: "order_date", type: "date" },
  { path: "expected_date", type: "date" },
  { path: "total", type: "number" },
  { path: "created_at", type: "date" },
];

export async function GET(req: Request) {
  const tenantId = await resolveTenantFromBearer(req);
  if (!tenantId) return ERR_401_TENANT();

  const { searchParams } = new URL(req.url);
  const supabase = createAdminSupabase();
  const { data, error } = await supabase.from("purchase_orders").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const supplierIds = [...new Set((data ?? []).map((p) => p.supplier_id))];
  const { data: suppliers } = supplierIds.length
    ? await supabase.from("suppliers").select("id, name").in("id", supplierIds)
    : { data: [] };
  const supplierNameById = new Map((suppliers ?? []).map((s) => [s.id, s.name]));

  const rows = (data ?? []).map((po) => ({
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
  }));

  return enrichedList(req, rows, PO_QUERYABLE, {
    self: "/api/v1/purchase-orders",
    legacyFilters: [
      { path: "status", value: searchParams.get("status") },
      { path: "supplier.id", value: searchParams.get("supplier_id") },
    ],
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
