import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor, getWfmConfig } from "@/lib/wfm/server";
import { wfmEmployeesPayload } from "@/lib/wfm/bootstrap";
import { generateEmployeeCode } from "@/lib/wfm/employeeCode";
import { resolveWfmScope } from "@/lib/wfm/scope";

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
  try {
    const scope = await resolveWfmScope(ctx);
    const rows = await wfmEmployeesPayload(ctx.supabase, ctx.tenantId);
    if (scope.unrestricted) return NextResponse.json(rows);
    // A supervisor's own record is included here even though it is not in
    // their subtree -- they need to see themselves on the Employees screen;
    // they simply can't APPROVE their own requests (see canApproveFor).
    const visible = new Set([...(scope.employeeIds ?? []), scope.selfEmployeeId].filter(Boolean) as string[]);
    return NextResponse.json(rows.filter((r: { id: string }) => visible.has(r.id)));
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
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

  // employee_code is now OPTIONAL: left blank, the next EMP-#### is generated.
  // Supplied, the tenant's own scheme wins -- plenty of workplaces already
  // number people by payroll or biometric id.
  if (!first_name?.trim()) {
    return NextResponse.json({ error: "first_name is required" }, { status: 400 });
  }
  // Validated against the TENANT's configured list, not a hardcoded enum --
  // employment types are tenant-editable (Settings -> Workforce).
  const cfg = await getWfmConfig(createAdminSupabase(), ctx.tenantId);
  const validTypes = cfg.employment_types.map((t) => t.code);
  if (employment_type && !validTypes.includes(employment_type)) {
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

  const base = {
    tenant_id: tenantId,
    first_name: first_name.trim(),
    last_name: last_name?.trim() ?? "",
    phone: phone?.trim() || null,
    employment_type: employment_type ?? validTypes[0],
    shift_id: shift_id || null,
    site_id: site_id || null,
    wfm_role: wfm_role ?? "employee",
  };
  const supplied = employee_code?.trim();

  // Retry only when we generated the code: two concurrent creates can probe
  // the same free number, and the unique index turns that race into a clean
  // 23505 rather than a duplicate. A code the user typed is never silently
  // replaced -- that returns 409 so they can choose another.
  for (let attempt = 0; ; attempt++) {
    const code = supplied || (await generateEmployeeCode(admin, tenantId));
    const { data, error } = await admin
      .from("employees")
      .insert({ ...base, employee_code: code })
      .select("id, employee_code, first_name, last_name, employment_type, wfm_role, status")
      .single();

    if (!error) return NextResponse.json(data);

    if ((error as { code?: string }).code === "23505") {
      if (supplied) {
        return NextResponse.json({ error: `Employee code "${supplied}" already exists` }, { status: 409 });
      }
      if (attempt < 3) continue;
      return NextResponse.json({ error: "Couldn't allocate an employee code — please try again" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
