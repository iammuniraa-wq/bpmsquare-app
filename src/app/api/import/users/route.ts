import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";

export async function POST(request: NextRequest) {
  let tenantId, role;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") {
    return NextResponse.json({ error: "Only admins can invite users" }, { status: 403 });
  }

  const { rows } = await request.json() as { rows: Record<string, string>[] };
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "No rows provided" }, { status: 400 });
  }

  const admin = createAdminSupabase();

  // Get existing tenant member emails to skip duplicates
  const { data: existing } = await admin
    .from("tenant_users")
    .select("user_id")
    .eq("tenant_id", tenantId);
  const existingUserIds = new Set((existing ?? []).map((u: { user_id: string }) => u.user_id));

  const errors: { row: number; error: string }[] = [];
  let inserted = 0;
  let skipped  = 0;

  for (let i = 0; i < rows.length; i++) {
    const row   = rows[i];
    const email = row.email?.trim().toLowerCase();
    const name  = row.name?.trim();
    const memberRole: "admin" | "member" = row.role?.trim() === "admin" ? "admin" : "member";

    if (!email) { errors.push({ row: i + 3, error: "email is required" }); continue; }
    if (!name)  { errors.push({ row: i + 3, error: "name is required" }); continue; }

    // Check if user already exists in auth
    const { data: existingUser } = await admin.auth.admin.listUsers();
    const found = existingUser?.users?.find((u) => u.email?.toLowerCase() === email);

    let userId: string;

    if (found) {
      userId = found.id;
      // If already a member of this tenant, skip
      if (existingUserIds.has(userId)) { skipped++; continue; }
    } else {
      // Invite new user
      const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: name },
      });
      if (inviteErr || !invited?.user) {
        errors.push({ row: i + 3, error: inviteErr?.message ?? "Failed to invite" });
        continue;
      }
      userId = invited.user.id;
    }

    // Add to tenant_users
    const { error: tuErr } = await admin
      .from("tenant_users")
      .insert({ tenant_id: tenantId, user_id: userId, role: memberRole });

    if (tuErr) {
      if (tuErr.code === "23505") { skipped++; continue; } // unique constraint = already a member
      errors.push({ row: i + 3, error: tuErr.message });
      continue;
    }

    inserted++;
    existingUserIds.add(userId);
  }

  return NextResponse.json({ inserted, skipped, errors });
}
