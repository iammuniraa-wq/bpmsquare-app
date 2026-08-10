import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { resyncStandardRole } from "@/lib/standardRolesServer";

// POST /api/business-roles/[id]/resync -- re-syncs an already-provisioned
// standard role's grants and description against the current catalog
// (src/lib/standardRoles.ts). Admin-only, and only for standard roles --
// see resyncStandardRole for why this has to be explicit rather than
// automatic. This is how a catalog fix (e.g. dropping a grant a standard
// role shouldn't have had) actually reaches a tenant that provisioned the
// role before the fix shipped, not just brand-new tenants.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  const result = await resyncStandardRole(supabase, tenantId, id);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ ok: true });
}
