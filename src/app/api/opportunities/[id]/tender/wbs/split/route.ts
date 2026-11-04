import { NextResponse, type NextRequest } from "next/server";
import { openBoqRequest } from "@/lib/tender/boq/server";
import { setLineSplit, unsplitLine, wbsCtx } from "@/lib/tender/wbs/server";

// PUT    /api/opportunities/[id]/tender/wbs/split  { boq_id, parts: [{ wbs_item_id | new: { name, parent_id? }, share_pct }] }
//        A line's split, written as one set. The shares must add up to 100 (within 0.01); every part names a leaf, no item twice. A set of one
//        part is the line sitting whole in that item. A `new` part makes the item on the spot (auto-coded) once the shares have been accepted.
// DELETE { boq_id, wbs_item_id? }  Unsplit: the whole line goes to the named item, else to the item of its first part.
// Behind gcc_tender + pipeline edit. The line and every item must belong to THIS deal and workspace, else 404.

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openBoqRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || typeof body.boq_id !== "string") return NextResponse.json({ error: "boq_id is required" }, { status: 400 });
  const out = await setLineSplit(wbsCtx(gate.req), body.boq_id, body.parts);
  if (!out.ok) return NextResponse.json({ error: out.error, ...(out.extra ?? {}) }, { status: out.status });
  return NextResponse.json({ kind: out.kind, parts: out.parts, created: out.created });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openBoqRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || typeof body.boq_id !== "string") return NextResponse.json({ error: "boq_id is required" }, { status: 400 });
  const out = await unsplitLine(wbsCtx(gate.req), body.boq_id, body.wbs_item_id);
  if (!out.ok) return NextResponse.json({ error: out.error, ...(out.extra ?? {}) }, { status: out.status });
  return NextResponse.json({ wbs_item_id: out.wbs_item_id });
}
