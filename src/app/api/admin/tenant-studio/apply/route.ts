import { NextResponse, type NextRequest } from "next/server";
import { isPlatformAdmin } from "@/lib/tenant";
import { createAdminSupabase, findOrCreateUserForInvite } from "@/lib/supabase-server";
import { generateNextEmployeeCode } from "@/lib/employeeRef";
import { normalisePlan, manualSteps } from "@/lib/admin/tenantStudio";

/**
 * POST /api/admin/tenant-studio/apply — create the tenant the plan describes.
 * Platform admin only.
 *
 * ── THE PLAN IS RE-VALIDATED HERE ─────────────────────────────────────────
 * normalisePlan() runs again on the way in, even though the plan route
 * already ran it. That is not belt-and-braces: the body arrives from a
 * browser, so between drafting and applying it is just client-supplied JSON
 * and carries no more authority than any other request body. A hand-edited
 * `features: { next_experience: true }` has to die here, not be trusted
 * because a model produced something similar earlier.
 *
 * ── WHY EVERY WRITE NAMES tenant_id ───────────────────────────────────────
 * This runs on the service-role client, which bypasses RLS entirely
 * (MULTI_TENANT_GUARDRAILS.md). There is no session for the tenant being
 * created -- it does not exist yet, and a platform admin has no membership
 * in it -- so the session client is not an option. Every insert below
 * therefore carries tenant_id explicitly, from the row this route itself
 * created, never from the request.
 *
 * ── NOT A TRANSACTION, AND HONEST ABOUT IT ────────────────────────────────
 * PostgREST gives no cross-statement transaction, so this is a sequence:
 * tenant, then roles, then users. A failure partway leaves a real tenant
 * with fewer users than asked for, so the response reports what was created
 * and what failed per item rather than a bare ok/error. The tenant row is
 * the one thing created first and alone -- if it fails, nothing else has
 * happened; if a later step fails, the operator has a live tenant they can
 * finish by hand in /admin/tenants/[id] and Settings → Team, which is
 * exactly the pre-studio flow.
 */
export async function POST(request: NextRequest) {
  if (!(await isPlatformAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const { plan, warnings } = normalisePlan(body?.plan);

  if (!plan.tenant.name || !plan.tenant.slug) {
    return NextResponse.json({ error: "The plan needs a name and a slug." }, { status: 400 });
  }
  if (!plan.tenant.custom_domain) {
    return NextResponse.json(
      { error: "A custom domain is required — it's the address this tenant's users sign in at (e.g. acme.bpmsquare.com)." },
      { status: 400 },
    );
  }

  const admin = createAdminSupabase();
  const created: string[] = [];
  const failed: string[] = [];

  // ── 1. the tenant ──
  // Same shape /api/admin/tenants writes, so a studio tenant and a
  // form tenant are indistinguishable afterwards.
  const { data: tenantRow, error: tenantErr } = await admin
    .from("tenants")
    .insert({
      name: plan.tenant.name,
      slug: plan.tenant.slug,
      accent_color: plan.tenant.accent_color,
      plan: plan.tenant.plan,
      features: plan.features,
      custom_domain: plan.tenant.custom_domain,
      status: "active",
      config: {
        appearance: { ui_theme: "modern" },
        currency: plan.tenant.currency,
        ...(plan.nav_hidden_hrefs.length > 0 ? { nav_hidden_hrefs: plan.nav_hidden_hrefs } : {}),
      },
    })
    .select("id")
    .single();

  if (tenantErr || !tenantRow) {
    const msg = tenantErr?.message ?? "Could not create the tenant";
    return NextResponse.json({
      error: msg.includes("unique")
        ? (msg.includes("custom_domain")
            ? `Domain "${plan.tenant.custom_domain}" is already in use by another tenant.`
            : `Slug "${plan.tenant.slug}" is already taken.`)
        : msg,
    }, { status: 400 });
  }
  const tenantId = tenantRow.id as string;
  created.push(`Tenant ${plan.tenant.name} (${plan.tenant.slug}) on ${plan.tenant.custom_domain}`);

  // ── 2. Business Roles and their grants ──
  const roleIds = new Map<string, string>(); // lowercased name -> id
  for (const role of plan.roles) {
    const { data: roleRow, error } = await admin
      .from("business_roles")
      .insert({ tenant_id: tenantId, name: role.name, description: role.description ?? null })
      .select("id")
      .single();
    if (error || !roleRow) { failed.push(`Role "${role.name}": ${error?.message ?? "not created"}`); continue; }
    roleIds.set(role.name.toLowerCase(), roleRow.id as string);

    if (role.workcenters.length > 0) {
      const { error: grantErr } = await admin.from("business_role_grants").insert(
        role.workcenters.map((w) => ({
          tenant_id: tenantId,
          role_id: roleRow.id,
          workcenter: w.key,
          can_view: true,
          // create/delete follow edit: a role that may change a record but
          // not add or remove one is a distinction the studio has no way to
          // hear in a sentence, and the roles screen can split them later.
          can_create: w.can_edit,
          can_edit: w.can_edit,
          can_delete: w.can_edit,
        }))
      );
      if (grantErr) failed.push(`Role "${role.name}" grants: ${grantErr.message}`);
    }
    created.push(`Role ${role.name} (${role.workcenters.length} workcenter${role.workcenters.length === 1 ? "" : "s"})`);
  }

  // ── 3. the provisioning admin ──
  const passwords: { email: string; password: string }[] = [];
  const host = plan.tenant.custom_domain;
  if (plan.admin.email) {
    const password = plan.admin.password || randomPassword();
    const result = await findOrCreateUserForInvite(admin, plan.admin.email, {
      password,
      inviteData: { tenant_id: tenantId, tenant_name: plan.tenant.name },
      redirectTo: `https://${host}/auth/callback`,
    });
    if ("error" in result) {
      failed.push(`Admin ${plan.admin.email}: ${result.error}`);
    } else {
      await admin.from("tenant_users").insert({ tenant_id: tenantId, user_id: result.userId, role: "admin" });
      created.push(`Admin login ${plan.admin.email}`);
      // Only ever reported for an account this call created. An existing
      // account keeps its own password -- the invite helper ignores the one
      // passed (by design), so printing it would be a lie the operator would
      // then hand to the client.
      if (result.isNew) passwords.push({ email: plan.admin.email, password });
    }
  }

  // ── 4. users, employees, role assignments ──
  for (const user of plan.users) {
    const password = randomPassword();
    const result = await findOrCreateUserForInvite(admin, user.email, {
      password,
      inviteData: { tenant_id: tenantId, tenant_name: plan.tenant.name },
      redirectTo: `https://${host}/auth/callback`,
    });
    if ("error" in result) { failed.push(`${user.email}: ${result.error}`); continue; }

    let employeeId: string | null = null;
    if (user.employee) {
      const employee_code = await generateNextEmployeeCode(admin, tenantId);
      const { data: empRow, error: empErr } = await admin
        .from("employees")
        .insert({
          tenant_id: tenantId,
          employee_code,
          first_name: user.employee.first_name,
          last_name: user.employee.last_name ?? null,
          designation: user.employee.designation ?? null,
          wfm_role: user.employee.wfm_role ?? "employee",
          status: "active",
        })
        .select("id")
        .single();
      if (empErr || !empRow) failed.push(`${user.email}: employee record — ${empErr?.message ?? "not created"}`);
      else employeeId = empRow.id as string;
    }

    const { error: memberErr } = await admin.from("tenant_users").insert({
      tenant_id: tenantId,
      user_id: result.userId,
      role: user.role,
      display_name: user.employee ? [user.employee.first_name, user.employee.last_name].filter(Boolean).join(" ") : null,
      employee_id: employeeId,
    });
    if (memberErr) { failed.push(`${user.email}: membership — ${memberErr.message}`); continue; }

    if (user.business_role) {
      const roleId = roleIds.get(user.business_role.toLowerCase());
      if (roleId) {
        const { error: assignErr } = await admin
          .from("business_user_roles")
          .insert({ tenant_id: tenantId, user_id: result.userId, role_id: roleId });
        if (assignErr) failed.push(`${user.email}: role ${user.business_role} — ${assignErr.message}`);
      }
    }

    created.push(`${user.role === "admin" ? "Admin" : "User"} ${user.email}${employeeId ? " + employee record" : ""}`);
    if (result.isNew) passwords.push({ email: user.email, password });
  }

  return NextResponse.json({
    tenant_id: tenantId,
    created,
    failed,
    warnings,
    passwords,
    manual_steps: manualSteps(plan),
  });
}

/** Initial password for an account this route creates. Shown once, in the
 *  response, and never stored anywhere by us -- same contract as the Data
 *  Workbench user import (TENANT_PROVISIONING.md §4: "never put passwords in
 *  a spreadsheet"). Every login is forced to change it on first sign-in. */
function randomPassword(): string {
  // Ambiguous glyphs left out (no I/l/1, O/0) -- these get read off a screen
  // and typed by someone else.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  // Rejection sampling, not `byte % length`. 256 is not a multiple of 56, so
  // the modulo would make the first 32 characters of the alphabet slightly
  // likelier than the rest. The entropy lost is small, but this is a
  // credential, and "small enough not to matter" is not a claim worth making
  // about one.
  const limit = 256 - (256 % alphabet.length);
  const out: string[] = [];
  while (out.length < 16) {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    for (const b of bytes) {
      if (b >= limit) continue;
      out.push(alphabet[b % alphabet.length]);
      if (out.length === 16) break;
    }
  }
  return out.join("") + "!7";
}
