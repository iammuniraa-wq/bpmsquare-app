import { NextResponse, type NextRequest } from "next/server";
import { parseAssign } from "@/lib/contractProjects/allocation";
import { assignLineKeys, openAllocation, workingRevision } from "@/lib/contractProjects/allocationServer";
import { loadLines } from "@/lib/contractProjects/server";

// PUT /api/contract-projects/[id]/work-packages/assign  { line_keys: string[], package_id: string | null }
// Group into WBS: puts those budget lines into one leaf WBS item (null = unassigned). A split line in the list is unsplit; the answer says how many.
// In the WBS basis, which lines an item holds is the allocation, so after the baseline is waiting or approved this answers 409 `locked`.
// The lines must be lines of this project's current revision and the item an item of THIS project, else 404 / 422.

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const open = await openAllocation(id, true);
  if (!open.ok) return NextResponse.json({ error: open.error, ...(open.extra ?? {}) }, { status: open.status });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const work = await workingRevision(open);
  if (!work.ok) return NextResponse.json({ error: work.error, ...(work.extra ?? {}) }, { status: work.status });
  const keys = new Set((await loadLines(open.req.admin, open.req.tenantId, work.work.revision.id)).map((l) => l.line_key));
  const parsed = parseAssign(body, keys);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
  const done = await assignLineKeys(open, work.work, parsed.line_keys, parsed.package_id);
  if (!done.ok) return NextResponse.json({ error: done.error, ...(done.extra ?? {}) }, { status: done.status });
  return NextResponse.json({ assigned: done.assigned, unsplit: done.unsplit });
}
