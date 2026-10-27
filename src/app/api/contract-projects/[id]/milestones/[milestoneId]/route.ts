import { NextResponse, type NextRequest } from "next/server";
import { loadProject, needsUpdate, openProjectRequest } from "@/lib/contractProjects/server";
import { MILESTONE_STATUSES, parseMilestone, type MilestoneStatus } from "@/lib/contractProjects/milestones";
import { editMilestone, loadMilestone, removeMilestone } from "@/lib/contractProjects/milestonesServer";

// PATCH  /api/contract-projects/[id]/milestones/[milestoneId]  { title?, due_date?, basis?, percent?, fixed_amount?, note?, status? }
//          status may be set by hand between planned and ready, and from invoiced to paid; invoiced only comes from Create invoice. The
//          amount is locked once an invoice exists (409).
// DELETE /api/contract-projects/[id]/milestones/[milestoneId]  only a planned or ready milestone with no invoice.
// The milestone is matched by id AND this project AND this workspace: an id of another project or workspace matches nothing (404).

type Ctx = { params: Promise<{ id: string; milestoneId: string }> };

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const gate = await openProjectRequest({ write: true });
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id, milestoneId } = await params;
  const { admin, tenantId } = gate.req;
  const found = await loadProject(admin, tenantId, id);
  if (found.kind === "pending") return NextResponse.json({ error: needsUpdate().error, needsDatabaseUpdate: true }, { status: 503 });
  if (found.kind !== "ok") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const current = await loadMilestone(admin, tenantId, id, milestoneId);
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = parseMilestone(body, "update");
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
  let status: MilestoneStatus | undefined;
  if ("status" in body) {
    if (typeof body.status !== "string" || !(MILESTONE_STATUSES as readonly string[]).includes(body.status)) return NextResponse.json({ error: "Not a milestone status" }, { status: 422 });
    status = body.status as MilestoneStatus;
  }
  if (Object.keys(parsed.value).length === 0 && !status) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  const saved = await editMilestone(gate.req, found.project, current, { ...parsed.value, ...(status ? { status } : {}) });
  return saved.ok ? NextResponse.json({ ok: true, milestone: saved.milestone }) : NextResponse.json({ error: saved.error, ...(saved.extra ?? {}) }, { status: saved.status });
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const gate = await openProjectRequest({ write: true });
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id, milestoneId } = await params;
  const { admin, tenantId } = gate.req;
  const found = await loadProject(admin, tenantId, id);
  if (found.kind === "pending") return NextResponse.json({ error: needsUpdate().error, needsDatabaseUpdate: true }, { status: 503 });
  if (found.kind !== "ok") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const current = await loadMilestone(admin, tenantId, id, milestoneId);
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const done = await removeMilestone(gate.req, found.project, current);
  return done.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: done.error }, { status: done.status });
}
