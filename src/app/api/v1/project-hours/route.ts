import { authorizeApi } from "../_auth";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { enrichedList } from "../_list";
import { createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { redactPeople } from "@/lib/wfm/projectHoursRows";

// GET /api/v1/project-hours — worked hours attributed to projects, one row
// per work session for the last 12 months, with the bill rate and billable
// amount each carries. The queryable feed behind "hours by project this
// month" style questions; /api/v1/projects/:id/hours stays the per-project
// roll-up for a period.
//
// Who worked is personal data: the employee columns are included only for
// a key explicitly scoped to "employees" (the same rule as /api/v1/
// employees) -- every other key sees the hours without the person.
export async function GET(req: Request) {
  const auth = await authorizeApi(req, "projects");
  if ("error" in auth) return auth.error;

  if (!(await tenantHasFeature(createAdminSupabase(), auth.tenantId, "wfm_projects"))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const src = LIST_SOURCES.project_hours;
  const { rows, fields } = redactPeople(await src.load(auth.tenantId), src.fields, auth.scopes.objects.includes("employees"));

  const { searchParams } = new URL(req.url);
  return enrichedList(req, rows, fields, {
    self: "/api/v1/project-hours",
    legacyFilters: [
      { path: "project.id", value: searchParams.get("project_id") },
      { path: "account.id", value: searchParams.get("account_id") },
    ],
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
