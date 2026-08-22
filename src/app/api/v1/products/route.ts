import { authorizeApi } from "../_auth";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { enrichedList } from "../_list";
import { createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";

export async function GET(req: Request) {
  const auth = await authorizeApi(req, "products");
  if ("error" in auth) return auth.error;

  // A tenant without the module gets 404, not data (§3b).
  if (!(await tenantHasFeature(createAdminSupabase(), auth.tenantId, "products"))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const src = LIST_SOURCES.products;
  let rows = await src.load(auth.tenantId);
  const category = searchParams.get("category");
  if (category) rows = rows.filter((p) => p.category === category);
  const subCategory = searchParams.get("sub_category");
  if (subCategory) rows = rows.filter((p) => p.sub_category === subCategory);

  return enrichedList(req, rows, src.fields, {
    self: "/api/v1/products",
    legacyFilters: [{ path: "status", value: searchParams.get("status") }],
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
