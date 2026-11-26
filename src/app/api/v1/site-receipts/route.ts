import { authorizeApi } from "../_auth";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { enrichedList } from "../_list";

// Site receipts (0259). Scope "site_receipts", EXPLICIT_SCOPE_ONLY (delivery evidence with people in it). authorizeApi also answers 404 for a
// workspace that does not own the module. Header fields only: the items are on /:id; no photo, no signature and no person.
export async function GET(req: Request) {
  const auth = await authorizeApi(req, "site_receipts");
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const src = LIST_SOURCES.site_receipts;
  let rows = await src.load(auth.tenantId);
  const projectId = searchParams.get("project_id");
  if (projectId) rows = rows.filter((r) => r.project_id === projectId);

  return enrichedList(req, rows, src.fields, {
    self: "/api/v1/site-receipts",
    legacyFilters: [{ path: "outcome", value: searchParams.get("outcome") }],
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
