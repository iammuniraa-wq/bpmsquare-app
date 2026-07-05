import { NextResponse } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { createAdminSupabase } from "@/lib/supabase-server";

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
    const members = await Promise.all(
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
    );

    return NextResponse.json({ members });
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Error" }, { status: err.status ?? 500 });
  }
}

// POST /api/settings/team — invite a new member by email
export async function POST(req: Request) {
  try {
    const { tenantId, role } = await requireTenantUser();
    if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    const email: string = (body.email ?? "").trim().toLowerCase();
    const memberRole: "admin" | "member" = body.role === "admin" ? "admin" : "member";

    if (!email) return NextResponse.json({ error: "Email required" }, { status: 400 });

    const admin = createAdminSupabase();

    // Check if user already exists by email
    const { data: existing } = await admin.auth.admin.listUsers();
    const existingUser = existing?.users?.find((u) => u.email === email);

    let userId: string;

    if (existingUser) {
      userId = existingUser.id;

      // Check not already in this tenant
      const { data: alreadyMember } = await admin
        .from("tenant_users")
        .select("user_id")
        .eq("tenant_id", tenantId)
        .eq("user_id", userId)
        .maybeSingle();

      if (alreadyMember) {
        return NextResponse.json({ error: "User is already a team member" }, { status: 409 });
      }
    } else {
      // Send Supabase invite email — creates auth user
      const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email);
      if (inviteErr) return NextResponse.json({ error: inviteErr.message }, { status: 500 });
      userId = invited.user.id;
    }

    // Insert tenant_users row
    const { error: insertErr } = await admin
      .from("tenant_users")
      .insert({ tenant_id: tenantId, user_id: userId, role: memberRole });

    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, user_id: userId });
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Error" }, { status: err.status ?? 500 });
  }
}
