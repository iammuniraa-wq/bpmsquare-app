import { NextResponse, type NextRequest } from "next/server";
import { draftRevision, fillFromTender, openAllocation } from "@/lib/contractProjects/allocationServer";

// POST /api/contract-projects/[id]/allocation/fill  { replace?: boolean }
//      Copies the costs RECORDED on the project's tender into the allocation, once, never an estimated figure: the cost frozen with the
//      winning bid version, else the tender's BOQ rows. A line with no recorded cost is listed, not filled. By line, each line takes its cost;
//      by work package, each package takes the sum of its lines' costs and spreads it. A line (or package) that already has an allocation is
//      kept unless `replace` is true. The tender is the project's own source_opportunity_id, never read from the request.
//      200 { filled, skipped: [{ item, reason }], total }.

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const open = await openAllocation(id, true);
  if (!open.ok) return NextResponse.json({ error: open.error, ...(open.extra ?? {}) }, { status: open.status });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown> | null;
  const draft = await draftRevision(open, null);
  if (!draft.ok) return NextResponse.json({ error: draft.error, ...(draft.extra ?? {}) }, { status: draft.status });
  const done = await fillFromTender(open, draft.revision, body?.replace === true);
  if (!done.ok) return NextResponse.json({ error: done.error, ...(done.extra ?? {}) }, { status: done.status });
  return NextResponse.json({ filled: done.filled, skipped: done.skipped, total: done.total });
}
