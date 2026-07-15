import { NextResponse, type NextRequest } from "next/server";
import { isPlatformAdmin } from "@/lib/tenant";
import { createAdminSupabase } from "@/lib/supabase-server";
import { PRIMARY_HOST } from "@/lib/constants";

// POST /api/admin/tenants/[id]/invite — platform admin invites any email into an existing tenant.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const isAdmin = await isPlatformAdmin();
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await request.json();
  const email = (body.email ?? "").trim().toLowerCase();
  const role: "admin" | "member" = body.role === "member" ? "member" : "admin";
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });

  const admin = createAdminSupabase();
  const { data: tenant } = await admin
    .from("tenants")
    .select("name, custom_domain")
    .eq("id", id)
    .maybeSingle();
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

  const host = tenant.custom_domain || PRIMARY_HOST;
  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { tenant_id: id, tenant_name: tenant.name },
    redirectTo: `https://${host}/auth/callback`,
  });

  if (inviteErr || !invited?.user) {
    const message = inviteErr?.message.toLowerCase().includes("already been registered")
      ? "This email already has an account. Use that user's existing tenant membership instead of inviting again."
      : (inviteErr?.message ?? "Failed to invite");
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { error: linkErr } = await admin
    .from("tenant_users")
    .insert({ tenant_id: id, user_id: invited.user.id, role });
  if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
