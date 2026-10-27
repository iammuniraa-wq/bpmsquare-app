import { NextResponse, type NextRequest } from "next/server";
import { loadProject, needsUpdate, openProjectRequest } from "@/lib/contractProjects/server";
import { parseMilestone } from "@/lib/contractProjects/milestones";
import { buildMilestonesData, createMilestone } from "@/lib/contractProjects/milestonesServer";

// GET  /api/contract-projects/[id]/milestones
//        -> { milestones: [{ ...row, amount, display_status, invoice_ref, invoice_status }], totals: { count, contracted, scheduled, invoiced, paid,
//             toInvoice, percentTotal, warning }, currency, pending, canEdit, invoicesOn, hasCustomer }
// POST /api/contract-projects/[id]/milestones  { title, due_date?, basis: "percent" | "fixed", percent? | fixed_amount?, note? }
//        A new PLANNED milestone at the end of the schedule. Percent milestones totalling over 100 percent are a warning on the answer
//        (totals.warning), never a refusal. The status, the invoice and the author are the server's. 201 { id }.
// Behind the platform-admin flag `contract_projects` (and gcc_tender); a workspace without them gets a 404 and no table is read.

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Ctx) {
  const gate = await openProjectRequest();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  const found = await loadProject(gate.req.admin, gate.req.tenantId, id);
  if (found.kind === "pending") return NextResponse.json({ error: needsUpdate().error, needsDatabaseUpdate: true }, { status: 503 });
  if (found.kind !== "ok") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const data = await buildMilestonesData(gate.req, found.project);
  return NextResponse.json(data, { status: data.pending ? 503 : 200 });
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const gate = await openProjectRequest({ write: true });
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  const found = await loadProject(gate.req.admin, gate.req.tenantId, id);
  if (found.kind === "pending") return NextResponse.json({ error: needsUpdate().error, needsDatabaseUpdate: true }, { status: 503 });
  if (found.kind !== "ok") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const parsed = parseMilestone(body, "create");
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
  const made = await createMilestone(gate.req, found.project, parsed.value);
  if (!made.ok) return NextResponse.json({ error: made.error, ...(made.extra ?? {}) }, { status: made.status });
  return NextResponse.json({ id: made.milestone.id }, { status: 201 });
}
