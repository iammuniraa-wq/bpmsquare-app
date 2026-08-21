import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase, findOrCreateUserForInvite } from "@/lib/supabase-server";
import { requireWfm, getWfmConfig } from "@/lib/wfm/server";
import { employeeSyntheticEmail, isEmployeeSyntheticEmail } from "@/lib/wfm/employeeLogin";

// POST /api/wfm/employees/[id]/login — create or reset an employee's
// self-service PORTAL login by employee code (client decision 2026-08-21).
// This is the WFM-native counterpart to /api/business-users (which is gated
// on the business_roles feature a WFM-only tenant need not have): it mints the
// synthetic address from the employee's code, sets the admin-supplied initial
// password, links the membership, and forces a change on first sign-in. Only a
// supervisor/admin can call it, and only when the tenant is in code-login mode.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireWfm();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { tenantId, isSupervisor } = ctx;
  if (!isSupervisor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: employeeId } = await params;
  const admin = createAdminSupabase();

  const config = await getWfmConfig(admin, tenantId);
  if (config.login_mode !== "code") {
    return NextResponse.json(
      { error: "Turn on employee-code login (Settings → Workforce) before creating code logins." },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => null);
  const password: string | undefined =
    body && typeof body.password === "string" && body.password ? body.password : undefined;
  if (!password) return NextResponse.json({ error: "An initial password is required" }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });

  const { data: employee } = await admin
    .from("employees")
    .select("id, first_name, last_name, employee_code, status, wfm_role, valid_from, valid_to")
    .eq("id", employeeId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  if (employee.status !== "active") {
    return NextResponse.json({ error: "Only active employees can be given a login" }, { status: 409 });
  }

  const synthEmail = employeeSyntheticEmail(tenantId, employee.employee_code);
  if (!synthEmail) {
    return NextResponse.json({ error: "This employee needs an employee code before a code login can be made." }, { status: 400 });
  }

  const displayName = [employee.first_name, employee.last_name].filter(Boolean).join(" ");

  // Already linked? Then this is a password RESET, not a create -- but only for
  // a synthetic (code) login. A membership already tied to a real email login
  // is a different sign-in method and isn't overwritten here.
  const { data: existingLink } = await admin
    .from("tenant_users")
    .select("id, user_id")
    .eq("tenant_id", tenantId)
    .eq("employee_id", employeeId)
    .maybeSingle();

  if (existingLink) {
    const { data: userRes } = await admin.auth.admin.getUserById(existingLink.user_id);
    const currentEmail = userRes?.user?.email ?? null;
    if (!isEmployeeSyntheticEmail(currentEmail)) {
      return NextResponse.json({ error: "This employee already has an email login." }, { status: 409 });
    }
    const { error: pwErr } = await admin.auth.admin.updateUserById(existingLink.user_id, { password });
    if (pwErr) return NextResponse.json({ error: pwErr.message }, { status: 500 });
    const { error: flagErr } = await admin
      .from("tenant_users")
      .update({ must_change_password: true })
      .eq("id", existingLink.id)
      .eq("tenant_id", tenantId);
    if (flagErr) return NextResponse.json({ error: flagErr.message }, { status: 500 });
    return NextResponse.json({ ok: true, reset: true, employee_code: employee.employee_code });
  }

  const result = await findOrCreateUserForInvite(admin, synthEmail, {
    password,
    inviteData: { tenant_id: tenantId, full_name: displayName },
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  const { userId } = result;

  // Supervisors get an admin membership, matching the business-users flow
  // (KAN-17): "whatever admin can do, supervisor can do as well".
  const memberRole = employee.wfm_role === "supervisor" ? "admin" : "member";
  const { error: insertErr } = await admin.from("tenant_users").insert({
    tenant_id: tenantId,
    user_id: userId,
    role: memberRole,
    employee_id: employeeId,
    display_name: displayName,
    valid_from: employee.valid_from,
    valid_to: employee.valid_to,
    counted: true,
    must_change_password: true,
  });
  if (insertErr) {
    // 23505 = a concurrent create won the race; treat as already-linked success.
    if ((insertErr as { code?: string }).code === "23505") {
      return NextResponse.json({ ok: true, employee_code: employee.employee_code });
    }
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, created: true, employee_code: employee.employee_code }, { status: 201 });
}
