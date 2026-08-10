import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor } from "@/lib/wfm/server";

const MAX_EMPLOYEES = 500;

// PATCH /api/wfm/employees/bulk-shift — set (or clear) the STANDING shift
// for many employees in one call. This is the bulk alternative to editing
// employees.shift_id one at a time via PATCH /api/wfm/employees/[id] --
// exists specifically so assigning a shift to a whole roster of employees
// is one action, not one edit per person.
export async function PATCH(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { tenantId } = ctx;

  const body = await request.json().catch(() => null);
  const { employee_ids, shift_id } = (body ?? {}) as { employee_ids?: string[]; shift_id?: string | null };

  if (!Array.isArray(employee_ids) || employee_ids.length === 0) {
    return NextResponse.json({ error: "employee_ids must be a non-empty array" }, { status: 400 });
  }
  if (employee_ids.length > MAX_EMPLOYEES) {
    return NextResponse.json({ error: `Assign at most ${MAX_EMPLOYEES} employees at once` }, { status: 400 });
  }

  const admin = createAdminSupabase();

  if (shift_id) {
    const { data: shift } = await admin
      .from("wfm_shifts").select("id").eq("id", shift_id).eq("tenant_id", tenantId).maybeSingle();
    if (!shift) return NextResponse.json({ error: "Unknown shift" }, { status: 400 });
  }

  // Every id must resolve inside this tenant -- a cross-tenant id here
  // would otherwise silently no-op (the .eq("tenant_id", ...) on the
  // update just wouldn't match it), but we want a loud error instead so
  // a stale/bad id in the request is visible, not silently dropped.
  const { data: found, error: lookupErr } = await admin
    .from("employees").select("id").eq("tenant_id", tenantId).in("id", employee_ids);
  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  if ((found ?? []).length !== employee_ids.length) {
    return NextResponse.json({ error: "One or more employees weren't found in this tenant" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("employees")
    .update({ shift_id: shift_id || null })
    .eq("tenant_id", tenantId)
    .in("id", employee_ids)
    .select("id, shift_id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ updated: data?.length ?? 0 });
}
