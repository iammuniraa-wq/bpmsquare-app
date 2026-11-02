import { NextResponse, type NextRequest } from "next/server";
import { openBoqRequest } from "@/lib/tender/boq/server";
import { assignLines, wbsCtx } from "@/lib/tender/wbs/server";

// PUT /api/opportunities/[id]/tender/wbs/assign  { boq_ids: string[], wbs_item_id: string | null }
// Group into WBS: puts those BOQ lines into one leaf item (null = Unassigned). A split line in the list is unsplit; the answer says how many.
// Behind gcc_tender + pipeline edit. Every line id must be a line of THIS deal and the item must be an item of THIS deal, else 404.

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openBoqRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  const out = await assignLines(wbsCtx(gate.req), body.boq_ids, body.wbs_item_id ?? null);
  if (!out.ok) return NextResponse.json({ error: out.error, ...(out.extra ?? {}) }, { status: out.status });
  return NextResponse.json({ assigned: out.assigned, unsplit: out.unsplit });
}
