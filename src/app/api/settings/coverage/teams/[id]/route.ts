import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { diffForLog, logChange } from "@/lib/changeLog";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let supabase, tenantId, role, userId;
  try {
    ({ supabase, tenantId, role, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminSupabase();
  const { data: before } = await admin.from("teams").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json();
  const { name, lead_user_id, member_user_ids } = body as {
    name?: string; lead_user_id?: string | null; member_user_ids?: string[];
  };

  // lead_user_id/member_user_ids are foreign ids from the request body --
  // verify each is actually a member of this tenant before writing.
  const memberIds = Array.isArray(member_user_ids) ? [...new Set(member_user_ids.filter((x): x is string => typeof x === "string"))] : [];
  const candidateIds = [...new Set([...(lead_user_id ? [lead_user_id] : []), ...memberIds])];
  if (candidateIds.length > 0) {
    const { data: validUsers } = await admin.from("tenant_users").select("user_id").eq("tenant_id", tenantId).in("user_id", candidateIds);
    const validSet = new Set((validUsers ?? []).map((u) => u.user_id));
    if (lead_user_id && !validSet.has(lead_user_id)) {
      return NextResponse.json({ error: "lead_user_id is not a member of this workspace" }, { status: 404 });
    }
    if (memberIds.some((mid) => !validSet.has(mid))) {
      return NextResponse.json({ error: "One or more members are not part of this workspace" }, { status: 404 });
    }
  }

  const patch: Record<string, unknown> = {};
  if (typeof name === "string") patch.name = name;
  if (lead_user_id !== undefined) patch.lead_user_id = lead_user_id;

  const { data: team, error } = await admin
    .from("teams").update(patch).eq("id", id).eq("tenant_id", tenantId).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (Array.isArray(member_user_ids)) {
    await admin.from("team_members").delete().eq("team_id", id).eq("tenant_id", tenantId);
    if (memberIds.length > 0) {
      await admin.from("team_members").insert(
        memberIds.map((user_id) => ({ tenant_id: tenantId, team_id: id, user_id }))
      );
    }
  }

  const changes = diffForLog("teams", before, patch);
  if (changes.length > 0) {
    await logChange(supabase, {
      tenantId, objectType: "teams", objectId: id, objectLabel: team.name,
      action: "update", actorId: userId, changes,
    });
  }
  return NextResponse.json(team);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let supabase, tenantId, role, userId;
  try {
    ({ supabase, tenantId, role, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminSupabase();
  const { data: before } = await admin.from("teams").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Coverage rows referencing this team cascade-delete (fk on delete cascade) --
  // any coverage wiring built on it goes with it, same as any other config delete.
  const { error } = await admin.from("teams").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logChange(supabase, {
    tenantId, objectType: "teams", objectId: id, objectLabel: before.name,
    action: "delete", actorId: userId,
  });
  return NextResponse.json({ ok: true });
}
