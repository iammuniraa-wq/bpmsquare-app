import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, findOrCreateUserForInvite } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { PRIMARY_HOST } from "@/lib/constants";

// The Business User layer (0057): a login bound to an Employee record, with
// validity/lock/counted admin controls -- the SAP-style flow the design
// partner asked for, replacing the scattered Settings->Team hopscotch for
// role-managed workspaces. Passwords live entirely in Supabase Auth.

// GET /api/business-users -- every membership row with its business-user
// fields + auth email, plus role assignments, in one payload for the admin
// screen.
export async function GET() {
  let supabase, tenantId, role;
  try {
    ({ supabase, tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await tenantHasFeature(supabase, tenantId, "business_roles"))) {
    return NextResponse.json({ error: "Business Roles isn't enabled for your workspace" }, { status: 403 });
  }

  const admin = createAdminSupabase();
  const [{ data: rows, error }, { data: assignments }] = await Promise.all([
    admin
      .from("tenant_users")
      .select("user_id, role, created_at, employee_id, display_name, is_locked, valid_from, valid_to, counted")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true }),
    admin.from("business_user_roles").select("user_id, role_id").eq("tenant_id", tenantId),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const roleIdsByUser = new Map<string, string[]>();
  for (const a of assignments ?? []) {
    const list = roleIdsByUser.get(a.user_id);
    if (list) list.push(a.role_id); else roleIdsByUser.set(a.user_id, [a.role_id]);
  }

  // One paginated pass over the auth users instead of a getUserById per row
  // -- the old N+1 was fine for a hand-built team but not once users arrive
  // by bulk import (BUSINESS_ROLES_STANDARD_MAP.md §5).
  const emailById = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (listErr || !data?.users?.length) break;
    for (const u of data.users) if (u.email) emailById.set(u.id, u.email);
    if (data.users.length < 1000) break;
  }

  const users = (rows ?? []).map((row) => ({
    ...row,
    email: emailById.get(row.user_id) ?? null,
    business_role_ids: roleIdsByUser.get(row.user_id) ?? [],
  }));

  return NextResponse.json({ users });
}

// POST /api/business-users -- create a Business User FROM an employee record:
// the employee's email (or an explicit override) becomes the login, an
// admin-set initial password (or invite email if omitted) bootstraps it, and
// the employee's own validity window is copied onto the membership as the
// starting value.
export async function POST(request: NextRequest) {
  let supabase, tenantId, role;
  try {
    ({ supabase, tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await tenantHasFeature(supabase, tenantId, "business_roles"))) {
    return NextResponse.json({ error: "Business Roles isn't enabled for your workspace" }, { status: 403 });
  }

  const body = await request.json();
  const employeeId = typeof body.employee_id === "string" ? body.employee_id : "";
  if (!employeeId) return NextResponse.json({ error: "employee_id is required" }, { status: 400 });

  const { data: employee } = await supabase
    .from("employees")
    .select("id, first_name, last_name, email, valid_from, valid_to")
    .eq("id", employeeId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  const email: string = (typeof body.email === "string" && body.email.trim() ? body.email : employee.email ?? "").trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "The employee has no email on file — provide one" }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "That doesn't look like a valid email address" }, { status: 400 });
  }
  const password: string | undefined = typeof body.password === "string" && body.password ? body.password : undefined;
  if (password && password.length < 8) {
    return NextResponse.json({ error: "Initial password must be at least 8 characters" }, { status: 400 });
  }

  const admin = createAdminSupabase();

  // One business user per employee -- a second login for the same person is
  // almost always a mistake (and would make "counted user" double-count them).
  const { data: existingLink } = await admin
    .from("tenant_users")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("employee_id", employeeId)
    .maybeSingle();
  if (existingLink) return NextResponse.json({ error: "This employee already has a business user" }, { status: 409 });

  const { data: tenant } = await admin.from("tenants").select("name, custom_domain").eq("id", tenantId).maybeSingle();
  const host = tenant?.custom_domain || PRIMARY_HOST;

  const result = await findOrCreateUserForInvite(admin, email, {
    password,
    inviteData: { tenant_id: tenantId, tenant_name: tenant?.name, full_name: `${employee.first_name} ${employee.last_name}`.trim() },
    redirectTo: `https://${host}/auth/callback`,
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  const { userId, isNew } = result;

  const displayName = `${employee.first_name} ${employee.last_name}`.trim();
  const membershipFields = {
    employee_id: employeeId,
    display_name: displayName,
    valid_from: employee.valid_from,
    valid_to: employee.valid_to,
    counted: body.counted === false ? false : true,
  };

  if (!isNew) {
    const { data: alreadyMember } = await admin
      .from("tenant_users")
      .select("id, employee_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .maybeSingle();
    if (alreadyMember) {
      if (alreadyMember.employee_id && alreadyMember.employee_id !== employeeId) {
        return NextResponse.json({ error: "This email's login is already linked to a different employee" }, { status: 409 });
      }
      // Existing plain membership (pre-dating this feature): upgrade it in
      // place into a business user rather than erroring.
      const { error: uErr } = await admin.from("tenant_users").update(membershipFields).eq("id", alreadyMember.id).eq("tenant_id", tenantId);
      if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
      return NextResponse.json({ ok: true, user_id: userId, linkedExisting: true });
    }
  }

  const { error: insertErr } = await admin
    .from("tenant_users")
    .insert({ tenant_id: tenantId, user_id: userId, role: "member", ...membershipFields });
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, user_id: userId, passwordSet: !!password && isNew }, { status: 201 });
}
