import { NextResponse, type NextRequest } from "next/server";
import { isPlatformAdmin } from "@/lib/tenant";
import { createAdminSupabase } from "@/lib/supabase-server";
import { PRIMARY_HOST } from "@/lib/constants";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const isAdmin = await isPlatformAdmin();
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { email } = await request.json();
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });

  const admin = createAdminSupabase();
  const { data: tenant } = await admin
    .from("tenants")
    .select("name, custom_domain")
    .eq("id", id)
    .maybeSingle();
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

  const host = tenant.custom_domain || PRIMARY_HOST;
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { tenant_id: id, tenant_name: tenant.name },
    redirectTo: `https://${host}/auth/callback`,
  });

  if (error) {
    const message = error.message.toLowerCase().includes("already been registered")
      ? "This user already accepted their invite and set a password — ask them to use ‘Forgot your password?’ instead."
      : error.message;
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
