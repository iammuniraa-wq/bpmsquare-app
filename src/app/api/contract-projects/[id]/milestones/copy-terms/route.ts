import { NextResponse, type NextRequest } from "next/server";
import { loadProject, needsUpdate, openProjectRequest } from "@/lib/contractProjects/server";
import { copyTenderTerms } from "@/lib/contractProjects/milestonesServer";

// POST /api/contract-projects/[id]/milestones/copy-terms  { template_id? }
//        Fills an EMPTY billing schedule from payment terms: one planned milestone per template milestone (a percent of the contract value
//        or a fixed amount, the "due when" text as its note). Without a body, the terms chosen on the winning bid of the project's tender
//        (the tender is the project's own source_opportunity_id, read tenant-scoped). With `template_id`, one of THIS workspace's
//        payment-term templates (Settings > Contract projects); the id is looked up in the workspace's own list, nothing else is read
//        from the request. 201 { created, template }; 409 when the schedule already has milestones or the project is closed; 404 when no
//        terms were chosen on the tender, or the template is not this workspace's.

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await openProjectRequest({ write: true });
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  const found = await loadProject(gate.req.admin, gate.req.tenantId, id);
  if (found.kind === "pending") return NextResponse.json({ error: needsUpdate().error, needsDatabaseUpdate: true }, { status: 503 });
  if (found.kind !== "ok") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { template_id?: unknown } | null;
  const templateId = typeof body?.template_id === "string" && body.template_id ? body.template_id : null;
  const done = await copyTenderTerms(gate.req, found.project, templateId);
  if (!done.ok) return NextResponse.json({ error: done.error, ...(done.extra ?? {}) }, { status: done.status });
  return NextResponse.json({ created: done.created, template: done.template }, { status: 201 });
}
