import { NextResponse, type NextRequest } from "next/server";
import { allocationView, parseLineAllocation, parsePackageAllocation } from "@/lib/contractProjects/allocation";
import { draftRevision, fillAvailable, openAllocation, putLineAllocation, putPackageAllocation } from "@/lib/contractProjects/allocationServer";
import { readMarginFloor } from "@/lib/contractProjects/budget";
import { currentRevision, loadLines, loadRevision, loadRevisions, UUID_RE } from "@/lib/contractProjects/server";
import { loadEmployeeChoices, loadPackages } from "@/lib/contractProjects/workPackagesServer";
import { getTenant } from "@/lib/tenant";

// GET /api/contract-projects/[id]/allocation?revision=<id>
//        -> { revision, allocation: { basis, lineRows, packageRows, totals, margin, unassigned, warnings }, packages, packages_pending,
//             employees: [{ id, name, code, email, has_login }], fill_available }
// PUT /api/contract-projects/[id]/allocation
//        line mode    { revision_id, basis_rows: [{ line_key, amount: number | null }] }
//        package mode { revision_id, packages: [{ id, allocated_cost: number | null }] }
//      The cost allocated to each BOQ line (or to each work package, spread over its lines in proportion to what the client pays). null clears
//      it. Only the project's DRAFT revision: an approved or waiting budget answers 409 `locked`. The amount of a line, the revision total and
//      the margin are the server's. 200 { total }.
// The margin is the contract value less what has been allocated so far; the floor it is read against is the workspace's setting.

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const open = await openAllocation(id, false);
  if (!open.ok) return NextResponse.json({ error: open.error, ...(open.extra ?? {}) }, { status: open.status });
  const { admin, tenantId } = open.req;
  const wanted = new URL(request.url).searchParams.get("revision") ?? "";
  const revision = wanted && UUID_RE.test(wanted) ? await loadRevision(admin, tenantId, id, wanted) : currentRevision((await loadRevisions(admin, tenantId, id)).rows);
  if (!revision) return NextResponse.json({ error: "Revision not found" }, { status: 404 });
  const [lines, packs, employees, tenant] = await Promise.all([loadLines(admin, tenantId, revision.id), loadPackages(admin, tenantId, id), loadEmployeeChoices(admin, tenantId), getTenant()]);
  return NextResponse.json({
    revision, allocation: allocationView(open.project, lines, packs.packages, readMarginFloor(tenant?.config)), packages: packs.packages, packages_pending: packs.pending,
    employees, fill_available: fillAvailable(open.project, lines),
  });
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const open = await openAllocation(id, true);
  if (!open.ok) return NextResponse.json({ error: open.error, ...(open.extra ?? {}) }, { status: open.status });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  if (typeof body.revision_id !== "string" || !UUID_RE.test(body.revision_id)) return NextResponse.json({ error: "revision_id is required" }, { status: 400 });
  const draft = await draftRevision(open, body.revision_id);
  if (!draft.ok) return NextResponse.json({ error: draft.error, ...(draft.extra ?? {}) }, { status: draft.status });

  if (open.project.allocation_basis === "package") {
    const parsed = parsePackageAllocation(body.packages);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
    const done = await putPackageAllocation(open, draft.revision, parsed.rows);
    if (!done.ok) return NextResponse.json({ error: done.error, ...(done.extra ?? {}) }, { status: done.status });
    return NextResponse.json({ ok: true, total: done.total });
  }
  const parsed = parseLineAllocation(body.basis_rows);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
  const done = await putLineAllocation(open, draft.revision, parsed.rows);
  if (!done.ok) return NextResponse.json({ error: done.error, ...(done.extra ?? {}) }, { status: done.status });
  return NextResponse.json({ ok: true, total: done.total });
}
