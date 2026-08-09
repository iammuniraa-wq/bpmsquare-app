import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor } from "@/lib/wfm/server";

// PATCH /api/wfm/leave-types/[id] — edit name/active/default annual quota.
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
  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.active === "boolean") patch.active = body.active;

  if (Object.keys(patch).length > 0) {
    const { error } = await admin.from("wfm_leave_types").update(patch).eq("id", id).eq("tenant_id", tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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

  const { data, error } = await admin
    .from("wfm_leave_types").select("id, name, category, active").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}
