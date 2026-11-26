import { NextResponse, type NextRequest } from "next/server";
import { logChange } from "@/lib/changeLog";
import { getAuthUser } from "@/lib/supabase-server";
import { failResponse, jsonBody } from "@/lib/drawings/http";
import { ensureDefaultType, foreignApprovers, isMissingSchema, listTypes, normaliseType, openDrawingRequest, TYPE_COLS } from "@/lib/drawings/server";
import { cleanType } from "@/lib/drawings/typeRules";
import { listMembersForPicker } from "@/lib/sales/opportunityServer";

// GET  /api/settings/drawing-types   the workspace's drawing types (the default "Drawing" is made on first use) and, for an admin, the members
//        who can be named approvers. Any member who can open Engineering may read; only an admin writes.
// POST /api/settings/drawing-types   (admin) { name, numbering_pattern?, rev_scheme?, approver_ids?, second_person?, required_fields?, feeds?, active? }
//        Approvers are checked against THIS workspace's own members before they are stored.

export async function GET() {
  const gate = await openDrawingRequest();
  if (!gate.ok) return failResponse(gate);
  const { admin, tenantId, role } = gate.req;
  await ensureDefaultType(admin, tenantId);
  const { rows, pending } = await listTypes(admin, tenantId);
  if (pending) return failResponse({ status: 503, error: "A database update is needed before the drawing register can be used.", extra: { needsDatabaseUpdate: true } });
  const members = role === "admin" ? (await listMembersForPicker(admin, tenantId)).map((m) => ({ user_id: m.user_id, name: m.name ?? m.email ?? "Member" })) : [];
  return NextResponse.json({ types: rows, members });
}

export async function POST(request: NextRequest) {
  const gate = await openDrawingRequest({ admin: true });
  if (!gate.ok) return failResponse(gate);
  const { admin, supabase, tenantId, userId } = gate.req;
  const body = await jsonBody(request);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const cleaned = cleanType(body, false);
  if (!cleaned.ok) return NextResponse.json({ error: cleaned.error }, { status: 422 });
  const bad = await foreignApprovers(admin, tenantId, cleaned.value.approver_ids ?? []);
  if (bad.length) return NextResponse.json({ error: "An approver is not a member of this workspace" }, { status: 422 });
  const { data, error } = await admin.from("drawing_types").insert({ tenant_id: tenantId, ...cleaned.value }).select(TYPE_COLS).single();
  if (error || !data) {
    if (error && isMissingSchema(error)) return failResponse({ status: 503, error: "A database update is needed before the drawing register can be used.", extra: { needsDatabaseUpdate: true } });
    return NextResponse.json({ error: error?.code === "23505" ? "A drawing type with that name already exists" : (error?.message ?? "Could not save") }, { status: error?.code === "23505" ? 409 : 500 });
  }
  const user = await getAuthUser();
  await logChange(supabase, { tenantId, objectType: "drawing_types", objectId: (data as { id: string }).id, objectLabel: String(cleaned.value.name), action: "create", actorId: user?.id ?? userId, actorEmail: user?.email });
  return NextResponse.json(normaliseType(data as unknown as Record<string, unknown>), { status: 201 });
}
