import { authorizeApi } from "../_auth";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { enrichedList } from "../_list";
import { createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";

// GET /api/v1/projects — the workforce projects hours are attributed to
// (project costing). Sub-projects are rows too, with `level` and
// `parent_id`; filter parent_id=<id> for one project's children, or
// level=0 for top-level projects only.
export async function GET(req: Request) {
  const auth = await authorizeApi(req, "projects");
  if ("error" in auth) return auth.error;

  // A tenant without the module gets 404, not data (§3b).
  if (!(await tenantHasFeature(createAdminSupabase(), auth.tenantId, "wfm_projects"))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const src = LIST_SOURCES.projects;
  let rows = await src.load(auth.tenantId);
  const parentId = searchParams.get("parent_id");
  if (parentId) rows = rows.filter((p) => p.parent_id === parentId);
  const accountId = searchParams.get("account_id");
  if (accountId) rows = rows.filter((p) => p.account_id === accountId);
  const level = searchParams.get("level");
  if (level !== null && level !== "") rows = rows.filter((p) => String(p.level) === level);

  return enrichedList(req, rows, src.fields, {
    self: "/api/v1/projects",
    legacyFilters: [{ path: "status", value: searchParams.get("status") }],
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
