import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// The people of one workspace, by id, for showing an owner's name and for
// picking an owner. Auth users are looked up one by one: a workspace has a
// handful of members, and the id list comes from tenant_users first so a user
// of another workspace can never appear.

export type WorkspacePerson = { user_id: string; role: string; email: string | null; name: string | null };

export async function listWorkspacePeople(admin: SupabaseClient, tenantId: string): Promise<WorkspacePerson[]> {
  const { data: rows, error } = await admin
    .from("tenant_users").select("user_id, role, created_at")
    .eq("tenant_id", tenantId).order("created_at", { ascending: true }).limit(200);
  if (error || !rows) return [];
  return Promise.all(rows.map(async (r) => {
    const { data } = await admin.auth.admin.getUserById(r.user_id as string).catch(() => ({ data: null }));
    return {
      user_id: r.user_id as string,
      role: r.role as string,
      email: data?.user?.email ?? null,
      name: (data?.user?.user_metadata?.full_name as string | undefined) ?? null,
    };
  }));
}

export function personLabel(p: Pick<WorkspacePerson, "email" | "name"> | undefined | null): string {
  if (!p) return "Nobody yet";
  return p.name || (p.email ? p.email.split("@")[0] : "Unknown");
}

/** True when this user belongs to the workspace. The check every owner id from a request must pass. */
export async function isWorkspaceMember(admin: SupabaseClient, tenantId: string, userId: string): Promise<boolean> {
  const { data } = await admin.from("tenant_users").select("user_id").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle();
  return !!data;
}
