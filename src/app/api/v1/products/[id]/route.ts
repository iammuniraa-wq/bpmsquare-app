import { authorizeApi, jsonOk } from "../../_auth";
import { createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi(req, "products");
  if ("error" in auth) return auth.error;
  const { tenantId } = auth;

  const admin = createAdminSupabase();
  if (!(await tenantHasFeature(admin, tenantId, "products"))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const { id } = await params;
  // cost_price is internal margin data -- never selected for API consumers.
  const { data: product, error } = await admin
    .from("products")
    .select("id, ref, sku, name, description, category, uom, list_price, tax_percent, status, custom_data, created_at, updated_at")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!product) return Response.json({ error: "Not found" }, { status: 404 });

  return jsonOk({
    data: { ...product, _links: { self: `/api/v1/products/${product.id}` } },
    _links: { self: `/api/v1/products/${id}` },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
