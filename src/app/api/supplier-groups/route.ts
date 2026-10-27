import { NextResponse, type NextRequest } from "next/server";
import { parseGroup } from "@/lib/supplierGroups/rules";
import { createGroup, loadGroups, needsGroupUpdate, openGroupRequest } from "@/lib/supplierGroups/server";

// GET  /api/supplier-groups
//        -> { groups: [{ id, name, account_id, account_name, note, active, member_count, supplier_ids, created_at, updated_at }], pending, can_edit }
// POST /api/supplier-groups  { name, account_id?, note?, active?, supplier_ids? }
//        A client's approved vendor list. account_id (a client account of THIS workspace, one group per client) links it to that client's tender
//        deals and contract projects; supplier_ids are the first members. 201 { group: <as listed above> }; 409 when the name or the client is taken.
// Behind the platform-admin flag gcc_tender plus the Suppliers module and grant: anything else is a 404 and no table is read. While migration
// 0233 is pending: GET answers { groups: [], pending: true } and POST 503 with needsDatabaseUpdate.

export async function GET() {
  const gate = await openGroupRequest();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { groups, pending } = await loadGroups(gate.req.admin, gate.req.tenantId);
  return NextResponse.json({ groups, pending, can_edit: gate.req.canEdit });
}

export async function POST(request: NextRequest) {
  const gate = await openGroupRequest({ write: true });
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const body = await request.json().catch(() => null);
  const parsed = parseGroup(body, "create");
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
  const made = await createGroup(gate.req, parsed.value);
  if (!made.ok) return NextResponse.json({ error: made.error, ...(made.extra ?? {}) }, { status: made.status });
  const { groups, pending } = await loadGroups(gate.req.admin, gate.req.tenantId);
  if (pending) return NextResponse.json({ error: needsGroupUpdate().error, needsDatabaseUpdate: true }, { status: 503 });
  return NextResponse.json({ group: groups.find((g) => g.id === made.group.id) ?? made.group }, { status: 201 });
}
