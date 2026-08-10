import { NextResponse } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";

// POST /api/auth/complete-password-change -- clears must_change_password on
// the CALLER's own membership for the CURRENT tenant (both resolved from
// the session via requireTenantUser(), never from a client-supplied id).
// Called right after the browser's own supabase.auth.updateUser({password})
// succeeds on /force-password-change -- this route never touches the
// password itself, only the flag that gated access to the rest of the app.
export async function POST() {
  let tenantId, userId;
  try {
    ({ tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const admin = createAdminSupabase();
  const { error } = await admin
    .from("tenant_users")
    .update({ must_change_password: false })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
