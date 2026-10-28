import { NextResponse } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { loginLabel, logAccessChange, roleChange } from "@/lib/peopleAccessLog";

// PATCH /api/settings/team/[id] — change role
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, tenantId, role } = await requireTenantUser();
    if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id: targetUserId } = await params;
    const body = await req.json();
    const newRole: "admin" | "member" = body.role === "admin" ? "admin" : "member";

    const admin = createAdminSupabase();
    const { data: before } = await admin
      .from("tenant_users")
      .select("role")
      .eq("tenant_id", tenantId)
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (!before) return NextResponse.json({ error: "Team member not found" }, { status: 404 });

    const { error } = await admin
      .from("tenant_users")
      .update({ role: newRole })
      .eq("tenant_id", tenantId)
      .eq("user_id", targetUserId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (before.role !== newRole) {
      await logAccessChange(supabase, {
        tenantId, userId: targetUserId, label: await loginLabel(admin, targetUserId), action: "update",
        changes: roleChange(before.role, newRole),
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Error" }, { status: err.status ?? 500 });
  }
}

// DELETE /api/settings/team/[id] — remove member from tenant
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, tenantId, userId, role } = await requireTenantUser();
    if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id: targetUserId } = await params;

    // Prevent self-removal
    if (targetUserId === userId) {
      return NextResponse.json({ error: "Cannot remove yourself" }, { status: 400 });
    }

    const admin = createAdminSupabase();
    const { data: before } = await admin
      .from("tenant_users")
      .select("role")
      .eq("tenant_id", tenantId)
      .eq("user_id", targetUserId)
      .maybeSingle();
    const label = before ? await loginLabel(admin, targetUserId) : null;

    const { error } = await admin
      .from("tenant_users")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("user_id", targetUserId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (before) {
      await logAccessChange(supabase, {
        tenantId, userId: targetUserId, label, action: "delete",
        changes: [{ field: "role", from: before.role, to: null }],
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Error" }, { status: err.status ?? 500 });
  }
}
