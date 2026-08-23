import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { WORKCENTERS, type WorkcenterKey } from "@/lib/permissions";
import { provisionStandardRoles, grantRowsFor } from "@/lib/standardRolesServer";
import { STANDARD_ROLE_BY_KEY } from "@/lib/standardRoles";

const VALID_WORKCENTERS = new Set<string>(WORKCENTERS.map((w) => w.key));

export type GrantInput = {
  workcenter: string;
  can_view?: boolean;
  can_create?: boolean;
  can_edit?: boolean;
  can_delete?: boolean;
};

/** Drops anything not on the canonical workcenter list and coerces every
 * field to the shape the DB expects -- a client-supplied grants array is
 * never trusted as-is. */
function sanitizeGrants(input: unknown, tenantId: string, roleId: string) {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  for (const g of input as GrantInput[]) {
    if (!g || typeof g.workcenter !== "string" || !VALID_WORKCENTERS.has(g.workcenter) || seen.has(g.workcenter)) continue;
    seen.add(g.workcenter);
    const canView = g.can_view !== false; // a grant row implies at least view access
    rows.push({
      tenant_id: tenantId,
      role_id: roleId,
      workcenter: g.workcenter as WorkcenterKey,
      can_view: canView,
      can_create: !!g.can_create,
      can_edit: !!g.can_edit,
      can_delete: !!g.can_delete,
    });
  }
  return rows;
}

// GET /api/business-roles -- list every Business Role with its grants.
// Read is allowed for any tenant member (Settings > Team needs the list to
// assign roles to people); only create/update/delete are admin-gated below.
export async function GET() {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  // Degrade to "no roles" rather than an error when the feature is off --
  // Settings -> Team calls this to populate its role-assignment picker, and
  // an empty list there is the correct "nothing to assign yet" state.
  if (!(await tenantHasFeature(supabase, tenantId, "business_roles"))) {
    return NextResponse.json({ roles: [] });
  }

  // Materialise any standard roles this tenant doesn't have yet. Idempotent,
  // best-effort, and never updates an existing one -- see
  // provisionStandardRoles. Uses the admin client because RLS on
  // business_roles is tenant-isolation-only and the session client can't
  // insert for a tenant the caller is merely a member of.
  await provisionStandardRoles(createAdminSupabase(), tenantId);

  const { data: roles, error } = await supabase
    .from("business_roles")
    .select("id, name, description, created_at, template_key, is_standard, dashboard_layout")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: grants } = await supabase
    .from("business_role_grants")
    .select("role_id, workcenter, can_view, can_create, can_edit, can_delete")
    .eq("tenant_id", tenantId);

  const grantsByRole = new Map<string, unknown[]>();
  for (const g of grants ?? []) {
    const list = grantsByRole.get(g.role_id);
    if (list) list.push(g); else grantsByRole.set(g.role_id, [g]);
  }

  return NextResponse.json({
    roles: (roles ?? []).map((r) => ({ ...r, grants: grantsByRole.get(r.id) ?? [] })),
  });
}

// POST /api/business-roles -- create a role with its initial grants.
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

  // Duplicate mode: { duplicate_of: <role id> } copies an existing role --
  // the supported way to customise a standard role, which is itself locked
  // so the catalog stays safely re-syncable (BUSINESS_ROLES_STANDARD_MAP.md
  // §2). The copy is a normal editable role: is_standard false, no
  // template_key.
  if (typeof body.duplicate_of === "string" && body.duplicate_of) {
    const { data: source } = await supabase
      .from("business_roles")
      .select("id, name, description, template_key")
      .eq("id", body.duplicate_of)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!source) return NextResponse.json({ error: "Role not found" }, { status: 404 });

    const { data: sourceGrants } = await supabase
      .from("business_role_grants")
      .select("workcenter, can_view, can_create, can_edit, can_delete")
      .eq("tenant_id", tenantId)
      .eq("role_id", source.id);

    const copyName = await uniqueName(supabase, tenantId, (body.name ?? `${source.name} (copy)`).trim());
    const { data: created, error } = await supabase
      .from("business_roles")
      .insert({ tenant_id: tenantId, name: copyName, description: source.description })
      .select("id, name, description, created_at, template_key, is_standard")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = (sourceGrants ?? []).map((g) => ({ ...g, tenant_id: tenantId, role_id: created.id }));
    if (rows.length > 0) {
      const { error: gErr } = await supabase.from("business_role_grants").insert(rows);
      if (gErr) return NextResponse.json({ error: gErr.message }, { status: 500 });
    }
    return NextResponse.json({ ...created, grants: rows }, { status: 201 });
  }

  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const { data: created, error } = await supabase
    .from("business_roles")
    .insert({ tenant_id: tenantId, name, description: body.description || null })
    .select("id, name, description, created_at, template_key, is_standard")
    .single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "A role with this name already exists" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // A brand-new role can optionally be seeded from a catalog template
  // (Roles page "start from a standard role" path) instead of client-sent
  // grants, so the catalog stays the single source of truth for those.
  const template = typeof body.from_template === "string" ? STANDARD_ROLE_BY_KEY.get(body.from_template) : undefined;
  const grantRows = template
    ? grantRowsFor(template, tenantId, created.id)
    : sanitizeGrants(body.grants, tenantId, created.id);
  if (grantRows.length > 0) {
    const { error: gErr } = await supabase.from("business_role_grants").insert(grantRows);
    if (gErr) return NextResponse.json({ error: gErr.message }, { status: 500 });
  }

  return NextResponse.json({ ...created, grants: grantRows }, { status: 201 });
}

/** Appends " 2", " 3", ... until the name is free for this tenant. */
async function uniqueName(supabase: SupabaseClient, tenantId: string, base: string): Promise<string> {
  const { data } = await supabase.from("business_roles").select("name").eq("tenant_id", tenantId);
  const taken = new Set((data ?? []).map((r) => (r.name as string).toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${Date.now()}`;
}
