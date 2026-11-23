import { NextResponse, type NextRequest } from "next/server";
import { openBoqRequest } from "@/lib/tender/boq/server";
import { addBuilding, tenderBuildings, tenderEnabled } from "@/lib/elements/tenderServer";
import { failed, readBody } from "@/lib/elements/respond";

// The Buildings view of a tender deal (migration 0253; docs/design/pcbs-buildings-elements.md).
// GET   the buildings (level-1 WBS items with a code), the element table, the types and the pattern. `{ enabled: false }` when the workspace does
//       not own the Contract projects module (the screen then shows nothing); `pending` while 0253 is not applied.
// POST  { name, code } or { common: true }  a new building. 201 { id, code }.
// Behind gcc_tender + pipeline (edit for a write); a deal that is not a tender of THIS workspace is a 404.

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openBoqRequest(id, false);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!(await tenderEnabled(gate.req))) return NextResponse.json({ enabled: false });
  const out = await tenderBuildings(gate.req);
  if (!out.ok) return failed(out);
  return NextResponse.json(out.data);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openBoqRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!(await tenderEnabled(gate.req))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const made = await addBuilding(gate.req, { name: body.name, code: body.code, common: body.common });
  if (!made.ok) return failed(made);
  return NextResponse.json({ id: made.id, code: made.code }, { status: 201 });
}
