import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { isMembershipActive } from "@/lib/constants";

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
    .select("id, role, is_locked, valid_from, valid_to, employee_id, display_name")
    .eq("tenant_id", tenantId)
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: "Business user not found" }, { status: 404 });

  const body = await request.json();

  const patch: Record<string, unknown> = {};

  // Link an existing login to an employee record after the fact -- resolves
  // the "same person exists as an employee AND as an 'other login'" split.
  // Only ever links (employee_id is never cleared or swapped through this
  // route); the unique index on (tenant_id, employee_id) backstops the
  // one-login-per-employee rule against races.
  if (typeof body.employee_id === "string" && body.employee_id) {
    if (member.employee_id && member.employee_id !== body.employee_id) {
      return NextResponse.json({ error: "This login is already linked to a different employee" }, { status: 409 });
    }
    const { data: employee } = await supabase
      .from("employees")
      .select("id, first_name, last_name")
      .eq("id", body.employee_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    const { data: taken } = await admin
      .from("tenant_users")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("employee_id", employee.id)
      .neq("id", member.id)
      .maybeSingle();
    if (taken) return NextResponse.json({ error: "That employee already has a business user" }, { status: 409 });
    patch.employee_id = employee.id;
    if (!member.display_name) patch.display_name = `${employee.first_name} ${employee.last_name}`.trim();
  }

  if ("display_name" in body) {
    const v = typeof body.display_name === "string" ? body.display_name.trim().slice(0, 200) : "";
    patch.display_name = v || null;
  }
  if ("is_locked" in body) patch.is_locked = !!body.is_locked;
  if ("valid_from" in body) patch.valid_from = cleanDate(body.valid_from);
  if ("valid_to" in body) patch.valid_to = cleanDate(body.valid_to);
  if ("counted" in body) patch.counted = !!body.counted;

  // Locking yourself out mid-session would be confusing at best; deactivating
  // another ADMIN is allowed (that's legitimate offboarding, and platform
  // admins can always recover a tenant), but your own row must stay active --
  // same rule as Settings -> Team's self-removal block. Checked against the
  // MERGED prospective state, so a self-set past valid_to (or future
  // valid_from) is caught the same as is_locked -- middleware treats every
  // inactive membership identically, so this guard has to as well.
  if (targetUserId === userId) {
    const prospective = { ...member, ...patch } as { is_locked?: boolean | null; valid_from?: string | null; valid_to?: string | null };
    if (!isMembershipActive(prospective)) {
      return NextResponse.json({ error: "You can't lock your own account or set your own validity to exclude today" }, { status: 400 });
    }
  }

  if (Object.keys(patch).length > 0) {
    let update = admin.from("tenant_users").update(patch).eq("id", member.id).eq("tenant_id", tenantId);
    // When linking, the earlier read-then-check on member.employee_id isn't
    // atomic -- two concurrent links to the same membership could both see
    // null and the second would silently swap the first. Re-assert the
    // precondition inside the UPDATE itself (only-null-or-same), and treat
    // zero rows updated as the same 409 the pre-check gives.
    if (typeof patch.employee_id === "string") {
      update = update.or(`employee_id.is.null,employee_id.eq.${patch.employee_id}`);
    }
    const { data: updatedRows, error } = await update.select("id");
    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "That employee already has a business user" }, { status: 409 });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!updatedRows || updatedRows.length === 0) {
      return NextResponse.json({ error: "This login is already linked to a different employee" }, { status: 409 });
    }
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
    // Same as a fresh initial password on creation -- an admin-set password
    // forces the recipient to choose their own on next login.
    const { error: mcpErr } = await admin.from("tenant_users").update({ must_change_password: true }).eq("id", member.id).eq("tenant_id", tenantId);
    if (mcpErr) return NextResponse.json({ error: mcpErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
