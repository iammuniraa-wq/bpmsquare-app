import { NextResponse, type NextRequest } from "next/server";
import { parseMembers } from "@/lib/supplierGroups/rules";
import { loadGroup, openGroupRequest, setGroupMembers } from "@/lib/supplierGroups/server";

// PUT /api/supplier-groups/[id]/members  { supplier_ids: string[] }
//   Replaces the members of the group with exactly these suppliers (an empty list empties it, which lifts the restriction). Every id must be a
//   supplier of THIS workspace (404 otherwise). -> { ok: true, added: string[], removed: string[], member_count }

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Ctx) {
  const gate = await openGroupRequest({ write: true });
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  const group = await loadGroup(gate.req.admin, gate.req.tenantId, id);
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = parseMembers(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
  const done = await setGroupMembers(gate.req, group, parsed.value);
  if (!done.ok) return NextResponse.json({ error: done.error, ...(done.extra ?? {}) }, { status: done.status });
  return NextResponse.json({ ok: true, added: done.added, removed: done.removed, member_count: parsed.value.length });
}
