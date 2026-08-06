import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { WORKCENTERS, type WorkcenterKey } from "@/lib/permissions";
import type { GrantInput } from "../route";

const VALID_WORKCENTERS = new Set<string>(WORKCENTERS.map((w) => w.key));

function sanitizeGrants(input: unknown, tenantId: string, roleId: string) {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  for (const g of input as GrantInput[]) {
    if (!g || typeof g.workcenter !== "string" || !VALID_WORKCENTERS.has(g.workcenter) || seen.has(g.workcenter)) continue;
    seen.add(g.workcenter);
    rows.push({
      tenant_id: tenantId,
      role_id: roleId,
      workcenter: g.workcenter as WorkcenterKey,
      can_view: g.can_view !== false,
      can_create: !!g.can_create,
      can_edit: !!g.can_edit,
      can_delete: !!g.can_delete,
      data_scope: g.data_scope === "territory" ? "territory" : "all",
      territories: g.data_scope === "territory" && Array.isArray(g.territories) ? g.territories.filter((t) => typeof t === "string") : [],
    });
  }
  return rows;
}

// PATCH /api/business-roles/[id] -- rename/redescribe a role and replace its
// grants wholesale (simplest correct approach for a small per-role grant
// list -- delete then reinsert, same pattern quote line-item edits already use).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params;
  const { data: existing } = await supabase.from("business_roles").select("id, is_standard").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Role not found" }, { status: 404 });
  // Enforced here, not just hidden in the UI -- a locked standard role is
  // what lets the catalog be re-synced later without ever overwriting a
  // customer's own edits (BUSINESS_ROLES_STANDARD_MAP.md §2).
  if (existing.is_standard) {
    return NextResponse.json(
      { error: "Standard roles can't be edited. Duplicate this role to make a version you can change." },
      { status: 409 }
    );
  }

  const body = await request.json();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if ("description" in body) patch.description = body.description || null;

  const { error: uErr } = await supabase.from("business_roles").update(patch).eq("id", id).eq("tenant_id", tenantId);
  if (uErr) {
    if (uErr.code === "23505") return NextResponse.json({ error: "A role with this name already exists" }, { status: 409 });
    return NextResponse.json({ error: uErr.message }, { status: 500 });
  }

  if ("grants" in body) {
    const { error: dErr } = await supabase.from("business_role_grants").delete().eq("role_id", id).eq("tenant_id", tenantId);
    if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });

    const grantRows = sanitizeGrants(body.grants, tenantId, id);
    if (grantRows.length > 0) {
      const { error: iErr } = await supabase.from("business_role_grants").insert(grantRows);
      if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/business-roles/[id] -- grants and any business_user_roles
// assignments cascade via FK, so a user holding only this role reverts to
// the "no role assigned" default (today's unrestricted access), not to
// zero access.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params;
  const { data: existing } = await supabase
    .from("business_roles").select("id, is_standard").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Role not found" }, { status: 404 });
  // Deleting a standard role would just have it re-provisioned on the next
  // page load, so refuse clearly rather than appear to work and then undo
  // itself. (Unassign it from users instead.)
  if (existing.is_standard) {
    return NextResponse.json(
      { error: "Standard roles can't be deleted. Unassign it from users instead." },
      { status: 409 }
    );
  }

  const { error } = await supabase.from("business_roles").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
