import { NextResponse } from "next/server";
import { requireTenantUser, createAdminSupabase, findOrCreateUserForInvite } from "@/lib/supabase-server";
import { PRIMARY_HOST } from "@/lib/constants";
import { logAccessChange, roleChange } from "@/lib/peopleAccessLog";
import { diffForLog } from "@/lib/changeLog";

// GET /api/settings/team — list members with email + name
export async function GET() {
  try {
    const { tenantId, role } = await requireTenantUser();
    if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const admin = createAdminSupabase();

    // Get all tenant_users rows for this tenant
    const { data: rows, error } = await admin
      .from("tenant_users")
      .select("user_id, role, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Fetch email + name from auth.users via admin API
    const [members, { data: assignments }] = await Promise.all([
      Promise.all(
        (rows ?? []).map(async (row) => {
          const { data } = await admin.auth.admin.getUserById(row.user_id);
          return {
            user_id: row.user_id,
            role: row.role,
            created_at: row.created_at,
            email: data.user?.email ?? null,
            name: (data.user?.user_metadata?.full_name as string | undefined) ?? null,
          };
        })
      ),
      admin.from("business_user_roles").select("user_id, role_id").eq("tenant_id", tenantId),
    ]);

    const roleIdsByUser = new Map<string, string[]>();
    for (const a of assignments ?? []) {
      const list = roleIdsByUser.get(a.user_id);
      if (list) list.push(a.role_id); else roleIdsByUser.set(a.user_id, [a.role_id]);
    }

    return NextResponse.json({
      members: members.map((m) => ({ ...m, business_role_ids: roleIdsByUser.get(m.user_id) ?? [] })),
    });
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Error" }, { status: err.status ?? 500 });
  }
}

// POST /api/settings/team — add a member by email, either via a branded invite
// email (default) or with an admin-set initial password (pass `password` to
// skip the email entirely). If the email already has an account anywhere,
// it's linked to this tenant directly instead of erroring.
export async function POST(req: Request) {
  try {
    const { supabase, tenantId, role } = await requireTenantUser();
    if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    const email: string = (body.email ?? "").trim().toLowerCase();
    const password: string | undefined = body.password || undefined;
    const memberRole: "admin" | "member" = body.role === "admin" ? "admin" : "member";

    if (!email) return NextResponse.json({ error: "Email required" }, { status: 400 });

    const admin = createAdminSupabase();

    const { data: tenant } = await admin.from("tenants").select("name, custom_domain").eq("id", tenantId).maybeSingle();
    const host = tenant?.custom_domain || PRIMARY_HOST;

    const result = await findOrCreateUserForInvite(admin, email, {
      password,
      inviteData: { tenant_id: tenantId, tenant_name: tenant?.name },
      redirectTo: `https://${host}/auth/callback`,
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    const { userId, isNew } = result;

    if (!isNew) {
      const { data: alreadyMember } = await admin
        .from("tenant_users")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("user_id", userId)
        .maybeSingle();
      if (alreadyMember) {
        return NextResponse.json({ error: "User is already a team member" }, { status: 409 });
      }
    }

    // Forced change only when THIS call created the account with the password: an account that already existed keeps its own
    // password (findOrCreateUserForInvite ignores the one sent), so there is nothing to force.
    const passwordSet = !!password && isNew;
    const { error: insertErr } = await admin
      .from("tenant_users")
      .insert({ tenant_id: tenantId, user_id: userId, role: memberRole, must_change_password: passwordSet });

    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

    await logAccessChange(supabase, {
      tenantId, userId, label: email, action: "create",
      changes: [
        ...roleChange(null, memberRole),
        ...diffForLog("tenant_users", {}, { "sign-in": passwordSet ? "initial password, changed at first sign-in" : isNew ? "invite email sent" : "existing login added" }),
      ],
    });

    return NextResponse.json({ ok: true, user_id: userId, passwordSet });
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Error" }, { status: err.status ?? 500 });
  }
}
