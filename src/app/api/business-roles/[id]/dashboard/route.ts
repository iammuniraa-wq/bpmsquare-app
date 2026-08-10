import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import type { DashLayoutItem } from "@/lib/constants";

function sanitizeLayout(input: unknown): DashLayoutItem[] {
  if (!Array.isArray(input)) return [];
  const out: DashLayoutItem[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object" || typeof (item as { id?: unknown }).id !== "string") continue;
    const size = (item as { size?: unknown }).size;
    out.push({
      id: (item as { id: string }).id,
      hidden: !!(item as { hidden?: unknown }).hidden,
      ...(size === "compact" || size === "half" || size === "full" ? { size } : {}),
    });
  }
  return out;
}

// PATCH /api/business-roles/[id]/dashboard -- set or clear the dashboard
// this role's members see by default. Read by every user assigned this role
// (unioned across all their assigned roles -- see the dashboard page), so
// this is intentionally not scoped to any one user. Same admin gating and
// standard-role lock as editing a role's grants (PATCH /api/business-roles/
// [id]) -- a locked standard role must be duplicated to get a custom
// dashboard, same as duplicating it to get custom grants.
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
  if (existing.is_standard) {
    return NextResponse.json(
      { error: "Standard roles can't be edited. Duplicate this role to give it a custom dashboard." },
      { status: 409 }
    );
  }

  const body = await request.json().catch(() => null);
  const layout = body?.dashboard_layout === null ? null : sanitizeLayout(body?.dashboard_layout);

  const { error } = await supabase.from("business_roles").update({ dashboard_layout: layout }).eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
