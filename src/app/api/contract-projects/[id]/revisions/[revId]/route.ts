import { NextResponse, type NextRequest } from "next/server";
import { diffForLog, logChange } from "@/lib/changeLog";
import { getAuthUser } from "@/lib/supabase-server";
import { JUSTIFICATION_NEEDS_NOTE } from "@/lib/contractProjects/types";
import { existingCodes, loadProject, loadRevision, needsUpdate, openProjectRequest } from "@/lib/contractProjects/server";

// PATCH /api/contract-projects/[id]/revisions/[revId]  { justification_code?, justification_text? }
// The reason of a DRAFT revision after the baseline. A revision that is waiting or approved keeps the reason it was sent with (409).

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; revId: string }> }) {
  const gate = await openProjectRequest({ write: true });
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, supabase, tenantId } = gate.req;
  const { id, revId } = await params;
  const found = await loadProject(admin, tenantId, id);
  if (found.kind === "pending") return NextResponse.json({ error: needsUpdate().error, needsDatabaseUpdate: true }, { status: 503 });
  if (found.kind !== "ok") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const revision = await loadRevision(admin, tenantId, id, revId);
  if (!revision) return NextResponse.json({ error: "Revision not found" }, { status: 404 });
  if (revision.status !== "draft") return NextResponse.json({ error: "Only a draft revision can be changed", locked: true }, { status: 409 });
  if (revision.rev_no === 0) return NextResponse.json({ error: "The baseline has no reason to record" }, { status: 422 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if ("justification_code" in body) {
    const code = typeof body.justification_code === "string" ? body.justification_code.trim() : "";
    if (!code || !(await existingCodes(admin, tenantId, "justification", [code])).has(code)) return NextResponse.json({ error: "That reason is not in your list" }, { status: 422 });
    patch.justification_code = code;
  }
  if ("justification_text" in body) patch.justification_text = typeof body.justification_text === "string" && body.justification_text.trim() ? body.justification_text.trim().slice(0, 1000) : null;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  const code = (patch.justification_code ?? revision.justification_code) as string | null;
  const text = ("justification_text" in patch ? patch.justification_text : revision.justification_text) as string | null;
  if (code === JUSTIFICATION_NEEDS_NOTE && !text) return NextResponse.json({ error: "Say what changed: this reason needs a note" }, { status: 422 });

  const { error } = await admin.from("project_budget_revisions").update(patch).eq("id", revId).eq("tenant_id", tenantId).eq("project_id", id).eq("status", "draft");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "contract_projects", objectId: id, objectLabel: `${found.project.ref ?? ""} ${found.project.name}`.trim(), action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: diffForLog("contract_projects", { [`Revision ${revision.rev_no} reason`]: [revision.justification_code, revision.justification_text].filter(Boolean).join(": ") }, { [`Revision ${revision.rev_no} reason`]: [code, text].filter(Boolean).join(": ") }),
  });
  return NextResponse.json({ ok: true });
}
