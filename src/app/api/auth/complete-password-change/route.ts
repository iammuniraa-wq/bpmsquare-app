import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";

// POST /api/auth/complete-password-change -- performs the actual password
// update AND clears must_change_password, both for the CALLER's own
// session/membership (userId/tenantId resolved from requireTenantUser(),
// never from a client-supplied id). The password itself is set here, via
// the admin client, rather than trusting that a separate client-side
// supabase.auth.updateUser() call already happened -- that ordering used to
// live only in ForcePasswordChangeForm.tsx's JS, which meant this endpoint
// could be called directly (with valid-but-unrotated session credentials)
// to silently clear the flag without ever changing the password. Requiring
// and applying the new password here closes that: the flag only clears
// when this route itself has just changed the credential.
export async function POST(request: NextRequest) {
  let tenantId, userId;
  try {
    ({ tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const body = await request.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const admin = createAdminSupabase();

  const { error: pwErr } = await admin.auth.admin.updateUserById(userId, { password });
  if (pwErr) return NextResponse.json({ error: pwErr.message }, { status: 400 });

  const { error } = await admin
    .from("tenant_users")
    .update({ must_change_password: false })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
