import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor } from "@/lib/wfm/server";

const CATEGORIES = ["paid", "unpaid", "half_day"];

// GET /api/wfm/leave-types — list, with each type's tenant-default annual quota.
export async function GET() {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { supabase, tenantId } = ctx;

  const [{ data: types, error }, { data: quotas }] = await Promise.all([
    supabase.from("wfm_leave_types").select("id, name, category, active").eq("tenant_id", tenantId).order("name"),
    supabase.from("wfm_leave_quotas").select("leave_type_id, annual_quota").eq("tenant_id", tenantId).is("employee_id", null),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const quotaByType = new Map((quotas ?? []).map((q) => [q.leave_type_id, q.annual_quota]));
  return NextResponse.json((types ?? []).map((t) => ({ ...t, annual_quota: quotaByType.get(t.id) ?? 0 })));
}

// POST /api/wfm/leave-types — create a leave type with its tenant-default quota.
export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (ctx.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { tenantId } = ctx;

  const body = await request.json().catch(() => null);
  const { name, category, annual_quota } = (body ?? {}) as { name?: string; category?: string; annual_quota?: number };
  if (!name?.trim() || !category || !CATEGORIES.includes(category)) {
    return NextResponse.json({ error: "name and a valid category are required" }, { status: 400 });
  }

  const admin = createAdminSupabase();
  const { data: type, error } = await admin
    .from("wfm_leave_types")
    .insert({ tenant_id: tenantId, name: name.trim(), category })
    .select("id, name, category, active")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const quota = typeof annual_quota === "number" && annual_quota >= 0 ? annual_quota : 0;
  const { error: quotaErr } = await admin
    .from("wfm_leave_quotas")
    .insert({ tenant_id: tenantId, leave_type_id: type.id, employee_id: null, annual_quota: quota });
  if (quotaErr) return NextResponse.json({ error: quotaErr.message }, { status: 500 });

  return NextResponse.json({ ...type, annual_quota: quota });
}
