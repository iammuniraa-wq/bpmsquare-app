import { NextResponse, type NextRequest } from "next/server";
import { isPlatformAdmin } from "@/lib/tenant";
import { createAdminSupabase, findOrCreateUserForInvite } from "@/lib/supabase-server";
import { PRIMARY_HOST } from "@/lib/constants";

// POST /api/admin/tenants/[id]/invite — platform admin adds any email into an
// existing tenant. If the email already has an account (in this tenant or any
// other), it's linked directly instead of erroring -- one person can belong to
// more than one tenant. `password` is optional: set it to create the account
// with that password immediately (no invite email); omit it to send the
// branded invite email as before.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const isAdmin = await isPlatformAdmin();
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await request.json();
  const email = (body.email ?? "").trim().toLowerCase();
  const password: string | undefined = body.password || undefined;
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
  const result = await findOrCreateUserForInvite(admin, email, {
    password,
    inviteData: { tenant_id: id, tenant_name: tenant.name },
    redirectTo: `https://${host}/auth/callback`,
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  const { userId, isNew } = result;

  if (!isNew) {
    const { data: alreadyMember } = await admin
      .from("tenant_users")
      .select("id")
      .eq("tenant_id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (alreadyMember) {
      return NextResponse.json({ error: "This user is already a member of this tenant" }, { status: 409 });
    }
  }

  const { error: linkErr } = await admin
    .from("tenant_users")
    .insert({ tenant_id: id, user_id: userId, role });
  if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 400 });

  return NextResponse.json({ ok: true, passwordSet: !!password && isNew });
}
