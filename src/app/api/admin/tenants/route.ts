import { NextResponse, type NextRequest } from "next/server";
import { isPlatformAdmin } from "@/lib/tenant";
import { createAdminSupabase } from "@/lib/supabase-server";
import { PRIMARY_HOST } from "@/lib/constants";

export async function POST(request: NextRequest) {
  const isAdmin = await isPlatformAdmin();
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const { name, slug, accent_color, logo_url, plan, features, admin_email, custom_domain } = body;

  if (!name || !slug) {
    return NextResponse.json({ error: "name and slug are required" }, { status: 400 });
  }

  const admin = createAdminSupabase();

  // Create the tenant
  const { data: tenant, error: tenantErr } = await admin
    .from("tenants")
    .insert({ name, slug, accent_color, logo_url, plan, features, custom_domain: custom_domain || null, status: "active" })
    .select("id")
    .single();

  if (tenantErr) {
    let error = tenantErr.message;
    if (tenantErr.message.includes("unique")) {
      error = tenantErr.message.includes("custom_domain")
        ? `Domain "${custom_domain}" is already in use by another tenant`
        : `Slug "${slug}" is already taken`;
    }
    return NextResponse.json({ error }, { status: 400 });
  }

  // Invite the admin user if email provided
  if (admin_email) {
    const host = custom_domain || PRIMARY_HOST;
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(admin_email, {
      data: { tenant_id: tenant.id, tenant_name: name },
      redirectTo: `https://${host}/auth/callback`,
    });

    if (!inviteErr && invited?.user) {
      await admin.from("tenant_users").insert({
        tenant_id: tenant.id,
        user_id: invited.user.id,
        role: "admin",
      });
    }
  }

  return NextResponse.json({ id: tenant.id });
}
