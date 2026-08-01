import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";

// PUT /api/settings/team/[id]/roles -- replace a member's full set of
// Business Role assignments wholesale (the UI always sends the complete
// intended list, not a diff). An empty list is valid and meaningful: it's
// how an admin returns a member to the "no role assigned" default, i.e.
// today's unrestricted access -- not a way to lock someone out by accident,
// since removing every role widens access rather than narrowing it.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const { id: targetUserId } = await params;
  const body = await request.json();
  const roleIds: string[] = Array.isArray(body.role_ids)
    ? [...new Set((body.role_ids as unknown[]).filter((r): r is string => typeof r === "string"))]
    : [];

  const { data: member } = await supabase.from("tenant_users").select("id").eq("tenant_id", tenantId).eq("user_id", targetUserId).maybeSingle();
  if (!member) return NextResponse.json({ error: "Team member not found" }, { status: 404 });

  // Verify every supplied role id actually belongs to this tenant before
  // assigning it -- a client-supplied id is never trusted as-is.
  if (roleIds.length > 0) {
    const { data: validRoles } = await supabase.from("business_roles").select("id").eq("tenant_id", tenantId).in("id", roleIds);
    if (!validRoles || validRoles.length !== roleIds.length) {
      return NextResponse.json({ error: "One or more roles were not found" }, { status: 404 });
    }
  }

  const { error: dErr } = await supabase.from("business_user_roles").delete().eq("tenant_id", tenantId).eq("user_id", targetUserId);
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });

  if (roleIds.length > 0) {
    const { error: iErr } = await supabase.from("business_user_roles").insert(
      roleIds.map((roleId) => ({ tenant_id: tenantId, user_id: targetUserId, role_id: roleId }))
    );
    if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
