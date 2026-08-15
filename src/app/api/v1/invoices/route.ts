import { authorizeApi } from "../_auth";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { enrichedList } from "../_list";

export async function GET(req: Request) {
  const auth = await authorizeApi(req, "invoices");
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const src = LIST_SOURCES.invoices;
  const rows = await src.load(auth.tenantId);

  return enrichedList(req, rows, src.fields, {
    self: "/api/v1/invoices",
    legacyFilters: [
      { path: "status", value: searchParams.get("status") },
      { path: "account.id", value: searchParams.get("account_id") },
    ],
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
