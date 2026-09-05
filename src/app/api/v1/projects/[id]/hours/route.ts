import { authorizeApi, jsonOk } from "../../../_auth";
import { createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { projectHoursReport } from "@/lib/wfm/projectHoursServer";
import { UNASSIGNED } from "@/lib/wfm/projectHours";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;

// GET /api/v1/projects/:id/hours?from=&to= — worked hours for one project
// and everything beneath it, for a period. This is the feed an invoice is
// built from: the same arithmetic the Projects screen shows a supervisor,
// so the two can never disagree. Totals only -- no per-employee detail,
// which is personal data and stays behind the employees scope.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi(req, "projects");
  if ("error" in auth) return auth.error;
  const { tenantId } = auth;

  const admin = createAdminSupabase();
  if (!(await tenantHasFeature(admin, tenantId, "wfm_projects"))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !DATE_RE.test(from) || !to || !DATE_RE.test(to)) {
    return Response.json({ error: "from and to (YYYY-MM-DD) are required" }, { status: 400 });
  }
  if (to < from) return Response.json({ error: "to must be on or after from" }, { status: 400 });
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 > MAX_DAYS) {
    return Response.json({ error: `Pick a window of ${MAX_DAYS} days or fewer` }, { status: 400 });
  }

  const { data: exists } = await admin
    .from("wfm_projects").select("id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!exists) return Response.json({ error: "Not found" }, { status: 404 });

  const report = await projectHoursReport(admin, tenantId, from, to, { projectId: id });
  const rows = report.rows
    .filter((r) => r.key !== UNASSIGNED)
    .map((r) => ({
      project_id: r.key,
      ...report.projects[r.key],
      own_minutes: r.own_minutes,
      total_minutes: r.total_minutes,
      employees: r.employees,
      employees_total: r.employees_total,
      sessions: r.sessions,
      _links: { self: `/api/v1/projects/${r.key}` },
    }));
  const top = rows.find((r) => r.project_id === id);

  return jsonOk({
    data: {
      project_id: id,
      from, to,
      deduct_breaks: report.deduct_breaks,
      /** The number to bill: this project plus everything beneath it. */
      total_minutes: top?.total_minutes ?? 0,
      total_hours: Math.round(((top?.total_minutes ?? 0) / 60) * 100) / 100,
      breakdown: rows,
      ...(report.pending_migration ? { pending_migration: true } : {}),
    },
    _links: { self: `/api/v1/projects/${id}/hours?from=${from}&to=${to}`, project: `/api/v1/projects/${id}` },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
