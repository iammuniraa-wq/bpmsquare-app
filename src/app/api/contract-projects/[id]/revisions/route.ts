import { NextResponse, type NextRequest } from "next/server";
import { logChange } from "@/lib/changeLog";
import { getAuthUser } from "@/lib/supabase-server";
import { justificationProblem } from "@/lib/contractProjects/approval";
import { existingCodes, insertLines, loadLines, loadProject, loadRevisions, needsUpdate, openProjectRequest, lineRows, type Failure } from "@/lib/contractProjects/server";

// GET  /api/contract-projects/[id]/revisions  the revisions, oldest first (every one stays readable, superseded included).
// POST /api/contract-projects/[id]/revisions  { justification_code, justification_text? }
//        Starts the next revision as a DRAFT copy of the approved one (same lines, same line_key so the change can be shown). A reason is
//        required (a code from the workspace's list; "Other" needs a note). One open revision per project at most: 409 while another
//        is a draft or waiting for approval. 409 too until a baseline has been approved (revision 0 is edited directly until then).

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Ctx) {
  const gate = await openProjectRequest();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  const found = await loadProject(gate.req.admin, gate.req.tenantId, id);
  if (found.kind === "pending") return NextResponse.json({ error: needsUpdate().error, needsDatabaseUpdate: true }, { status: 503 });
  if (found.kind !== "ok") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { rows } = await loadRevisions(gate.req.admin, gate.req.tenantId, id);
  return NextResponse.json({ revisions: rows });
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const gate = await openProjectRequest({ write: true });
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, supabase, tenantId, userId } = gate.req;
  const { id } = await params;
  const found = await loadProject(admin, tenantId, id);
  if (found.kind === "pending") return NextResponse.json({ error: needsUpdate().error, needsDatabaseUpdate: true }, { status: 503 });
  if (found.kind !== "ok") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  if (found.project.status === "closed") return NextResponse.json({ error: "This project is closed" }, { status: 409 });

  const code = typeof body.justification_code === "string" ? body.justification_code.trim() : "";
  const text = typeof body.justification_text === "string" && body.justification_text.trim() ? body.justification_text.trim().slice(0, 1000) : null;
  const problem = justificationProblem({ rev_no: 1, justification_code: code || null, justification_text: text });
  if (problem) return NextResponse.json({ error: problem }, { status: 422 });
  const known = await existingCodes(admin, tenantId, "justification", [code]);
  if (!known.has(code)) return NextResponse.json({ error: "That reason is not in your list" }, { status: 422 });

  const { rows: revisions } = await loadRevisions(admin, tenantId, id);
  const approved = revisions.find((r) => r.status === "approved");
  if (!approved) return NextResponse.json({ error: "Approve the baseline first. Until then revision 0 is edited directly" }, { status: 409 });
  if (revisions.some((r) => r.status === "draft" || r.status === "pending")) {
    return NextResponse.json({ error: "A revision is already open. Finish or withdraw it first" }, { status: 409 });
  }

  const revNo = Math.max(...revisions.map((r) => r.rev_no)) + 1;
  const made = await admin.from("project_budget_revisions").insert({
    tenant_id: tenantId, project_id: id, rev_no: revNo, status: "draft", justification_code: code, justification_text: text, created_by: userId, total: approved.total,
  }).select("id").single();
  if (made.error || !made.data) {
    if (made.error?.code === "23505") return NextResponse.json({ error: "A revision is already open. Finish or withdraw it first" }, { status: 409 });
    const miss = made.error && (made.error.code === "42P01" || made.error.code === "PGRST205");
    return NextResponse.json({ error: miss ? (needsUpdate() as Failure).error : made.error?.message ?? "Could not start the revision" }, { status: miss ? 503 : 500 });
  }
  const revisionId = (made.data as { id: string }).id;

  // A copy of the approved lines: same keys, no committed / actual (those belong to the ERP read-back, not to a revision).
  const copy = (await loadLines(admin, tenantId, approved.id)).map((l) => ({
    line_key: l.line_key, resource_code: l.resource_code, cost_code: l.cost_code, wbs: l.wbs, description: l.description, qty: l.qty, unit: l.unit,
    unit_cost: l.unit_cost, cost_known: l.cost_known, source_ref: l.source_ref, reserve: l.reserve,
  }));
  if (copy.length > 0) {
    const failed = await insertLines(admin, lineRows(tenantId, id, revisionId, copy));
    if (failed) {
      await admin.from("project_budget_revisions").delete().eq("id", revisionId).eq("tenant_id", tenantId);
      return NextResponse.json({ error: failed.message }, { status: 500 });
    }
  }
  await admin.from("contract_projects").update({ updated_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", tenantId);

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "contract_projects", objectId: id, objectLabel: `${found.project.ref ?? ""} ${found.project.name}`.trim(), action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: "Budget revision started", from: `Revision ${approved.rev_no}`, to: `Revision ${revNo}: ${code}${text ? `, ${text}` : ""}` }],
  });
  return NextResponse.json({ id: revisionId, rev_no: revNo }, { status: 201 });
}
