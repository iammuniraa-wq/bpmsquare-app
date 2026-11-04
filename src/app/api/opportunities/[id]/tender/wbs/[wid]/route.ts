import { NextResponse, type NextRequest } from "next/server";
import { openBoqRequest } from "@/lib/tender/boq/server";
import { deleteItem, updateItem, wbsCtx } from "@/lib/tender/wbs/server";

// PATCH  /api/opportunities/[id]/tender/wbs/[wid]  { code?, name?, parent_id?, owner_employee_id?, note?, sort_order? }
//        A typed code is kept when the rest are renumbered. A move that would sit under itself, go deeper than three levels or land under an item
//        that holds lines is refused with the reason.
// DELETE the item: its whole lines go back to Unassigned, its parts go with it (each split line shows an unassigned remainder), its sub-items
//        move up one level and the auto codes close up.
// Behind gcc_tender + pipeline edit; the item is looked up under THIS deal and workspace, so another deal's id is a 404.

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; wid: string }> }) {
  const { id, wid } = await params;
  const gate = await openBoqRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  const input: Record<string, unknown> = {};
  for (const k of ["code", "name", "parent_id", "owner_employee_id", "note", "sort_order"]) if (k in body) input[k] = body[k];
  const out = await updateItem(wbsCtx(gate.req), wid, input);
  if (!out.ok) return NextResponse.json({ error: out.error, ...(out.extra ?? {}) }, { status: out.status });
  return NextResponse.json({ code: out.code });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; wid: string }> }) {
  const { id, wid } = await params;
  const gate = await openBoqRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const out = await deleteItem(wbsCtx(gate.req), wid);
  if (!out.ok) return NextResponse.json({ error: out.error, ...(out.extra ?? {}) }, { status: out.status });
  return NextResponse.json({ lines: out.lines, parts: out.parts });
}
