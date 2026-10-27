import { NextResponse, type NextRequest } from "next/server";
import { loadProject, needsUpdate, openProjectRequest } from "@/lib/contractProjects/server";
import { parseVariation, type VariationInput } from "@/lib/contractProjects/variations";
import { buildVariationsData, createVariation } from "@/lib/contractProjects/variationsServer";

// GET  /api/contract-projects/[id]/variations
//        -> { variations: [{ ...row, submitted_by_name, decided_by_name, revision_no, can_decide, mine }], totals: { approved, approvedCost, pending,
//             pendingCount, revised, original, count }, currency, pending, canEdit }
// POST /api/contract-projects/[id]/variations  { title, description?, amount?, cost_amount?, change_request_ref?, note? }
//        A new DRAFT variation (ref VAR-####). The status, the ref and the author are the server's, never the body's. 201 { id, ref }.
// Behind the platform-admin flag `contract_projects` (and gcc_tender): a workspace without them gets a 404 and no table is read.
// While migration 0231 is pending the answer is 503 with needsDatabaseUpdate.

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Ctx) {
  const gate = await openProjectRequest();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  const found = await loadProject(gate.req.admin, gate.req.tenantId, id);
  if (found.kind === "pending") return NextResponse.json({ error: needsUpdate().error, needsDatabaseUpdate: true }, { status: 503 });
  if (found.kind !== "ok") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const data = await buildVariationsData(gate.req, found.project);
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
  const parsed = parseVariation(body, "create");
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
  const made = await createVariation(gate.req, found.project, parsed.value as VariationInput);
  if (!made.ok) return NextResponse.json({ error: made.error, ...(made.extra ?? {}) }, { status: made.status });
  return NextResponse.json({ id: made.variation.id, ref: made.variation.ref }, { status: 201 });
}
