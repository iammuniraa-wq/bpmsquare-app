import { authorizeApi } from "../_auth";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { enrichedList } from "../_list";

// Site expenses (0258). Scope "site_expenses", EXPLICIT_SCOPE_ONLY: they are internal cost, so a key reaches them only by naming the scope and a
// wildcard key never widens. authorizeApi also answers 404 for a workspace that does not own the module. Header fields only; no photo, no AI
// reading and no person (who entered an expense is staff data).
export async function GET(req: Request) {
  const auth = await authorizeApi(req, "site_expenses");
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const src = LIST_SOURCES.site_expenses;
  let rows = await src.load(auth.tenantId);
  const projectId = searchParams.get("project_id");
  if (projectId) rows = rows.filter((r) => r.project_id === projectId);

  return enrichedList(req, rows, src.fields, {
    self: "/api/v1/site-expenses",
    legacyFilters: [{ path: "status", value: searchParams.get("status") }],
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
