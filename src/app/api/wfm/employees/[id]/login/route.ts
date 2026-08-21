import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase, findOrCreateUserForInvite } from "@/lib/supabase-server";
import { requireWfm, getWfmConfig } from "@/lib/wfm/server";
import {
  employeeSyntheticEmail, isEmployeeSyntheticEmail, suggestUsername, normalizeUsername,
} from "@/lib/wfm/employeeLogin";

// POST /api/wfm/employees/[id]/login — create or reset an employee's
// self-service PORTAL login by a generated User ID (client decision
// 2026-08-21: employees sign in with a User ID, never their email and not the
// employee code). WFM-native (doesn't need the business_roles feature): it
// mints a synthetic address from the User ID, sets the admin-supplied initial
// password, links the membership, forces a change on first sign-in, and stores
// the User ID on the employee so the admin can see/hand it out. Only a
// supervisor/admin, and only when the tenant runs User-ID login (login_mode
// "code").
async function usernameTaken(
  admin: ReturnType<typeof createAdminSupabase>,
  tenantId: string,
  username: string,
  exceptEmployeeId: string
): Promise<boolean> {
  const { data } = await admin
    .from("employees")
    .select("id")
    .eq("tenant_id", tenantId)
    .filter("custom_data->>login_username", "eq", username)
    .neq("id", exceptEmployeeId)
    .limit(1);
  return !!(data && data.length > 0);
}

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
      { error: "Turn on User ID login (Settings → Workforce → Employee login) first." },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => null);
  const password: string | undefined =
    body && typeof body.password === "string" && body.password ? body.password : undefined;
  if (!password) return NextResponse.json({ error: "An initial password is required" }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  const providedUsername = body && typeof body.username === "string" ? normalizeUsername(body.username) : "";

  const { data: employee } = await admin
    .from("employees")
    .select("id, first_name, last_name, status, wfm_role, valid_from, valid_to, custom_data")
    .eq("id", employeeId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  if (employee.status !== "active") {
    return NextResponse.json({ error: "Only active employees can be given a login" }, { status: 409 });
  }

  const storedUsername = ((employee.custom_data ?? {}) as { login_username?: string }).login_username ?? "";

  // Decide the User ID: an explicit one from the admin is used verbatim (and
  // rejected if taken); otherwise reuse the stored one, or generate a default
  // from the name and dedupe with a numeric suffix.
  let username: string;
  if (providedUsername) {
    if (await usernameTaken(admin, tenantId, providedUsername, employeeId)) {
      return NextResponse.json({ error: "That User ID is already taken — choose another." }, { status: 409 });
    }
    username = providedUsername;
  } else if (storedUsername) {
    username = storedUsername;
  } else {
    const base = suggestUsername(employee.first_name, employee.last_name);
    username = base;
    for (let n = 2; n < 100 && (await usernameTaken(admin, tenantId, username, employeeId)); n++) {
      username = `${base}${n}`;
    }
  }

  const synthEmail = employeeSyntheticEmail(tenantId, username);
  if (!synthEmail) {
    return NextResponse.json({ error: "Could not build a User ID for this employee." }, { status: 400 });
  }

  const displayName = [employee.first_name, employee.last_name].filter(Boolean).join(" ");

  async function storeUsername() {
    const merged = { ...((employee!.custom_data ?? {}) as Record<string, unknown>), login_username: username };
    await admin.from("employees").update({ custom_data: merged }).eq("id", employeeId).eq("tenant_id", tenantId);
  }

  // Already linked? Then this is a reset/update — only for a synthetic (User
  // ID) login; a membership tied to a real email is a different sign-in method
  // and isn't overwritten here. If the User ID changed, move the auth account
  // to the new synthetic address too.
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
    const update: { password: string; email?: string; email_confirm?: boolean } = { password };
    if (currentEmail !== synthEmail) { update.email = synthEmail; update.email_confirm = true; }
    const { error: pwErr } = await admin.auth.admin.updateUserById(existingLink.user_id, update);
    if (pwErr) return NextResponse.json({ error: pwErr.message }, { status: 500 });
    const { error: flagErr } = await admin
      .from("tenant_users")
      .update({ must_change_password: true })
      .eq("id", existingLink.id)
      .eq("tenant_id", tenantId);
    if (flagErr) return NextResponse.json({ error: flagErr.message }, { status: 500 });
    await storeUsername();
    return NextResponse.json({ ok: true, reset: true, username });
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
    if ((insertErr as { code?: string }).code === "23505") {
      await storeUsername();
      return NextResponse.json({ ok: true, username });
    }
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  await storeUsername();
  return NextResponse.json({ ok: true, created: true, username }, { status: 201 });
}
