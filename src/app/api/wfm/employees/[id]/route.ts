import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase, findOrCreateUserForInvite, getAuthUser } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";
import { requireWfmSupervisor, getWfmConfig } from "@/lib/wfm/server";
import { normalizeRemoteMode, modeIncludesWfh, modeIncludesSite } from "@/lib/wfm/selfService";
import { buildEmployeeHubProfile } from "@/lib/wfm/employeeHub";
import { tenantOrigin } from "@/lib/constants";
import { revokeFaceEnrollment } from "@/lib/wfm/faceEnrollment";


// Capped per route, not via vercel.json. That config carried
// "src/app/api/wfm/**": { maxDuration: 60 } from 2026-10-03 and it never
// took effect -- on 2026-10-07 these routes still ran the full 300s during a
// Supabase connectivity blip, while /api/wfm/summary, the one route with this
// export, stopped at 60. The glob matches directories, not source files. A
// hung request holds a Fluid instance other requests are sharing, so this
// bounds the blast radius as much as the bill.
export const maxDuration = 60;

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

  // KAN-29: supervisors grant remote punching, not only tenant admins (owner
  // decision 2026-10-07 -- "it's the supervisor who should be able to allow or
  // not allow any user for remote work"). requireWfmSupervisor() above is
  // therefore the whole gate, and this field carries exactly the same access
  // as shift, site and wfm_role on this route.
  //
  // Stated explicitly because it previously read `ctx.role !== "admin"` and
  // only worked because KAN-17 promotes a supervisor's login to tenant admin.
  // That is an accident, not a permission: the day KAN-17's "proper role
  // distinctions come later" arrives, an admin-only check here would silently
  // take this away from every supervisor, with no test to catch it.
  const wfmConfig = await getWfmConfig(admin, tenantId);

  const touchesSelfService = "self_service_override" in body;
  let selfServiceBefore: boolean | null = null;

  // KAN-29 part 2: which remote working the allowed person does. Sent together
  // with self_service_override by the Employees screen, and validated as a
  // pair so the two columns cannot be saved in a state that means nothing.
  const touchesRemoteMode = "remote_mode" in body;
  let remoteModeBefore: string | null = null;
  // False while migration 0127 is pending: the column does not exist yet.
  let remoteModeColumn = true;
  if (touchesRemoteMode) {
    const rm = body.remote_mode;
    if (rm !== null && normalizeRemoteMode(rm) === null) {
      return NextResponse.json({ error: "remote_mode must be wfh, site, both or null" }, { status: 400 });
    }
    if (rm !== null) {
      // A mode is only meaningful when phone punching is explicitly allowed,
      // and the supervisor chose both in the same breath -- refuse a mode that
      // arrives without it rather than guess what was meant.
      if (body.self_service_override !== true) {
        return NextResponse.json({ error: "Choose 'allowed' together with a remote mode." }, { status: 400 });
      }
      // The workspace switches default OFF. A mode the workspace has not
      // switched on would save cleanly and then fail on the employee's phone
      // with no explanation, so refuse it here, where the supervisor can act.
      const mode = normalizeRemoteMode(rm);
      const missing: string[] = [];
      if (modeIncludesWfh(mode) && !wfmConfig.punch_types.mobile_work) missing.push("Work from home");
      if (modeIncludesSite(mode) && !wfmConfig.punch_types.business_trip) missing.push("Site visit");
      if (missing.length > 0) {
        return NextResponse.json({
          error: `${missing.join(" and ")} ${missing.length > 1 ? "aren't" : "isn't"} switched on for this workspace. Turn ${missing.length > 1 ? "them" : "it"} on in Settings → Workforce first.`,
        }, { status: 400 });
      }
    }
  }
  if (touchesRemoteMode || touchesSelfService) {
    // Read separately, like self_service_override: selecting it in the main
    // read would 404 every PATCH while migration 0127 is pending.
    const { data: rmRow, error: rmErr } = await admin
      .from("employees").select("remote_mode").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    if (rmErr) {
      if ((rmErr as { code?: string }).code === "42703") remoteModeColumn = false;
      else return NextResponse.json({ error: rmErr.message }, { status: 500 });
    } else {
      remoteModeBefore = normalizeRemoteMode((rmRow as { remote_mode?: unknown } | null)?.remote_mode);
    }
    if (!remoteModeColumn && body.remote_mode != null) {
      return NextResponse.json({ error: "Choosing Work from home or Site visit needs migration 0127 applied to this database." }, { status: 503 });
    }
  }

  if (touchesSelfService) {
    const v = body.self_service_override;
    if (v !== null && typeof v !== "boolean") {
      return NextResponse.json({ error: "self_service_override must be true, false or null" }, { status: 400 });
    }
    // Read separately: selecting the column in the main read above would 404
    // every PATCH while migration 0126 is pending.
    const { data: beforeRow, error: beforeErr } = await admin
      .from("employees")
      .select("self_service_override")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (beforeErr) {
      if ((beforeErr as { code?: string }).code === "42703") {
        return NextResponse.json({ error: "Per-employee punch access needs migration 0126 applied to this database." }, { status: 503 });
      }
      return NextResponse.json({ error: beforeErr.message }, { status: 500 });
    }
    selfServiceBefore = (beforeRow as { self_service_override?: boolean | null } | null)?.self_service_override ?? null;
  }

  // Employment types are tenant-configured (Settings -> Workforce), so the
  // accepted values come from config rather than a hardcoded enum.
  const validEmploymentTypes = wfmConfig.employment_types.map((t) => t.code);

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
  // null is accepted explicitly: typeof null is "object", so a bare boolean
  // check would silently drop "reset to the workspace default".
  if (body.self_service_override === null || typeof body.self_service_override === "boolean") {
    patch.self_service_override = body.self_service_override;
  }
  if (remoteModeColumn) {
    if (touchesRemoteMode) {
      patch.remote_mode = normalizeRemoteMode(body.remote_mode);
    } else if ("self_service_override" in patch && patch.self_service_override !== true) {
      // Moving someone off "allowed" must not leave a mode behind. It would be
      // inert (the policy ignores a mode without an explicit allow) but it
      // would reappear the moment they were allowed again, which nobody chose.
      patch.remote_mode = null;
    }
  }
  // Custom-field values (cf_* keys only — the shape CustomFields/
  // ObjectSections write; anything else in the object is dropped).
  if (typeof body.custom_data === "object" && body.custom_data !== null && !Array.isArray(body.custom_data)) {
    patch.custom_data = Object.fromEntries(
      Object.entries(body.custom_data as Record<string, unknown>).filter(([k]) => k.startsWith("cf_"))
    );
  }

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

    // The tenant's OWN domain, never the shared host: the same link built
    // from PRIMARY_HOST would carry a client's employee into the demo.
    const { data: tenantRow } = await admin.from("tenants").select("custom_domain").eq("id", tenantId).maybeSingle();
    const result = await findOrCreateUserForInvite(admin, email, {
      password,
      inviteData: { full_name: [employee.first_name, employee.last_name].filter(Boolean).join(" ") },
      redirectTo: `${tenantOrigin(tenantRow?.custom_domain as string | null)}/wfm/me`,
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

  // Who gave this person remote access, and when, is the question asked after
  // an incident -- so this field is always recorded.
  const logChanges: { field: string; from: unknown; to: unknown }[] = [];
  if (touchesSelfService && "self_service_override" in patch && selfServiceBefore !== (patch.self_service_override as boolean | null)) {
    logChanges.push({ field: "self_service_override", from: selfServiceBefore, to: patch.self_service_override as boolean | null });
  }
  if ("remote_mode" in patch && remoteModeBefore !== (patch.remote_mode as string | null)) {
    logChanges.push({ field: "remote_mode", from: remoteModeBefore, to: patch.remote_mode as string | null });
  }
  if (logChanges.length > 0) {
    const user = await getAuthUser();
    await logChange(ctx.supabase, {
      tenantId,
      objectType: "employees",
      objectId: id,
      objectLabel: [employee.first_name, employee.last_name].filter(Boolean).join(" "),
      action: "update",
      actorId: ctx.userId,
      actorEmail: user?.email ?? null,
      changes: logChanges,
    });
  }

  // Deactivated must also mean un-enrolled: the face templates and photo
  // copies go the moment the employee does. Best-effort -- a provider
  // hiccup logs loudly but never blocks the deactivation itself.
  if (patch.status === "inactive") {
    await revokeFaceEnrollment(admin, tenantId, id).catch((e) =>
      console.error("employee deactivate: face revoke failed:", (e as Error).message)
    );
  }

  return NextResponse.json(data);
}
