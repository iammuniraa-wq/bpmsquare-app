import { NextResponse } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";

// PATCH /api/settings/team/[id] — change role
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { tenantId, userId, role } = await requireTenantUser();
    if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id: targetUserId } = await params;
    const body = await req.json();
    const newRole: "admin" | "member" = body.role === "admin" ? "admin" : "member";

    const { error } = await createAdminSupabase()
      .from("tenant_users")
      .update({ role: newRole })
      .eq("tenant_id", tenantId)
      .eq("user_id", targetUserId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    void userId; // used only for auth check above

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
    const { tenantId, userId, role } = await requireTenantUser();
    if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id: targetUserId } = await params;

    // Prevent self-removal
    if (targetUserId === userId) {
      return NextResponse.json({ error: "Cannot remove yourself" }, { status: 400 });
    }

    const { error } = await createAdminSupabase()
      .from("tenant_users")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("user_id", targetUserId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Error" }, { status: err.status ?? 500 });
  }
}
