import { NextResponse, type NextRequest } from "next/server";
import { openBoqRequest } from "@/lib/tender/boq/server";
import { removeBuilding, tenderEnabled, updateBuilding } from "@/lib/elements/tenderServer";
import { failed, readBody } from "@/lib/elements/respond";

// PATCH  /api/opportunities/[id]/tender/buildings/[itemId]  { name?, code?, reissue?, preview? }
//          The name changes nothing issued. A code change is refused while element codes were issued under the building (409 `used_by`); with
//          `reissue: true` it renames those codes too (not once the tender became a project), as one logged change. `preview: true` writes nothing.
// DELETE the building, only while it holds no lines (409 with the count).
// `itemId` is a WBS item of THIS deal; any other id is a 404.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string; itemId: string }> };

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id, itemId } = await params;
  if (!UUID.test(itemId)) return NextResponse.json({ error: "Building not found" }, { status: 404 });
  const gate = await openBoqRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!(await tenderEnabled(gate.req))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const out = await updateBuilding(gate.req, itemId, { name: body.name, code: body.code, reissue: body.reissue, preview: body.preview });
  if (!out.ok) return failed(out);
  return NextResponse.json({ code: out.code, reissued: out.reissued, ...(out.preview ? { preview: out.preview } : {}) });
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const { id, itemId } = await params;
  if (!UUID.test(itemId)) return NextResponse.json({ error: "Building not found" }, { status: 404 });
  const gate = await openBoqRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!(await tenderEnabled(gate.req))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const out = await removeBuilding(gate.req, itemId);
  if (!out.ok) return failed(out);
  return NextResponse.json({ ok: true });
}
