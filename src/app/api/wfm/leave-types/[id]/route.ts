import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { requireWfmSupervisor } from "@/lib/wfm/server";
import { parseLeaveTypeLimits, LEAVE_TYPE_NEW_COLUMNS_RE } from "@/lib/wfm/leaveTypeInput";
import { logChange } from "@/lib/changeLog";

const CATEGORIES = ["paid", "unpaid", "half_day"];

// PATCH /api/wfm/leave-types/[id] — edit name / category / active / default
// annual quota / monthly limit / paid days per month (0109).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (ctx.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { tenantId } = ctx;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const admin = createAdminSupabase();
  const { data: before } = await admin.from("wfm_leave_types").select("id, name, category, active").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.active === "boolean") patch.active = body.active;
  if (typeof body.category === "string") {
    if (!CATEGORIES.includes(body.category)) return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    patch.category = body.category;
  }
  const limits = parseLeaveTypeLimits(body);
  if ("error" in limits) return NextResponse.json({ error: limits.error }, { status: 400 });
  Object.assign(patch, limits.patch);

  if (Object.keys(patch).length > 0) {
    const upd = await admin.from("wfm_leave_types").update(patch).eq("id", id).eq("tenant_id", tenantId);
    if (upd.error && LEAVE_TYPE_NEW_COLUMNS_RE.test(upd.error.message)) {
      return NextResponse.json({ error: "Quota period and monthly limits need migrations 0109 and 0112 applied to this database." }, { status: 503 });
    }
    if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 });
  }

  if (typeof body.annual_quota === "number" && body.annual_quota >= 0) {
    const { data: existing } = await admin
      .from("wfm_leave_quotas").select("id").eq("tenant_id", tenantId).eq("leave_type_id", id).is("employee_id", null).maybeSingle();
    if (existing) {
      await admin.from("wfm_leave_quotas").update({ annual_quota: body.annual_quota }).eq("id", existing.id).eq("tenant_id", tenantId);
    } else {
      await admin.from("wfm_leave_quotas").insert({ tenant_id: tenantId, leave_type_id: id, employee_id: null, annual_quota: body.annual_quota });
    }
  }

  const user = await getAuthUser();
  const changes = Object.entries(patch).map(([field, to]) => ({ field, from: (before as Record<string, unknown>)[field] ?? null, to: to as string | number | boolean | null }));
  if (typeof body.annual_quota === "number") changes.push({ field: "annual_quota", from: null, to: body.annual_quota });
  if (changes.length > 0) {
    await logChange(admin, { tenantId, objectType: "wfm_leave_types", objectId: id, objectLabel: (patch.name as string) ?? before.name, action: "update", actorId: ctx.userId, actorEmail: user?.email ?? null, changes });
  }

  let sel = await admin.from("wfm_leave_types").select("id, name, category, active, monthly_limit, paid_days_per_month, quota_period").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (sel.error && LEAVE_TYPE_NEW_COLUMNS_RE.test(sel.error.message)) {
    sel = (await admin.from("wfm_leave_types").select("id, name, category, active").eq("id", id).eq("tenant_id", tenantId).maybeSingle()) as typeof sel;
  }
  if (sel.error) return NextResponse.json({ error: sel.error.message }, { status: 500 });
  if (!sel.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(sel.data);
}

// DELETE /api/wfm/leave-types/[id] — only a type nothing refers to. A type
// with leave records or requests behind it is deactivated instead (the
// screen offers that); history must keep pointing at a real type.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (ctx.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { tenantId } = ctx;
  const { id } = await params;
  const admin = createAdminSupabase();

  const { data: type } = await admin.from("wfm_leave_types").select("id, name").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!type) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [{ count: records }, { count: requests }] = await Promise.all([
    admin.from("wfm_leave_records").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("leave_type_id", id),
    admin.from("wfm_leave_requests").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("leave_type_id", id),
  ]);
  if ((records ?? 0) > 0 || (requests ?? 0) > 0) {
    return NextResponse.json({
      error: `"${type.name}" is in use (${records ?? 0} leave record${records === 1 ? "" : "s"}, ${requests ?? 0} request${requests === 1 ? "" : "s"}). Deactivate it instead, or remove those records first.`,
      records: records ?? 0, requests: requests ?? 0,
    }, { status: 409 });
  }

  // Quotas cascade with the type; nothing else refers to it.
  const { error } = await admin.from("wfm_leave_types").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const user = await getAuthUser();
  await logChange(admin, { tenantId, objectType: "wfm_leave_types", objectId: id, objectLabel: type.name as string, action: "delete", actorId: ctx.userId, actorEmail: user?.email ?? null });
  return new NextResponse(null, { status: 204 });
}
