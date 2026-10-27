import { NextResponse, type NextRequest } from "next/server";
import { diffForLog, logChange } from "@/lib/changeLog";
import { getAuthUser } from "@/lib/supabase-server";
import { accountInTenant } from "@/lib/tender/server";
import { PROJECT_APPROVAL_KIND, PROJECT_APPROVAL_OBJECT } from "@/lib/contractProjects/approval";
import { cleanCurrency, cleanDate, cleanMoney, cleanName } from "@/lib/contractProjects/create";
import { loadProject, loadRevisions, memberInTenant, needsUpdate, openProjectRequest, UUID_RE } from "@/lib/contractProjects/server";
import { buildProjectView } from "@/lib/contractProjects/view";

// GET    /api/contract-projects/[id]?revision=<id>  the project, its revisions, the lines of one revision (default: the one being worked
//                                                   on, else the approved one), totals, planned margin, approval state and the change
//                                                   against the previous revision.
// PATCH  /api/contract-projects/[id]  { name?, account_id?, contract_value?, currency?, planned_start?, planned_end?, manager_id?,
//                                       status?: "closed" | "active" }   an explicit field list; erp_system / erp_id / ref / source are
//                                                   never taken from a body. Closing needs an active project; "active" reopens a closed one.
// DELETE /api/contract-projects/[id]  only a project that never had a baseline approved (a draft with nothing locked).
// The workspace always comes from the session; account and manager are verified against it.

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  const gate = await openProjectRequest();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  const found = await loadProject(gate.req.admin, gate.req.tenantId, id);
  if (found.kind === "pending") return NextResponse.json({ error: needsUpdate().error, needsDatabaseUpdate: true }, { status: 503 });
  if (found.kind !== "ok") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const rev = new URL(request.url).searchParams.get("revision");
  const view = await buildProjectView(gate.req, found.project, { revisionId: rev && UUID_RE.test(rev) ? rev : null });
  return NextResponse.json(view);
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const gate = await openProjectRequest({ write: true });
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, supabase, tenantId } = gate.req;
  const { id } = await params;
  const found = await loadProject(admin, tenantId, id);
  if (found.kind === "pending") return NextResponse.json({ error: needsUpdate().error, needsDatabaseUpdate: true }, { status: 503 });
  if (found.kind !== "ok") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const project = found.project;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if ("name" in body) {
    const name = cleanName(body.name);
    if (!name) return NextResponse.json({ error: "The project needs a name" }, { status: 400 });
    patch.name = name;
  }
  if ("contract_value" in body) {
    const v = cleanMoney(body.contract_value);
    if (v === null) return NextResponse.json({ error: "Contract value must be a number of 0 or more" }, { status: 422 });
    patch.contract_value = v;
  }
  if ("currency" in body) {
    const cur = cleanCurrency(body.currency);
    if (!cur) return NextResponse.json({ error: "Currency must be a 3-letter code" }, { status: 422 });
    patch.currency = cur;
  }
  for (const k of ["planned_start", "planned_end"] as const) {
    if (!(k in body)) continue;
    if (body[k] === null || body[k] === "") patch[k] = null;
    else {
      const d = cleanDate(body[k]);
      if (!d) return NextResponse.json({ error: `${k === "planned_start" ? "Start" : "End"} date must be YYYY-MM-DD` }, { status: 422 });
      patch[k] = d;
    }
  }
  const start = (patch.planned_start ?? project.planned_start) as string | null;
  const end = (patch.planned_end ?? project.planned_end) as string | null;
  if (start && end && end < start) return NextResponse.json({ error: "The end date is before the start date" }, { status: 422 });
  if ("account_id" in body) {
    const a = body.account_id;
    if (a === null || a === "") patch.account_id = null;
    else if (typeof a !== "string" || !(await accountInTenant(admin, tenantId, a))) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    else patch.account_id = a;
  }
  if ("manager_id" in body) {
    const m = body.manager_id;
    if (m === null || m === "") patch.manager_id = null;
    else if (typeof m !== "string" || !(await memberInTenant(admin, tenantId, m))) return NextResponse.json({ error: "Manager not found" }, { status: 404 });
    else patch.manager_id = m;
  }
  if ("status" in body) {
    if (body.status === "closed" && project.status === "active") patch.status = "closed";
    else if (body.status === "active" && project.status === "closed") {
      const revs = await loadRevisions(admin, tenantId, id);
      if (!revs.rows.some((r) => r.status === "approved")) return NextResponse.json({ error: "There is no approved budget to return to" }, { status: 409 });
      patch.status = "active";
    } else return NextResponse.json({ error: "A project can be closed while it is active, and a closed one reopened" }, { status: 409 });
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });

  const now = new Date().toISOString();
  const { error } = await admin.from("contract_projects").update({ ...patch, updated_at: now }).eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "contract_projects", objectId: id, objectLabel: `${project.ref ?? ""} ${project.name}`.trim(), action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: diffForLog("contract_projects", project as unknown as Record<string, unknown>, patch),
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const gate = await openProjectRequest({ write: true });
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, supabase, tenantId } = gate.req;
  const { id } = await params;
  const found = await loadProject(admin, tenantId, id);
  if (found.kind === "pending") return NextResponse.json({ error: needsUpdate().error, needsDatabaseUpdate: true }, { status: 503 });
  if (found.kind !== "ok") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const revs = await loadRevisions(admin, tenantId, id);
  if (found.project.status !== "draft" || revs.rows.some((r) => r.status === "approved" || r.status === "superseded" || r.status === "pending")) {
    return NextResponse.json({ error: "A project whose budget was approved or sent for approval cannot be deleted. Close it instead" }, { status: 409 });
  }
  const { error } = await admin.from("contract_projects").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("approval_requests").delete().eq("tenant_id", tenantId).eq("object_type", PROJECT_APPROVAL_OBJECT).eq("object_id", id).eq("kind", PROJECT_APPROVAL_KIND);
  const user = await getAuthUser();
  await logChange(supabase, { tenantId, objectType: "contract_projects", objectId: id, objectLabel: `${found.project.ref ?? ""} ${found.project.name}`.trim(), action: "delete", actorId: user?.id, actorEmail: user?.email, changes: [] });
  return NextResponse.json({ ok: true });
}
