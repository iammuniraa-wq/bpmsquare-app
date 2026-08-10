/**
 * One-shot script: create a "BPMSquare Demo" tenant (separate from the live
 * Vikas tenant) and seed it with the same two WFM test accounts used on the
 * develop tenant -- wfm2user@gmail.com (employee) and wfm2admin@gmail.com
 * (supervisor + tenant admin) -- plus one site and one shift so the demo
 * isn't an empty shell.
 *
 * Run with: node scripts/seed-wfm-demo-tenant.mjs
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the
 * environment (same as scripts/push-seed-to-supabase.mjs).
 *
 * Safe to re-run -- every step looks for an existing row before inserting.
 * If wfm2user@gmail.com / wfm2admin@gmail.com already exist in Supabase Auth
 * (e.g. from the develop tenant), this REUSES those accounts and just adds a
 * second tenant membership -- no new password, same login works on both
 * tenants because tenant identity is resolved by hostname, not by the user.
 * If either email doesn't exist yet, this creates it with the password
 * printed at the end.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment before running this script.");
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ── Config -- edit here if you want different names/domain/tenant slug ────
const TENANT = {
  name: "BPMSquare Demo",
  slug: "demo",
  custom_domain: "demo.bpmsquare.com",
  accent_color: "#3b82f6",
  plan: "small_business",
};

// Mirrors DEFAULT_FEATURES in src/app/admin/tenants/new/NewTenantForm.tsx,
// with wfm explicitly on since that's the point of this tenant.
const FEATURES = {
  leads: false, pipeline: false, amc: false, dispatch: false,
  invoices: false, partners: false, ai_assistant: false, db_export: false,
  purchasing: false, marketing: false,
  change_history: false, outbound_email: false, business_roles: true,
  standard_quotes: false, gmail_reply_threading: false, quote_lines_dw: false,
  wfm: true,
  accounts: true, contacts: true, quotations: true, cases: true,
  work_orders: true, technicians: true, assets: true, suppliers: true,
  reports: true, data_workbench: true, administration: true,
};

const SITE = { name: "Demo Head Office", lat: 15.2695, lng: 76.3871, radius_m: 200 };
const SHIFT = { name: "General Shift", start_time: "09:00:00", end_time: "18:00:00", grace_minutes: 10 };

const DEMO_PASSWORD = "WfmDemo#2026";

const USERS = [
  {
    email: "wfm2user@gmail.com",
    tenant_role: "member",
    wfm_role: "employee",
    first_name: "Demo",
    last_name: "Employee",
    employee_code: "DEMO-EMP-01",
  },
  {
    email: "wfm2admin@gmail.com",
    tenant_role: "admin",
    wfm_role: "supervisor",
    first_name: "Demo",
    last_name: "Supervisor",
    employee_code: "DEMO-SUP-01",
  },
];
// ────────────────────────────────────────────────────────────────────────

async function findOrCreateTenant() {
  const { data: existing } = await sb.from("tenants").select("id, slug, custom_domain").eq("slug", TENANT.slug).maybeSingle();
  if (existing) {
    console.log(`Tenant "${TENANT.slug}" already exists (${existing.id}) -- reusing.`);
    return existing.id;
  }
  const { data, error } = await sb
    .from("tenants")
    .insert({
      name: TENANT.name, slug: TENANT.slug, accent_color: TENANT.accent_color,
      plan: TENANT.plan, features: FEATURES, custom_domain: TENANT.custom_domain,
      status: "active", config: { appearance: { ui_theme: "modern" } },
    })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to create tenant: ${error.message}`);
  console.log(`Created tenant "${TENANT.name}" (${data.id}) at https://${TENANT.custom_domain}`);
  return data.id;
}

async function findOrCreateSite(tenantId) {
  const { data: existing } = await sb.from("wfm_sites").select("id").eq("tenant_id", tenantId).eq("name", SITE.name).maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await sb
    .from("wfm_sites")
    .insert({ tenant_id: tenantId, name: SITE.name, lat: SITE.lat, lng: SITE.lng, radius_m: SITE.radius_m, active: true })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to create site: ${error.message}`);
  console.log(`Created site "${SITE.name}" (${data.id})`);
  return data.id;
}

async function findOrCreateShift(tenantId) {
  const { data: existing } = await sb.from("wfm_shifts").select("id").eq("tenant_id", tenantId).eq("name", SHIFT.name).maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await sb
    .from("wfm_shifts")
    .insert({
      tenant_id: tenantId, name: SHIFT.name, start_time: SHIFT.start_time, end_time: SHIFT.end_time,
      grace_minutes: SHIFT.grace_minutes, is_night_shift: false, night_allowance_amount: 0, active: true,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to create shift: ${error.message}`);
  console.log(`Created shift "${SHIFT.name}" (${data.id})`);
  return data.id;
}

async function findAuthUserByEmail(email) {
  // listUsers doesn't filter server-side by email in older supabase-js
  // versions -- page through until found or exhausted, same pattern as
  // findOrCreateUserForInvite in src/lib/supabase-server.ts.
  let page = 1;
  for (;;) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function findOrCreateAuthUser(email) {
  const existing = await findAuthUserByEmail(email);
  if (existing) return { userId: existing.id, isNew: false };
  const { data, error } = await sb.auth.admin.createUser({
    email, password: DEMO_PASSWORD, email_confirm: true,
  });
  if (error) throw new Error(`Failed to create auth user ${email}: ${error.message}`);
  return { userId: data.user.id, isNew: true };
}

async function findOrCreateEmployee(tenantId, u, shiftId, siteId) {
  const { data: existing } = await sb
    .from("employees")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("employee_code", u.employee_code)
    .maybeSingle();
  const fields = {
    first_name: u.first_name, last_name: u.last_name, email: u.email,
    status: "active", employment_type: "full_time", wfm_role: u.wfm_role,
    shift_id: shiftId, site_id: siteId,
  };
  if (existing) {
    const { error } = await sb.from("employees").update(fields).eq("id", existing.id).eq("tenant_id", tenantId);
    if (error) throw new Error(`Failed to update employee ${u.employee_code}: ${error.message}`);
    return existing.id;
  }
  const { data, error } = await sb
    .from("employees")
    .insert({ tenant_id: tenantId, employee_code: u.employee_code, ...fields })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to create employee ${u.employee_code}: ${error.message}`);
  console.log(`  Created employee ${u.first_name} ${u.last_name} (${u.employee_code}), wfm_role=${u.wfm_role}`);
  return data.id;
}

async function linkTenantUser(tenantId, userId, employeeId, u) {
  const { data: existing } = await sb
    .from("tenant_users")
    .select("id, role, employee_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  const fields = {
    role: u.tenant_role, employee_id: employeeId,
    display_name: `${u.first_name} ${u.last_name}`.trim(), counted: true,
  };
  if (existing) {
    const { error } = await sb.from("tenant_users").update(fields).eq("id", existing.id);
    if (error) throw new Error(`Failed to update tenant_users for ${u.email}: ${error.message}`);
    console.log(`  Updated membership for ${u.email} -> role=${u.tenant_role}`);
    return;
  }
  const { error } = await sb.from("tenant_users").insert({ tenant_id: tenantId, user_id: userId, ...fields });
  if (error) throw new Error(`Failed to insert tenant_users for ${u.email}: ${error.message}`);
  console.log(`  Linked ${u.email} to this tenant -> role=${u.tenant_role}`);
}

async function main() {
  const tenantId = await findOrCreateTenant();
  const siteId = await findOrCreateSite(tenantId);
  const shiftId = await findOrCreateShift(tenantId);

  const createdPasswords = [];

  for (const u of USERS) {
    console.log(`\n${u.email}:`);
    const { userId, isNew } = await findOrCreateAuthUser(u.email);
    if (isNew) {
      console.log(`  New auth account created.`);
      createdPasswords.push({ email: u.email, password: DEMO_PASSWORD });
    } else {
      console.log(`  Reusing existing auth account (${userId}).`);
    }
    const employeeId = await findOrCreateEmployee(tenantId, u, shiftId, siteId);
    await linkTenantUser(tenantId, userId, employeeId, u);
  }

  console.log(`\nDone.`);
  console.log(`Tenant:  ${TENANT.name}  (slug: ${TENANT.slug})`);
  console.log(`Sign in at: https://${TENANT.custom_domain}`);
  console.log(`Accounts:`);
  for (const u of USERS) {
    const pw = createdPasswords.find((p) => p.email === u.email);
    console.log(`  - ${u.email}  [tenant role: ${u.tenant_role}, wfm role: ${u.wfm_role}]${pw ? `  password: ${pw.password}` : "  (existing password unchanged)"}`);
  }
  if (createdPasswords.length === 0) {
    console.log(`\nBoth accounts already existed in Supabase Auth -- same email/password as on the develop tenant works here too.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
