import { NextResponse, type NextRequest } from "next/server";
import { loadProject, needsUpdate, openProjectRequest } from "@/lib/contractProjects/server";
import { createMilestoneInvoice, loadMilestone } from "@/lib/contractProjects/milestonesServer";

// POST /api/contract-projects/[id]/milestones/[milestoneId]/invoice
//        Makes the DRAFT invoice for a planned or ready milestone through the existing invoices route (the project's customer, one line for
//        the milestone, the amount worked out from the revised contract value now), links it both ways (the milestone's invoice_id and the
//        invoice's custom_data) and marks the milestone invoiced. 409 when it already has an invoice (a double click cannot make two), when
//        the project has no customer or the milestone no amount; 403 when the Invoices module is off for the workspace.
//        -> 201 { invoice_id, invoice_ref, amount }

type Ctx = { params: Promise<{ id: string; milestoneId: string }> };

export async function POST(_request: NextRequest, { params }: Ctx) {
  const gate = await openProjectRequest({ write: true });
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id, milestoneId } = await params;
  const { admin, tenantId } = gate.req;
  const found = await loadProject(admin, tenantId, id);
  if (found.kind === "pending") return NextResponse.json({ error: needsUpdate().error, needsDatabaseUpdate: true }, { status: 503 });
  if (found.kind !== "ok") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const current = await loadMilestone(admin, tenantId, id, milestoneId);
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const made = await createMilestoneInvoice(gate.req, found.project, current);
  if (!made.ok) return NextResponse.json({ error: made.error, ...(made.extra ?? {}) }, { status: made.status });
  return NextResponse.json({ invoice_id: made.invoice_id, invoice_ref: made.invoice_ref, amount: made.amount }, { status: 201 });
}
