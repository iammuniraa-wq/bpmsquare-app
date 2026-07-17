import { resolveTenantFromBearer, ERR_401_TENANT, jsonOk } from "../../_auth";
import { createAdminSupabase } from "@/lib/supabase-server";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await resolveTenantFromBearer(req);
  if (!tenantId) return ERR_401_TENANT();

  const { id } = await params;
  const { data: item, error } = await createAdminSupabase()
    .from("inventory_items")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!item) return Response.json({ error: "Not found" }, { status: 404 });

  return jsonOk({
    data: { ...item, _links: { self: `/api/v1/inventory/${item.id}` } },
    _links: { self: `/api/v1/inventory/${id}` },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
