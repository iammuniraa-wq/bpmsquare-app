import { NextResponse } from "next/server";
import { draftRevision, fillFromEstimate, openAllocation } from "@/lib/contractProjects/allocationServer";

// POST /api/contract-projects/[id]/allocation/fill-estimate
//      For a project made from a standard quote that was assembled from an estimate: copies the estimate's cost onto the DRAFT budget by cost
//      category (materials, moulds, labour, erection, other). A quote line stays one contract line; its cost becomes one budget line per
//      category. A quote line that cannot be matched by name is left as it is and listed. Pressing it again replaces what it wrote and keeps
//      every line a person changed. The estimate is the project's own quote's, never read from the request. A locked revision (waiting or
//      approved) is refused with 409. 200 { filled, categories, skipped: [{ item, reason }], total }.

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const open = await openAllocation(id, true);
  if (!open.ok) return NextResponse.json({ error: open.error, ...(open.extra ?? {}) }, { status: open.status });
  const draft = await draftRevision(open, null);
  if (!draft.ok) return NextResponse.json({ error: draft.error, ...(draft.extra ?? {}) }, { status: draft.status });
  const done = await fillFromEstimate(open, draft.revision);
  if (!done.ok) return NextResponse.json({ error: done.error, ...(done.extra ?? {}) }, { status: done.status });
  return NextResponse.json({ filled: done.filled, categories: done.categories, skipped: done.skipped, total: done.total });
}
