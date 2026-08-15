import { authorizeApi } from "../_auth";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { enrichedList } from "../_list";

export async function GET(req: Request) {
  const auth = await authorizeApi(req, "accounts");
  if ("error" in auth) return auth.error;

  const src = LIST_SOURCES.accounts;
  const rows = await src.load(auth.tenantId);

  return enrichedList(req, rows, src.fields, {
    self: "/api/v1/accounts",
    legacyFilters: [{ path: "type", value: new URL(req.url).searchParams.get("type") }],
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
