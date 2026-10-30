import { NextResponse, type NextRequest } from "next/server";
import { parseWorkPackage } from "@/lib/contractProjects/allocation";
import { createPackage, draftRevision, openAllocation } from "@/lib/contractProjects/allocationServer";
import { loadLines } from "@/lib/contractProjects/server";
import { loadEmployeeChoices, loadPackages } from "@/lib/contractProjects/workPackagesServer";

// GET  /api/contract-projects/[id]/work-packages
//        -> { packages: [{ id, code, name, owner_employee_id, owner_name, allocated_cost, sort_order, note, line_keys }], employees, pending }
// POST /api/contract-projects/[id]/work-packages  { code, name, owner_employee_id?, line_keys?, note? }
//        A work package of the project's DRAFT revision. The code is unique on the project, a line sits in one package, and the owner must be
//        an active employee of this workspace WITH a login (422 `needs_login` otherwise: create the login first). 201 { id }.

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const open = await openAllocation(id, false);
  if (!open.ok) return NextResponse.json({ error: open.error, ...(open.extra ?? {}) }, { status: open.status });
  const { admin, tenantId } = open.req;
  const [packs, employees] = await Promise.all([loadPackages(admin, tenantId, id), loadEmployeeChoices(admin, tenantId)]);
  return NextResponse.json({ packages: packs.packages, employees, pending: packs.pending }, { status: packs.pending ? 503 : 200 });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const open = await openAllocation(id, true);
  if (!open.ok) return NextResponse.json({ error: open.error, ...(open.extra ?? {}) }, { status: open.status });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const draft = await draftRevision(open, null);
  if (!draft.ok) return NextResponse.json({ error: draft.error, ...(draft.extra ?? {}) }, { status: draft.status });
  const keys = new Set((await loadLines(open.req.admin, open.req.tenantId, draft.revision.id)).map((l) => l.line_key));
  const parsed = parseWorkPackage(body, keys, "create");
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
  const made = await createPackage(open, draft.revision, parsed.value as Parameters<typeof createPackage>[2]);
  if (!made.ok) return NextResponse.json({ error: made.error, ...(made.extra ?? {}) }, { status: made.status });
  return NextResponse.json({ id: made.id }, { status: 201 });
}
