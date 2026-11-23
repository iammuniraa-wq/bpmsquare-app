import { NextResponse, type NextRequest } from "next/server";
import { openAllocation } from "@/lib/contractProjects/allocationServer";
import { UUID_RE } from "@/lib/contractProjects/server";
import { removeBuilding, updateBuilding } from "@/lib/elements/projectServer";
import { failed, readBody, NOT_FOUND } from "@/lib/elements/respond";
import { buildingsOn } from "@/lib/elements/server";

// PATCH  /api/contract-projects/[id]/buildings/[itemId]  { name?, code?, reissue?, preview? }
//          The name changes nothing issued. A code change is refused while element codes were issued under the building (409, `used_by`); with
//          `reissue: true` it renames those codes too, but only before a baseline is approved and before anything reached the ERP, as one
//          logged change. `preview: true` returns the old to new list and writes nothing.
// DELETE the building, only while it holds no lines (409 with the count: it moves nothing).
// `itemId` is the WBS item of THIS project; any other id is a 404.

type Ctx = { params: Promise<{ id: string; itemId: string }> };

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id, itemId } = await params;
  if (!UUID_RE.test(itemId)) return NextResponse.json({ error: "Building not found" }, { status: 404 });
  const open = await openAllocation(id, true);
  if (!open.ok) return failed(open);
  if (!(await buildingsOn(open.req.supabase, open.req.tenantId))) return NOT_FOUND();
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const out = await updateBuilding(open, itemId, { name: body.name, code: body.code, reissue: body.reissue, preview: body.preview });
  if (!out.ok) return failed(out);
  return NextResponse.json({ code: out.code, reissued: out.reissued, ...(out.preview ? { preview: out.preview } : {}) });
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const { id, itemId } = await params;
  if (!UUID_RE.test(itemId)) return NextResponse.json({ error: "Building not found" }, { status: 404 });
  const open = await openAllocation(id, true);
  if (!open.ok) return failed(open);
  if (!(await buildingsOn(open.req.supabase, open.req.tenantId))) return NOT_FOUND();
  const out = await removeBuilding(open, itemId);
  if (!out.ok) return failed(out);
  return NextResponse.json({ ok: true });
}
