import { NextResponse, type NextRequest } from "next/server";
import { logChange } from "@/lib/changeLog";
import { getAuthUser } from "@/lib/supabase-server";
import { failResponse, jsonBody } from "@/lib/drawings/http";
import { foreignApprovers, normaliseType, openDrawingRequest, TYPE_COLS, UUID_RE } from "@/lib/drawings/server";
import { cleanType } from "@/lib/drawings/typeRules";

// PATCH  (admin) any of the type's fields. Changing the approvers takes effect at once, including for a revision already in review: the list
//        is read at the moment someone presses Release.
// DELETE (admin) only while no drawing uses the type; otherwise 409 and the type is switched off (active: false) instead.

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const gate = await openDrawingRequest({ admin: true });
  if (!gate.ok) return failResponse(gate);
  const { admin, supabase, tenantId, userId } = gate.req;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await jsonBody(request);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const cleaned = cleanType(body, true);
  if (!cleaned.ok) return NextResponse.json({ error: cleaned.error }, { status: 422 });
  if (Object.keys(cleaned.value).length === 0) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  const bad = await foreignApprovers(admin, tenantId, cleaned.value.approver_ids ?? []);
  if (bad.length) return NextResponse.json({ error: "An approver is not a member of this workspace" }, { status: 422 });
  const { data, error } = await admin.from("drawing_types").update({ ...cleaned.value, updated_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", tenantId).select(TYPE_COLS).maybeSingle();
  if (error) return NextResponse.json({ error: error.code === "23505" ? "A drawing type with that name already exists" : error.message }, { status: error.code === "23505" ? 409 : 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const user = await getAuthUser();
  await logChange(supabase, { tenantId, objectType: "drawing_types", objectId: id, objectLabel: (data as { name: string }).name, action: "update", actorId: user?.id ?? userId, actorEmail: user?.email, changes: Object.keys(cleaned.value).map((k) => ({ field: k, from: null, to: (cleaned.value as Record<string, unknown>)[k] })) });
  return NextResponse.json(normaliseType(data as unknown as Record<string, unknown>));
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const gate = await openDrawingRequest({ admin: true });
  if (!gate.ok) return failResponse(gate);
  const { admin, supabase, tenantId, userId } = gate.req;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: type } = await admin.from("drawing_types").select("id, name").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!type) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { count } = await admin.from("drawings").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("type_id", id);
  if ((count ?? 0) > 0) return NextResponse.json({ error: "Drawings use this type. Switch it off instead of deleting it" }, { status: 409 });
  const { error } = await admin.from("drawing_types").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const user = await getAuthUser();
  await logChange(supabase, { tenantId, objectType: "drawing_types", objectId: id, objectLabel: (type as { name: string }).name, action: "delete", actorId: user?.id ?? userId, actorEmail: user?.email });
  return new NextResponse(null, { status: 204 });
}
