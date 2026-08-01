import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { WORKCENTERS, type WorkcenterKey } from "@/lib/permissions";

const VALID_WORKCENTERS = new Set<string>(WORKCENTERS.map((w) => w.key));

export type GrantInput = {
  workcenter: string;
  can_view?: boolean;
  can_create?: boolean;
  can_edit?: boolean;
  can_delete?: boolean;
  data_scope?: string;
  territories?: string[];
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
      data_scope: g.data_scope === "territory" ? "territory" : "all",
      territories: g.data_scope === "territory" && Array.isArray(g.territories) ? g.territories.filter((t) => typeof t === "string") : [],
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

  const { data: roles, error } = await supabase
    .from("business_roles")
    .select("id, name, description, created_at")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: grants } = await supabase
    .from("business_role_grants")
    .select("role_id, workcenter, can_view, can_create, can_edit, can_delete, data_scope, territories")
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

  const body = await request.json();
  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const { data: created, error } = await supabase
    .from("business_roles")
    .insert({ tenant_id: tenantId, name, description: body.description || null })
    .select("id, name, description, created_at")
    .single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "A role with this name already exists" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const grantRows = sanitizeGrants(body.grants, tenantId, created.id);
  if (grantRows.length > 0) {
    const { error: gErr } = await supabase.from("business_role_grants").insert(grantRows);
    if (gErr) return NextResponse.json({ error: gErr.message }, { status: 500 });
  }

  return NextResponse.json({ ...created, grants: grantRows }, { status: 201 });
}
