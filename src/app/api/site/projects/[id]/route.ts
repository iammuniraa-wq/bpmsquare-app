import { NextResponse, type NextRequest } from "next/server";
import { getAuthUser } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";
import { isDeciderOn, loadViewerScope } from "@/lib/site/expensesServer";
import { anyProject, failure, isMissingSchema, openSiteRequest, SITE_ENTRY_BUNDLE } from "@/lib/site/server";

// PATCH /api/site/projects/[id]  { site_entry: boolean }
//   The per-project switch "Site entry": whether site people may record receipts and expenses on this project (default on while it is active).
//   The project manager, a cost approver or an admin sets it; existing records stay. 503 while migration 0260 is pending.
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const gate = await openSiteRequest("any");
  if (!gate.ok) return failure(gate);
  const { admin, tenantId, supabase } = gate.req;
  const { id } = await params;
  const project = await anyProject(admin, tenantId, id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const scope = await loadViewerScope(gate.req);
  if (!isDeciderOn(scope, id)) return NextResponse.json({ error: "Only the project manager or a cost approver can change this" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { site_entry?: unknown };
  if (typeof body.site_entry !== "boolean") return NextResponse.json({ error: "site_entry must be true or false" }, { status: 400 });
  const { error } = await admin.from("contract_projects").update({ site_entry: body.site_entry }).eq("id", id).eq("tenant_id", tenantId);
  if (error) {
    if (isMissingSchema(error)) return NextResponse.json({ error: "The Site entry switch needs a database update (migration 0260).", needsDatabaseUpdate: true, bundle: SITE_ENTRY_BUNDLE }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const user = await getAuthUser();
  await logChange(supabase, { tenantId, objectType: "contract_projects", objectId: id, objectLabel: `${project.ref ?? ""} ${project.name}`.trim(), action: "update", actorId: user?.id, actorEmail: user?.email, changes: [{ field: "Site entry", from: !body.site_entry, to: body.site_entry }] });
  return NextResponse.json({ ok: true, site_entry: body.site_entry });
}
