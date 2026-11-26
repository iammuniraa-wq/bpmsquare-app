import { NextResponse, type NextRequest } from "next/server";
import { groupsForTender, loadPins, openPinRequest, pinLine, pinnableLines } from "@/lib/drawings/boqPins";

// GET  /api/opportunities/[id]/drawings   the tender's BOQ lines that take a quantity from a drawing (with the "review changes" state), the BOQ
//        lines that can still be pinned, and the element groups of the drawings RELEASED for this tender (a draft or in-review revision is never
//        offered: they are not in the view this reads).
// POST /api/opportunities/[id]/drawings   { boq_line_id, drawing_id, element_code } pins one BOQ line to an element code of the drawing's
//        released revision. The client's own quantity is never touched: the model quantity sits beside it.
// Behind gcc_tender + pipeline (the BOQ's own gate) AND drawing_register; the deal and every id are looked up under THIS workspace.

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const gate = await openPinRequest(id, false);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, tenantId, opp } = gate.req;
  const [{ pins, pending }, lines, { groups }] = await Promise.all([loadPins(admin, tenantId, opp.id), pinnableLines(admin, tenantId, opp.id), groupsForTender(admin, tenantId, opp.id)]);
  return NextResponse.json({ pins, lines, groups, pending });
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const gate = await openPinRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const out = await pinLine(gate.req, body);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ pin: out.pin }, { status: 201 });
}
