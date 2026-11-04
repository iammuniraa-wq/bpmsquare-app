import { NextResponse, type NextRequest } from "next/server";
import { parseWorkPackage } from "@/lib/contractProjects/allocation";
import { createPackage, openAllocation, workingRevision } from "@/lib/contractProjects/allocationServer";
import { loadLines } from "@/lib/contractProjects/server";
import { loadEmployeeChoices, loadPackages } from "@/lib/contractProjects/workPackagesServer";

// GET  /api/contract-projects/[id]/work-packages
//        -> { packages: [{ id, code, name, parent_id, owner_employee_id, owner_name, allocated_cost, sort_order, note, line_keys, line_parts, source_wbs_item_id }],
//             employees, pending, tree_pending }   (the project's WBS; the table keeps its old name)
// POST /api/contract-projects/[id]/work-packages  { name, code?, parent_id?, owner_employee_id?, line_keys?, note? }
//        A WBS item. The code numbers itself (1, 1.1, 1.1.1) unless one is typed (then it is kept when the rest are renumbered), unique on the
//        project. A line sits in one item; lines only on leaves (adding a sub-item under an item that holds lines moves them into it). The owner
//        must be an active employee of this workspace WITH a login (422 `needs_login` otherwise). Structure is editable on any revision of an open
//        project; putting lines in an item in the WBS basis needs the draft (409 `locked`). 201 { id, code }.

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const open = await openAllocation(id, false);
  if (!open.ok) return NextResponse.json({ error: open.error, ...(open.extra ?? {}) }, { status: open.status });
  const { admin, tenantId } = open.req;
  const [packs, employees] = await Promise.all([loadPackages(admin, tenantId, id), loadEmployeeChoices(admin, tenantId)]);
  return NextResponse.json({ packages: packs.packages, employees, pending: packs.pending, tree_pending: packs.treePending === true }, { status: packs.pending ? 503 : 200 });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const open = await openAllocation(id, true);
  if (!open.ok) return NextResponse.json({ error: open.error, ...(open.extra ?? {}) }, { status: open.status });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const work = await workingRevision(open);
  if (!work.ok) return NextResponse.json({ error: work.error, ...(work.extra ?? {}) }, { status: work.status });
  const keys = new Set((await loadLines(open.req.admin, open.req.tenantId, work.work.revision.id)).map((l) => l.line_key));
  const parsed = parseWorkPackage(body, keys, "create");
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
  const made = await createPackage(open, work.work, parsed.value as Parameters<typeof createPackage>[2]);
  if (!made.ok) return NextResponse.json({ error: made.error, ...(made.extra ?? {}) }, { status: made.status });
  return NextResponse.json({ id: made.id, code: made.code }, { status: 201 });
}
