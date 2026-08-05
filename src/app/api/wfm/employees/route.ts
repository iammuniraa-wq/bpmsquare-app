import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor } from "@/lib/wfm/server";

// The WFM view over the shared `employees` master-data table (see
// 0062_wfm_module.sql — WFM extends it rather than owning a parallel one).

// GET /api/wfm/employees — list employees with WFM fields, shift/site names
// and login status (supervisor/admin).
export async function GET() {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { supabase, tenantId } = ctx;

  const [{ data: employees, error }, { data: memberships }] = await Promise.all([
    supabase
      .from("employees")
      .select(
        "id, employee_code, first_name, last_name, phone, status, employment_type, wfm_role, shift_id, site_id, consent_recorded_at, wfm_shifts(name), wfm_sites(name)"
      )
      .eq("tenant_id", tenantId)
      .order("employee_code"),
    supabase
      .from("tenant_users")
      .select("employee_id, user_id")
      .eq("tenant_id", tenantId)
      .not("employee_id", "is", null),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const linked = new Set((memberships ?? []).map((m) => m.employee_id));
  return NextResponse.json(
    (employees ?? []).map((e) => ({ ...e, has_login: linked.has(e.id) }))
  );
}

// POST /api/wfm/employees — create an employee record (supervisor/admin).
export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { tenantId } = ctx;

  const body = await request.json().catch(() => null);
  const { employee_code, first_name, last_name, phone, employment_type, shift_id, site_id, wfm_role } =
    (body ?? {}) as {
      employee_code?: string; first_name?: string; last_name?: string; phone?: string;
      employment_type?: string; shift_id?: string; site_id?: string; wfm_role?: string;
    };

  if (!employee_code?.trim() || !first_name?.trim()) {
    return NextResponse.json({ error: "employee_code and first_name are required" }, { status: 400 });
  }
  if (employment_type && !["full_time", "contractor"].includes(employment_type)) {
    return NextResponse.json({ error: "Invalid employment_type" }, { status: 400 });
  }
  if (wfm_role && !["employee", "supervisor"].includes(wfm_role)) {
    return NextResponse.json({ error: "Invalid wfm_role" }, { status: 400 });
  }

  const admin = createAdminSupabase();

  // Client-supplied foreign ids must resolve inside this tenant.
  if (shift_id) {
    const { data: shift } = await admin
      .from("wfm_shifts").select("id").eq("id", shift_id).eq("tenant_id", tenantId).maybeSingle();
    if (!shift) return NextResponse.json({ error: "Unknown shift" }, { status: 400 });
  }
  if (site_id) {
    const { data: site } = await admin
      .from("wfm_sites").select("id").eq("id", site_id).eq("tenant_id", tenantId).maybeSingle();
    if (!site) return NextResponse.json({ error: "Unknown site" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("employees")
    .insert({
      tenant_id: tenantId,
      employee_code: employee_code.trim(),
      first_name: first_name.trim(),
      last_name: last_name?.trim() ?? "",
      phone: phone?.trim() || null,
      employment_type: employment_type ?? "full_time",
      shift_id: shift_id || null,
      site_id: site_id || null,
      wfm_role: wfm_role ?? "employee",
    })
    .select("id, employee_code, first_name, last_name, employment_type, wfm_role, status")
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "Employee code already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}
