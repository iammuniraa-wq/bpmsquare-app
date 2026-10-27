import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { diffForLog, logChange } from "@/lib/changeLog";
import { failure, guard, loadTypes, needsUpdate, pending } from "@/lib/salesOrders/server";
import { parseTypeInput } from "@/lib/salesOrders/typeInput";
import { shapeType } from "@/lib/salesOrders/server";

// Order types (Settings > Order types).
//
// GET  /api/sales-order-types  any member of a workspace with Sales Orders: the form needs the list.
//   -> { rows: [{ id, name, prefix, pricing_mode, template: { blocks, accent_color, logo_position }, rules: [{ field, equals }],
//                 is_default, active, sort_order, order_count }], needsDatabaseUpdate? }
// POST /api/sales-order-types  workspace admin only. { name, prefix, pricing_mode?, template?, rules?, is_default?, active?, sort_order? }
//   -> 201 the type. The first type of a workspace is always its default. Writes go through the service role after the
//      admin check, always filtered by the caller's tenant (the table is read-only for members under RLS).

export async function GET() {
  let ctx;
  try { ctx = await guard(); } catch (e) { return failure(e); }
  const { supabase, tenantId } = ctx;
  const { types, pending: missing } = await loadTypes(supabase, tenantId);
  if (missing) return NextResponse.json({ rows: [], needsDatabaseUpdate: true });

  const counts = await Promise.all(types.map(async (t) => {
    const { data } = await supabase.from("sales_orders").select("id").eq("tenant_id", tenantId).eq("type_id", t.id);
    return (data ?? []).length;
  }));
  return NextResponse.json({ rows: types.map((t, i) => ({ ...t, order_count: counts[i] })) });
}

export async function POST(req: NextRequest) {
  let ctx;
  try { ctx = await guard(); } catch (e) { return failure(e); }
  const { tenantId, role } = ctx;
  if (role !== "admin") return NextResponse.json({ error: "Only a workspace admin can change order types" }, { status: 403 });

  const parsed = parseTypeInput(await req.json().catch(() => null), false);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const v = parsed.value;

  const admin = createAdminSupabase();
  const { types, pending: missing } = await loadTypes(admin, tenantId);
  if (missing) return needsUpdate();
  const makeDefault = types.length === 0 || v.is_default === true;
  if (makeDefault && types.some((t) => t.is_default)) {
    await admin.from("sales_order_types").update({ is_default: false, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("is_default", true);
  }

  const { data, error } = await admin.from("sales_order_types").insert({
    tenant_id: tenantId, name: v.name, prefix: v.prefix, pricing_mode: v.pricing_mode ?? "internal",
    template: v.template ?? {}, rules: v.rules ?? [], is_default: makeDefault, active: makeDefault ? true : v.active !== false,
    sort_order: v.sort_order ?? types.length,
  }).select("*").single();
  if (error || !data) {
    if (error?.code === "23505") return NextResponse.json({ error: "An order type with this name already exists" }, { status: 409 });
    return pending(error) ? needsUpdate() : NextResponse.json({ error: error?.message ?? "Could not save the order type" }, { status: 500 });
  }

  const user = await getAuthUser();
  await logChange(admin, {
    tenantId, objectType: "sales_order_types", objectId: data.id as string, objectLabel: v.name ?? null,
    action: "create", actorId: user?.id, actorEmail: user?.email,
    changes: diffForLog("sales_order_types", {}, { name: v.name, prefix: v.prefix, pricing_mode: v.pricing_mode ?? "internal", is_default: makeDefault }),
  });
  return NextResponse.json({ ...shapeType(data as Record<string, unknown>), order_count: 0 }, { status: 201 });
}
