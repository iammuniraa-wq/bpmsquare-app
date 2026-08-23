import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";

// Coverage's `teams`/`segments`/`coverages` tables are SELECT-only RLS
// (0101_coverage.sql -- a forged row here can reassign account ownership or
// reroute ERP pushes, so every write goes through the admin client behind
// an explicit role==="admin" check, never the session client).

export async function GET() {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { data, error } = await supabase
    .from("teams").select("*, team_members(user_id)")
    .eq("tenant_id", tenantId).order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  let supabase, tenantId, role, userId;
  try {
    ({ supabase, tenantId, role, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const { name, lead_user_id, member_user_ids } = body as {
    name?: string; lead_user_id?: string | null; member_user_ids?: string[];
  };
  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const admin = createAdminSupabase();

  // lead_user_id/member_user_ids are foreign ids from the request body --
  // verify each is actually a member of this tenant before writing (not a
  // data-exposure risk here since nothing is read back for them, but a
  // stray/typo'd id would otherwise silently become an unreachable "owner"
  // no report or dashboard could ever resolve).
  const memberIds = [...new Set((member_user_ids ?? []).filter((x): x is string => typeof x === "string"))];
  const candidateIds = [...new Set([...(lead_user_id ? [lead_user_id] : []), ...memberIds])];
  if (candidateIds.length > 0) {
    const { data: validUsers } = await admin.from("tenant_users").select("user_id").eq("tenant_id", tenantId).in("user_id", candidateIds);
    const validSet = new Set((validUsers ?? []).map((u) => u.user_id));
    if (lead_user_id && !validSet.has(lead_user_id)) {
      return NextResponse.json({ error: "lead_user_id is not a member of this workspace" }, { status: 404 });
    }
    if (memberIds.some((id) => !validSet.has(id))) {
      return NextResponse.json({ error: "One or more members are not part of this workspace" }, { status: 404 });
    }
  }

  const { data: team, error } = await admin
    .from("teams")
    .insert({ tenant_id: tenantId, name, lead_user_id: lead_user_id ?? null })
    .select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (memberIds.length > 0) {
    await admin.from("team_members").insert(
      memberIds.map((user_id) => ({ tenant_id: tenantId, team_id: team.id, user_id }))
    );
  }

  await logChange(supabase, {
    tenantId, objectType: "teams", objectId: team.id, objectLabel: team.name,
    action: "create", actorId: userId,
  });
  return NextResponse.json(team, { status: 201 });
}
