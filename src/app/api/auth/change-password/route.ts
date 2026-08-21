import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";

// POST /api/auth/change-password — VOLUNTARY self-service password change for
// the caller's own login (Account Settings in the WFM portal). Distinct from
// /api/auth/complete-password-change, which is the FORCED first-login flow:
// there the user just authenticated, so no current-password proof is needed
// and it also clears must_change_password. Here the session may be long-lived,
// so we require the current password and verify it before changing anything —
// otherwise anyone at an unlocked session could silently take over the login.
// Works the same for a synthetic employee-code login (its email is the
// synthetic address) as for a real email login.
export async function POST(request: NextRequest) {
  let userId;
  try {
    ({ userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const body = await request.json().catch(() => null);
  const current = typeof body?.current_password === "string" ? body.current_password : "";
  const next = typeof body?.new_password === "string" ? body.new_password : "";
  if (!current) return NextResponse.json({ error: "Enter your current password" }, { status: 400 });
  if (next.length < 8) return NextResponse.json({ error: "New password must be at least 8 characters" }, { status: 400 });
  if (next === current) return NextResponse.json({ error: "Choose a password different from your current one" }, { status: 400 });

  const admin = createAdminSupabase();
  const { data: userRes } = await admin.auth.admin.getUserById(userId);
  const email = userRes?.user?.email;
  if (!email) return NextResponse.json({ error: "No login found for this account" }, { status: 400 });

  // Verify the current password on a throwaway client that persists nothing —
  // a failed sign-in here neither touches nor rotates the real session.
  const verifier = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { error: vErr } = await verifier.auth.signInWithPassword({ email, password: current });
  if (vErr) return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });

  const { error: pwErr } = await admin.auth.admin.updateUserById(userId, { password: next });
  if (pwErr) return NextResponse.json({ error: pwErr.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
