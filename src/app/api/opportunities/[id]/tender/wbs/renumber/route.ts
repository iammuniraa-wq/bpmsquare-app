import { NextResponse, type NextRequest } from "next/server";
import { openBoqRequest } from "@/lib/tender/boq/server";
import { renumberItems, wbsCtx } from "@/lib/tender/wbs/server";

// POST /api/opportunities/[id]/tender/wbs/renumber
// Renumber: every code of the tender's WBS is recomputed (1, 1.1, 1.1.1), the ones a person typed included. The screen asks before calling it.
// Behind gcc_tender + pipeline edit.

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openBoqRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const out = await renumberItems(wbsCtx(gate.req));
  if (!out.ok) return NextResponse.json({ error: out.error, ...(out.extra ?? {}) }, { status: out.status });
  return NextResponse.json({ changed: out.changed });
}
