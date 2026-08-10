import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor } from "@/lib/wfm/server";

const MAX_EMPLOYEES = 500;

// PATCH /api/wfm/employees/bulk-site — set (or clear) the home SITE for
// many employees in one call. Same shape and purpose as bulk-shift: the
// bulk alternative to editing employees.site_id one employee at a time.
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
  const { employee_ids, site_id } = (body ?? {}) as { employee_ids?: string[]; site_id?: string | null };

  if (!Array.isArray(employee_ids) || employee_ids.length === 0) {
    return NextResponse.json({ error: "employee_ids must be a non-empty array" }, { status: 400 });
  }
  if (employee_ids.length > MAX_EMPLOYEES) {
    return NextResponse.json({ error: `Assign at most ${MAX_EMPLOYEES} employees at once` }, { status: 400 });
  }

  const admin = createAdminSupabase();

  if (site_id) {
    const { data: site } = await admin
      .from("wfm_sites").select("id").eq("id", site_id).eq("tenant_id", tenantId).maybeSingle();
    if (!site) return NextResponse.json({ error: "Unknown site" }, { status: 400 });
  }

  const { data: found, error: lookupErr } = await admin
    .from("employees").select("id").eq("tenant_id", tenantId).in("id", employee_ids);
  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  if ((found ?? []).length !== employee_ids.length) {
    return NextResponse.json({ error: "One or more employees weren't found in this tenant" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("employees")
    .update({ site_id: site_id || null })
    .eq("tenant_id", tenantId)
    .in("id", employee_ids)
    .select("id, site_id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ updated: data?.length ?? 0 });
}
