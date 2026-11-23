import { NextResponse, type NextRequest } from "next/server";
import { openBoqRequest } from "@/lib/tender/boq/server";
import { setLineElement, tenderEnabled } from "@/lib/elements/tenderServer";
import { failed, readBody } from "@/lib/elements/respond";

// PATCH /api/opportunities/[id]/tender/elements/[lineId]  { element_type?, element_code?, model_qty? }
//   One BOQ line's element fields. The type must be in the workspace's Element types list; a typed code is upper-cased, checked and unique on the
//   deal (409). A line split across buildings cannot carry a code; a type cannot change under an issued code. `lineId` is a BOQ row of THIS deal.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; lineId: string }> }) {
  const { id, lineId } = await params;
  if (!UUID.test(lineId)) return NextResponse.json({ error: "Line not found" }, { status: 404 });
  const gate = await openBoqRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!(await tenderEnabled(gate.req))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const out = await setLineElement(gate.req, lineId, body);
  if (!out.ok) return failed(out);
  return NextResponse.json({ ok: true });
}
