import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const cleanDate = (v: unknown) => (typeof v === "string" && DATE_RE.test(v) ? v : null);

// PATCH /api/business-users/[userId] -- edit the business-user fields of one
// membership: display name, lock/unlock, validity window, counted flag, or
// set a new password (straight through Supabase Auth's admin API -- BPMSquare
// never stores it). userId is the auth user id, same key Settings -> Team
// already uses.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  let supabase, tenantId, role, userId;
  try {
    ({ supabase, tenantId, role, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await tenantHasFeature(supabase, tenantId, "business_roles"))) {
    return NextResponse.json({ error: "Business Roles isn't enabled for your workspace" }, { status: 403 });
  }

  const { userId: targetUserId } = await params;
  const admin = createAdminSupabase();

  const { data: member } = await admin
    .from("tenant_users")
    .select("id, role")
    .eq("tenant_id", tenantId)
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: "Business user not found" }, { status: 404 });

  const body = await request.json();

  // Locking yourself out mid-session would be confusing at best; locking
  // another ADMIN is allowed (that's a legitimate offboarding action), but
  // your own row is off-limits, same rule as Settings -> Team's self-removal
  // block.
  if (body.is_locked === true && targetUserId === userId) {
    return NextResponse.json({ error: "You can't lock your own account" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if ("display_name" in body) {
    const v = typeof body.display_name === "string" ? body.display_name.trim().slice(0, 200) : "";
    patch.display_name = v || null;
  }
  if ("is_locked" in body) patch.is_locked = !!body.is_locked;
  if ("valid_from" in body) patch.valid_from = cleanDate(body.valid_from);
  if ("valid_to" in body) patch.valid_to = cleanDate(body.valid_to);
  if ("counted" in body) patch.counted = !!body.counted;

  if (Object.keys(patch).length > 0) {
    const { error } = await admin.from("tenant_users").update(patch).eq("id", member.id).eq("tenant_id", tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Optional password reset, admin-set -- e.g. after an employee forgets
  // theirs, or to force a known initial password. Supabase Auth is the sole
  // owner of the credential; this just calls its admin API. A password is
  // GLOBAL to the auth account, not per-tenant -- so this is only allowed
  // when this tenant is the user's sole membership. A user who also belongs
  // to another tenant must use the normal forgot-password flow instead;
  // letting one tenant's admin rotate a credential that another tenant's
  // user also logs in with would be a cross-tenant takeover vector.
  if (typeof body.new_password === "string" && body.new_password) {
    if (body.new_password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }
    const { count } = await admin
      .from("tenant_users")
      .select("id", { count: "exact", head: true })
      .eq("user_id", targetUserId);
    if ((count ?? 0) > 1) {
      return NextResponse.json(
        { error: "This user belongs to more than one workspace — they must reset their own password via 'Forgot password' on the login page" },
        { status: 409 }
      );
    }
    const { error: pwErr } = await admin.auth.admin.updateUserById(targetUserId, { password: body.new_password });
    if (pwErr) return NextResponse.json({ error: pwErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
