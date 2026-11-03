import { NextResponse, type NextRequest } from "next/server";
import { openAllocation, renumberPackages } from "@/lib/contractProjects/allocationServer";

// POST /api/contract-projects/[id]/work-packages/renumber   { all?: boolean }
// Renumber: the auto-numbered codes of the project's WBS are recomputed (1, 1.1, 1.1.1) and the codes a person typed are kept. With all: true every
// code is recomputed and the typed flag cleared. Codes are structure, so it works on any revision of an open project.

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const open = await openAllocation(id, true);
  if (!open.ok) return NextResponse.json({ error: open.error, ...(open.extra ?? {}) }, { status: open.status });
  if (open.project.status === "closed") return NextResponse.json({ error: "This project is closed", locked: true }, { status: 409 });
  const body = (await request.json().catch(() => null)) as { all?: unknown } | null;
  const done = await renumberPackages(open, { all: body?.all === true });
  if (!done.ok) return NextResponse.json({ error: done.error, ...(done.extra ?? {}) }, { status: done.status });
  return NextResponse.json({ changed: done.changed });
}
