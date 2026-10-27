import { NextResponse, type NextRequest } from "next/server";
import { logChange } from "@/lib/changeLog";
import { getAuthUser } from "@/lib/supabase-server";
import { justificationProblem } from "@/lib/contractProjects/approval";
import { startDraftRevision } from "@/lib/contractProjects/revisionStart";
import { existingCodes, loadProject, loadRevisions, needsUpdate, openProjectRequest } from "@/lib/contractProjects/server";

// GET  /api/contract-projects/[id]/revisions  the revisions, oldest first (every one stays readable, superseded included).
// POST /api/contract-projects/[id]/revisions  { justification_code, justification_text? }
//        Starts the next revision as a DRAFT copy of the approved one (same lines, same line_key so the change can be shown). A reason is
//        required (a code from the workspace's list; "Other" needs a note). One open revision per project at most: 409 while another
//        is a draft or waiting for approval. 409 too until a baseline has been approved (revision 0 is edited directly until then).
//        The copy itself is startDraftRevision(), which the approval of a variation uses as well.

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

  const started = await startDraftRevision(admin, { tenantId, userId, projectId: id, justificationCode: code, justificationText: text });
  if (!started.ok) return NextResponse.json({ error: started.error, ...(started.reason === "pending" ? { needsDatabaseUpdate: true } : {}) }, { status: started.status });

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "contract_projects", objectId: id, objectLabel: `${found.project.ref ?? ""} ${found.project.name}`.trim(), action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: "Budget revision started", from: `Revision ${started.fromRevNo}`, to: `Revision ${started.revNo}: ${code}${text ? `, ${text}` : ""}` }],
  });
  return NextResponse.json({ id: started.id, rev_no: started.revNo }, { status: 201 });
}
