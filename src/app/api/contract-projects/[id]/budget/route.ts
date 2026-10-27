import { NextResponse, type NextRequest } from "next/server";
import { logChange } from "@/lib/changeLog";
import { getAuthUser } from "@/lib/supabase-server";
import { budgetTotals, cleanDraftLines } from "@/lib/contractProjects/budget";
import { checkLineCodes, loadLines, loadProject, loadRevision, needsUpdate, openProjectRequest, replaceLines, UUID_RE } from "@/lib/contractProjects/server";

// GET /api/contract-projects/[id]/budget?revision=<id>   the lines of one revision with their totals (any revision stays readable).
// PUT /api/contract-projects/[id]/budget  { revision_id, lines: [{ line_key?, resource_code, cost_code, wbs, description, qty, unit,
//                                           unit_cost, cost_known, source_ref, reserve }] }
//     Replaces the lines of a DRAFT revision. A revision that is waiting for approval, approved or superseded is locked: 409 `locked`,
//     nothing written. The amount of each line and the revision total are computed here, never taken from the body. Resource and cost
//     codes must be in this workspace's lists; committed / actual are read-only and never written from here.

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  const gate = await openProjectRequest();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, tenantId } = gate.req;
  const { id } = await params;
  const found = await loadProject(admin, tenantId, id);
  if (found.kind === "pending") return NextResponse.json({ error: needsUpdate().error, needsDatabaseUpdate: true }, { status: 503 });
  if (found.kind !== "ok") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const revisionId = new URL(request.url).searchParams.get("revision") ?? "";
  const revision = await loadRevision(admin, tenantId, id, revisionId);
  if (!revision) return NextResponse.json({ error: "Revision not found" }, { status: 404 });
  const lines = await loadLines(admin, tenantId, revision.id);
  return NextResponse.json({ revision, lines, totals: budgetTotals(lines) });
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  const gate = await openProjectRequest({ write: true });
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, supabase, tenantId } = gate.req;
  const { id } = await params;
  const found = await loadProject(admin, tenantId, id);
  if (found.kind === "pending") return NextResponse.json({ error: needsUpdate().error, needsDatabaseUpdate: true }, { status: 503 });
  if (found.kind !== "ok") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  if (typeof body.revision_id !== "string" || !UUID_RE.test(body.revision_id)) return NextResponse.json({ error: "revision_id is required" }, { status: 400 });

  // The revision is matched by id AND this project AND this workspace: a revision id of another project or workspace matches nothing.
  const revision = await loadRevision(admin, tenantId, id, body.revision_id);
  if (!revision) return NextResponse.json({ error: "Revision not found" }, { status: 404 });
  if (found.project.status === "closed") return NextResponse.json({ error: "This project is closed", locked: true }, { status: 409 });
  if (revision.status !== "draft") {
    return NextResponse.json({ error: revision.status === "pending" ? "This revision is waiting for approval and cannot be edited" : "An approved budget is locked. Start a new revision to change it", locked: true }, { status: 409 });
  }

  const cleaned = cleanDraftLines(body.lines);
  if (!cleaned.ok) return NextResponse.json({ error: cleaned.error, row: cleaned.row }, { status: 422 });
  const codes = await checkLineCodes(admin, tenantId, cleaned.lines);
  if (!codes.ok) return NextResponse.json({ error: codes.error }, { status: codes.status });

  const before = await loadLines(admin, tenantId, revision.id);
  const saved = await replaceLines(admin, tenantId, id, revision.id, cleaned.lines);
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 500 });
  await admin.from("contract_projects").update({ updated_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", tenantId);

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "contract_projects", objectId: id, objectLabel: `${found.project.ref ?? ""} ${found.project.name}`.trim(), action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: `Budget revision ${revision.rev_no}`, from: `${before.length} lines, total ${budgetTotals(before).total}`, to: `${cleaned.lines.length} lines, total ${saved.total}` }],
  });
  const lines = await loadLines(admin, tenantId, revision.id);
  return NextResponse.json({ ok: true, total: saved.total, line_count: lines.length, lines, totals: budgetTotals(lines) });
}
