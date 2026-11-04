import { NextResponse, type NextRequest } from "next/server";
import { buildBoqState, openBoqRequest } from "@/lib/tender/boq/server";
import { createItem, wbsCtx } from "@/lib/tender/wbs/server";
import { unassignedOf } from "@/lib/wbs/tree";

// The WBS of a tender deal (migration 0243; docs/design/wbs.md section 2.8).
// GET   the items in tree order with their owners, each item's roll-up (own lines plus every sub-item), the lines in no item (with the
//       remainder of a split line), and the lines no longer in the latest file. `pending` while migration 0243 is not applied.
// POST  { code?, name, parent_id?, owner_employee_id?, note?, boq_ids? }  a new item; the code numbers itself when absent; boq_ids moves those
//       lines into it. Adding a sub-item under an item that holds lines moves them into the new one.
// Behind gcc_tender + pipeline (edit for a write); a deal that is not a tender of THIS workspace is a 404. Every id in a body is checked against
// this workspace and this deal. A bid-time owner only has to be an active employee: the login is asked for on the project.

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openBoqRequest(id, false);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const state = await buildBoqState(gate.req);
  const unassigned = unassignedOf(state.lines.map((l) => ({ ...l, wbs_item_id: l.wbs_item_id, parts: l.wbs_parts }))).map((u) => ({
    boq_id: u.line.id, item_no: u.line.item_no, description: u.line.description, amount: u.line.priced ? u.line.amount : 0, remainder_pct: u.remainder, split: u.split,
  }));
  const flagged = state.lines.filter((l) => l.removed).map((l) => ({ boq_id: l.id, item_no: l.item_no, description: l.description, wbs_item_id: l.wbs_item_id, wbs_parts: l.wbs_parts }));
  return NextResponse.json({ ...state.wbs, unassigned: state.wbs.pending ? [] : unassigned, flagged: state.wbs.pending ? [] : flagged });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openBoqRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  const out = await createItem(wbsCtx(gate.req), { code: body.code, name: body.name, parent_id: body.parent_id, owner_employee_id: body.owner_employee_id, note: body.note, boq_ids: body.boq_ids });
  if (!out.ok) return NextResponse.json({ error: out.error, ...(out.extra ?? {}) }, { status: out.status });
  return NextResponse.json({ id: out.id, code: out.code, moved: out.moved }, { status: 201 });
}
