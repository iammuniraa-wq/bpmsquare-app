import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase, findOrCreateUserForInvite } from "@/lib/supabase-server";
import { requireWfmSupervisor, getWfmConfig } from "@/lib/wfm/server";
import { buildEmployeeHubProfile } from "@/lib/wfm/employeeHub";
import { PRIMARY_HOST } from "@/lib/constants";

// GET /api/wfm/employees/[id] — one employee's full hub profile: identity,
// site/shift/supervisor, who reports to them, this month's attendance
// totals and leave balance. The single aggregated fetch behind the
// Employee Hub page, same role as getAccountHubLive() for Accounts.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { tenantId, supabase } = ctx;
  const { id } = await params;

  const profile = await buildEmployeeHubProfile(supabase, tenantId, id, request.nextUrl.searchParams.get("month"));
  if (!profile) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(profile);
}

// Canonical, auto-provisioned Business Roles for a WFM login's default CRM
// access -- found-or-created by name per tenant. Both employee and
// supervisor get the "wfm" workcenter granted -- that's what makes My
// Workforce (/wfm/me) reachable, and it's the whole CRM footprint a plain
// employee needs. The 5 supervisor-only screens (Live board, Employees,
// Corrections queue, Leave & Holidays, Monthly Summary) are gated
// separately by wfm_role via requireWfmSupervisorPage/requireWfmSupervisor,
// not by a finer-grained workcenter -- so an employee holding the same
// "wfm" grant still can't reach them, by URL or otherwise. Only applied
// when the login has no Business Role configured yet at all, so it never
// overrides a tenant admin's own manual role assignment.
async function ensureDefaultWfmRoleAssigned(
  admin: SupabaseClient,
  tenantId: string,
  userId: string,
  wfmRole: "employee" | "supervisor"
): Promise<void> {
  const { data: existing } = await admin
    .from("business_user_roles").select("id").eq("tenant_id", tenantId).eq("user_id", userId).limit(1);
  if (existing && existing.length > 0) return;

  const roleName = wfmRole === "supervisor" ? "WFM Supervisor" : "WFM Employee";
  const { data: existingRole } = await admin
    .from("business_roles").select("id").eq("tenant_id", tenantId).eq("name", roleName).maybeSingle();

  let roleId = existingRole?.id as string | undefined;
  if (!roleId) {
    const { data: role, error: roleErr } = await admin
      .from("business_roles").insert({ tenant_id: tenantId, name: roleName }).select("id").single();
    if (roleErr) { console.error("ensureDefaultWfmRoleAssigned: create role failed", roleErr.message); return; }
    roleId = role.id;
    const { error: grantErr } = await admin
      .from("business_role_grants").insert({ tenant_id: tenantId, role_id: roleId, workcenter: "wfm", can_view: true });
    if (grantErr) console.error("ensureDefaultWfmRoleAssigned: grant failed", grantErr.message);
  }

  const { error: assignErr } = await admin
    .from("business_user_roles").insert({ tenant_id: tenantId, user_id: userId, role_id: roleId });
  if (assignErr) console.error("ensureDefaultWfmRoleAssigned: assign failed", assignErr.message);
}

// PATCH /api/wfm/employees/[id] — edit WFM fields, activate/deactivate, or
// link a login: pass invite_email to invite/attach an auth user as a tenant
// member bound to this employee via tenant_users.employee_id (the Business
// Users link — same mechanism, WFM entry point). Supervisor/admin.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { tenantId } = ctx;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const admin = createAdminSupabase();

  const { data: employee } = await admin
    .from("employees")
    .select("id, first_name, last_name, wfm_role")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!employee) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Employment types are tenant-configured (Settings -> Workforce), so the
  // accepted values come from config rather than a hardcoded enum.
  const validEmploymentTypes = (await getWfmConfig(admin, tenantId)).employment_types.map((t) => t.code);

  const patch: Record<string, unknown> = {};
  // employee_code is deliberately absent: system-generated at create,
  // immutable after (owner decision 2026-08-15 -- see lib/employeeRef.ts).
  if (typeof body.first_name === "string" && body.first_name.trim()) patch.first_name = body.first_name.trim();
  if (typeof body.last_name === "string") patch.last_name = body.last_name.trim();
  if (typeof body.phone === "string") patch.phone = body.phone.trim() || null;
  if (typeof body.employment_type === "string" && validEmploymentTypes.includes(body.employment_type)) {
    patch.employment_type = body.employment_type;
  }
  if (["employee", "supervisor"].includes(body.wfm_role)) patch.wfm_role = body.wfm_role;
  if (["active", "inactive"].includes(body.status)) patch.status = body.status;

  if ("shift_id" in body) {
    if (body.shift_id === null || body.shift_id === "") {
      patch.shift_id = null;
    } else if (typeof body.shift_id === "string") {
      const { data: shift } = await admin
        .from("wfm_shifts").select("id").eq("id", body.shift_id).eq("tenant_id", tenantId).maybeSingle();
      if (!shift) return NextResponse.json({ error: "Unknown shift" }, { status: 400 });
      patch.shift_id = body.shift_id;
    }
  }
  if ("site_id" in body) {
    if (body.site_id === null || body.site_id === "") {
      patch.site_id = null;
    } else if (typeof body.site_id === "string") {
      const { data: site } = await admin
        .from("wfm_sites").select("id").eq("id", body.site_id).eq("tenant_id", tenantId).maybeSingle();
      if (!site) return NextResponse.json({ error: "Unknown site" }, { status: 400 });
      patch.site_id = body.site_id;
    }
  }
  if ("supervisor_id" in body) {
    if (body.supervisor_id === null || body.supervisor_id === "") {
      patch.supervisor_id = null;
    } else if (typeof body.supervisor_id === "string") {
      if (body.supervisor_id === id) {
        return NextResponse.json({ error: "An employee can't be their own supervisor" }, { status: 400 });
      }
      const { data: supervisor } = await admin
        .from("employees").select("id").eq("id", body.supervisor_id).eq("tenant_id", tenantId).maybeSingle();
      if (!supervisor) return NextResponse.json({ error: "Unknown supervisor" }, { status: 400 });
      patch.supervisor_id = body.supervisor_id;
    }
  }

  // Login link via tenant_users.employee_id -- same password-based,
  // no-magic-link pattern as POST /api/business-users (an admin-set initial
  // password the recipient changes on first login), not the older
  // inviteUserByEmail() path: that path leaves the account unconfirmed until
  // an email link is clicked, which blocks password sign-in entirely no
  // matter how many times the password is later reset (found via a live
  // repro -- a login created through this exact route sat permanently at
  // "waiting for verification").
  if (typeof body.invite_email === "string" && body.invite_email.trim()) {
    const email = body.invite_email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }
    const password = typeof body.invite_password === "string" ? body.invite_password : "";
    if (!password) return NextResponse.json({ error: "An initial password is required" }, { status: 400 });
    if (password.length < 8) return NextResponse.json({ error: "Initial password must be at least 8 characters" }, { status: 400 });

    const { data: alreadyLinked } = await admin
      .from("tenant_users")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("employee_id", employee.id)
      .maybeSingle();
    if (alreadyLinked) {
      return NextResponse.json({ error: "Employee already has a login" }, { status: 409 });
    }

    const result = await findOrCreateUserForInvite(admin, email, {
      password,
      inviteData: { full_name: [employee.first_name, employee.last_name].filter(Boolean).join(" ") },
      redirectTo: `https://${PRIMARY_HOST}/wfm/me`,
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });

    const { data: membership } = await admin
      .from("tenant_users")
      .select("id, employee_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", result.userId)
      .maybeSingle();

    if (membership?.employee_id && membership.employee_id !== employee.id) {
      return NextResponse.json({ error: "That login is already linked to another employee" }, { status: 409 });
    }
    if (membership) {
      // An already-existing account elsewhere on the platform -- the typed
      // password was silently ignored (findOrCreateUserForInvite never
      // touches an existing user's credential without consent), so nothing
      // about must_change_password changes for it either.
      const { error: linkErr } = await admin
        .from("tenant_users")
        .update({ employee_id: employee.id })
        .eq("id", membership.id)
        .eq("tenant_id", tenantId);
      if (linkErr) {
        console.error("wfm employee link failed:", linkErr.message);
        return NextResponse.json({ error: "Could not link login" }, { status: 500 });
      }
    } else {
      const { error: memberErr } = await admin
        .from("tenant_users")
        .insert({ tenant_id: tenantId, user_id: result.userId, role: "member", employee_id: employee.id, must_change_password: result.isNew });
      if (memberErr) {
        console.error("wfm invite membership failed:", memberErr.message);
        return NextResponse.json({ error: "Could not add tenant membership" }, { status: 500 });
      }
    }

    const effectiveWfmRole = (patch.wfm_role as "employee" | "supervisor" | undefined) ?? employee.wfm_role;
    await ensureDefaultWfmRoleAssigned(admin, tenantId, result.userId, effectiveWfmRole);
  }

  // KAN-17 (owner decision 2026-08-18): WFM supervisors have full admin
  // parity -- "whatever admin can do, supervisor can do as well", proper
  // role distinctions come later. Promote the linked login to tenant admin
  // whenever the employee is (or just became) a supervisor. Promotion only:
  // demoting a supervisor never silently strips an admin membership.
  {
    const effectiveWfmRole = (patch.wfm_role as string | undefined) ?? employee.wfm_role;
    if (effectiveWfmRole === "supervisor") {
      await admin
        .from("tenant_users")
        .update({ role: "admin" })
        .eq("tenant_id", tenantId)
        .eq("employee_id", employee.id)
        .neq("role", "admin");
    }
  }

  if (Object.keys(patch).length === 0) {
    if (typeof body.invite_email === "string") {
      return NextResponse.json({ ok: true, invited: true });
    }
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("employees")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("id, employee_code, first_name, last_name, phone, employment_type, wfm_role, shift_id, site_id, supervisor_id, status, consent_recorded_at")
    .maybeSingle();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "Employee code already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}
