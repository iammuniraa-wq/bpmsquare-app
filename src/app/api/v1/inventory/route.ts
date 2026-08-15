import { authorizeApi } from "../_auth";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { enrichedList } from "../_list";

export async function GET(req: Request) {
  const auth = await authorizeApi(req, "inventory");
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const lowStock = searchParams.get("low_stock") === "true";

  const src = LIST_SOURCES.inventory;
  let rows = await src.load(auth.tenantId);
  if (lowStock) rows = rows.filter((i) => i.reorder_level != null && (i.qty_on_hand as number) <= (i.reorder_level as number));

  return enrichedList(req, rows, src.fields, {
    self: "/api/v1/inventory",
    legacyFilters: [{ path: "status", value: searchParams.get("status") }],
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
