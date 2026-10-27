import { NextResponse, type NextRequest } from "next/server";
import { parseGroup } from "@/lib/supplierGroups/rules";
import { deleteGroup, loadGroup, loadGroups, openGroupRequest, updateGroup } from "@/lib/supplierGroups/server";

// GET    /api/supplier-groups/[id]            -> { group: { ...as listed by GET /api/supplier-groups } }
// PATCH  /api/supplier-groups/[id]            { name?, account_id?, note?, active?, supplier_ids? }  -> { group }
//          account_id null unlinks the client; supplier_ids (when sent) REPLACES the members, like PUT .../members.
// DELETE /api/supplier-groups/[id]            Removes the group: the client's tenders then offer every supplier again. -> { ok: true }
// A group of another workspace is a 404, the same as one that does not exist.

type Ctx = { params: Promise<{ id: string }> };

async function view(req: { admin: Parameters<typeof loadGroups>[0]; tenantId: string }, id: string) {
  const { groups } = await loadGroups(req.admin, req.tenantId);
  return groups.find((g) => g.id === id) ?? null;
}

export async function GET(_request: NextRequest, { params }: Ctx) {
  const gate = await openGroupRequest();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  const group = await loadGroup(gate.req.admin, gate.req.tenantId, id);
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ group: await view(gate.req, id) });
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const gate = await openGroupRequest({ write: true });
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  const group = await loadGroup(gate.req.admin, gate.req.tenantId, id);
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = parseGroup(await request.json().catch(() => null), "update");
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
  const made = await updateGroup(gate.req, group, parsed.value);
  if (!made.ok) return NextResponse.json({ error: made.error, ...(made.extra ?? {}) }, { status: made.status });
  return NextResponse.json({ group: await view(gate.req, id) });
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const gate = await openGroupRequest({ write: true });
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  const group = await loadGroup(gate.req.admin, gate.req.tenantId, id);
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const done = await deleteGroup(gate.req, group);
  if (!done.ok) return NextResponse.json({ error: done.error }, { status: done.status });
  return NextResponse.json({ ok: true });
}
