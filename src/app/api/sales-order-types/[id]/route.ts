import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { diffForLog, logChange } from "@/lib/changeLog";
import { failure, guard, needsUpdate, pending, shapeType } from "@/lib/salesOrders/server";
import { parseTypeInput } from "@/lib/salesOrders/typeInput";

// PATCH  /api/sales-order-types/[id]  workspace admin only; any of name, prefix, pricing_mode, template, rules, is_default,
//        active, sort_order. A workspace always keeps one default type, and the default is always switched on: make another
//        type the default instead of unsetting it. Changing the prefix only affects orders made afterwards.
// DELETE /api/sales-order-types/[id]  admin only. A type that has orders is switched off (deactivated), never deleted; a type
//        with none is deleted. The default type can be neither. -> { deleted: true } or { deactivated: true, type }.

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  let ctx;
  try { ctx = await guard(); } catch (e) { return failure(e); }
  const { tenantId, role } = ctx;
  if (role !== "admin") return NextResponse.json({ error: "Only a workspace admin can change order types" }, { status: 403 });
  const { id } = await params;

  const parsed = parseTypeInput(await req.json().catch(() => null), true);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const v = parsed.value;
  if (Object.keys(v).length === 0) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });

  const admin = createAdminSupabase();
  const { data: before, error: readErr } = await admin.from("sales_order_types").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (readErr) return pending(readErr) ? needsUpdate() : NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const current = shapeType(before as Record<string, unknown>);

  if (current.is_default && v.is_default === false) return NextResponse.json({ error: "A workspace always has a default order type. Make another type the default instead." }, { status: 422 });
  if (current.is_default && v.active === false) return NextResponse.json({ error: "The default order type can't be switched off. Make another type the default first." }, { status: 422 });

  const patch: Record<string, unknown> = { ...v, updated_at: new Date().toISOString() };
  if (v.is_default === true && !current.is_default) {
    await admin.from("sales_order_types").update({ is_default: false, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("is_default", true);
    patch.active = true;
  }

  const { data, error } = await admin.from("sales_order_types").update(patch).eq("id", id).eq("tenant_id", tenantId).select("*").single();
  if (error || !data) {
    if (error?.code === "23505") return NextResponse.json({ error: "An order type with this name already exists" }, { status: 409 });
    return NextResponse.json({ error: error?.message ?? "Could not save the order type" }, { status: 500 });
  }

  const { updated_at: _u, ...diffPatch } = patch;
  const changes = diffForLog("sales_order_types", before as Record<string, unknown>, diffPatch);
  if (changes.length > 0) {
    const user = await getAuthUser();
    await logChange(admin, { tenantId, objectType: "sales_order_types", objectId: id, objectLabel: current.name, action: "update", actorId: user?.id, actorEmail: user?.email, changes });
  }
  return NextResponse.json(shapeType(data as Record<string, unknown>));
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  let ctx;
  try { ctx = await guard(); } catch (e) { return failure(e); }
  const { tenantId, role } = ctx;
  if (role !== "admin") return NextResponse.json({ error: "Only a workspace admin can change order types" }, { status: 403 });
  const { id } = await params;

  const admin = createAdminSupabase();
  const { data: before, error: readErr } = await admin.from("sales_order_types").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (readErr) return pending(readErr) ? needsUpdate() : NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const current = shapeType(before as Record<string, unknown>);
  if (current.is_default) return NextResponse.json({ error: "The default order type can't be removed. Make another type the default first." }, { status: 422 });

  const { data: used } = await admin.from("sales_orders").select("id").eq("tenant_id", tenantId).eq("type_id", id).limit(1);
  const user = await getAuthUser();
  if ((used ?? []).length > 0) {
    const { data, error } = await admin.from("sales_order_types").update({ active: false, updated_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", tenantId).select("*").single();
    if (error || !data) return NextResponse.json({ error: error?.message ?? "Could not switch the order type off" }, { status: 500 });
    await logChange(admin, { tenantId, objectType: "sales_order_types", objectId: id, objectLabel: current.name, action: "update", actorId: user?.id, actorEmail: user?.email, changes: [{ field: "active", from: current.active, to: false }] });
    return NextResponse.json({ deactivated: true, type: shapeType(data as Record<string, unknown>) });
  }

  const { error } = await admin.from("sales_order_types").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logChange(admin, { tenantId, objectType: "sales_order_types", objectId: id, objectLabel: current.name, action: "delete", actorId: user?.id, actorEmail: user?.email });
  return NextResponse.json({ deleted: true });
}
