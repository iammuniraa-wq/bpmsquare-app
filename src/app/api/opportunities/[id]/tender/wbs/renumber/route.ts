import { NextResponse, type NextRequest } from "next/server";
import { openBoqRequest } from "@/lib/tender/boq/server";
import { renumberItems, wbsCtx } from "@/lib/tender/wbs/server";

// POST /api/opportunities/[id]/tender/wbs/renumber   { all?: boolean }
// Renumber: the auto-numbered codes of the tender's WBS are recomputed (1, 1.1, 1.1.1) and the codes a person typed are kept. With all: true every code
// is recomputed and the typed flag is cleared. The screen asks before calling it.
// Behind gcc_tender + pipeline edit.

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openBoqRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const body = (await request.json().catch(() => null)) as { all?: unknown } | null;
  const out = await renumberItems(wbsCtx(gate.req), { all: body?.all === true });
  if (!out.ok) return NextResponse.json({ error: out.error, ...(out.extra ?? {}) }, { status: out.status });
  return NextResponse.json({ changed: out.changed });
}
