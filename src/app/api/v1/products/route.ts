import { authorizeApi } from "../_auth";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { enrichedList } from "../_list";

export async function GET(req: Request) {
  const auth = await authorizeApi(req, "products");
  if ("error" in auth) return auth.error;

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
