import { authorizeApi, jsonOk } from "../../_auth";
import { createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { PROJECT_SELECT, projectLinks } from "@/lib/wfm/projects";
import { depthOf } from "@/lib/wfm/projectTree";

// GET /api/v1/projects/:id — one project with where it sits (parent, level,
// sub-projects) and what it is linked to (sites, employees, shifts). Hours
// for a period are a separate call (/hours) because they are a report, not
// a property of the record.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi(req, "projects");
  if ("error" in auth) return auth.error;
  const { tenantId } = auth;

  const admin = createAdminSupabase();
  if (!(await tenantHasFeature(admin, tenantId, "wfm_projects"))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const { id } = await params;
  const { data: project, error } = await admin
    .from("wfm_projects")
    .select(`${PROJECT_SELECT}, created_at, updated_at`)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!project) return Response.json({ error: "Not found" }, { status: 404 });

  // The tree is needed for level and for children; one tenant-scoped read.
  const { data: all } = await admin
    .from("wfm_projects").select("id, ref, name, parent_id").eq("tenant_id", tenantId);
  const nodes = new Map((all ?? []).map((p) => [p.id as string, { id: p.id as string, parent_id: (p.parent_id as string | null) ?? null }]));
  const parent = (all ?? []).find((p) => p.id === project.parent_id) ?? null;
  const subProjects = (all ?? [])
    .filter((p) => p.parent_id === id)
    .map((p) => ({ id: p.id, ref: p.ref, name: p.name, _links: { self: `/api/v1/projects/${p.id}` } }));

  const links = await projectLinks(admin, tenantId, id);

  return jsonOk({
    data: {
      ...project,
      level: depthOf(nodes, id) ?? 0,
      parent: parent ? { id: parent.id, ref: parent.ref, name: parent.name, _links: { self: `/api/v1/projects/${parent.id}` } } : null,
      sub_projects: subProjects,
      links,
      _links: {
        self: `/api/v1/projects/${id}`,
        hours: `/api/v1/projects/${id}/hours?from=YYYY-MM-DD&to=YYYY-MM-DD`,
        ...(project.account_id ? { account: `/api/v1/accounts/${project.account_id}` } : {}),
      },
    },
    _links: { self: `/api/v1/projects/${id}` },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
