import type { SupabaseClient } from "@supabase/supabase-js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Which of `userIds` are NOT members of this workspace. A deal's owner and team
 * come from the request body, and a user id is only meaningful inside the
 * tenant it belongs to (audit 2026-10-21, L2): one query, tenant-scoped, so a
 * user of another workspace simply matches no row. Anything that is not a UUID
 * is unknown without asking the database.
 */
export async function unknownWorkspaceMembers(
  admin: SupabaseClient,
  tenantId: string,
  userIds: string[]
): Promise<string[]> {
  const wanted = [...new Set(userIds)];
  if (wanted.length === 0) return [];
  const valid = wanted.filter((id) => UUID.test(id));
  let found = new Set<string>();
  if (valid.length > 0) {
    const { data } = await admin
      .from("tenant_users")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .in("user_id", valid);
    found = new Set((data ?? []).map((r) => r.user_id as string));
  }
  return wanted.filter((id) => !found.has(id));
}

/**
 * The error text for a failed owner/team check, or null when every id is a
 * member. `existing` ids (already on the deal) are not re-checked, so saving an
 * unrelated change never fails because a colleague has since left the workspace.
 */
export async function ownerTeamProblem(
  admin: SupabaseClient,
  tenantId: string,
  input: { owner?: string | null; team?: { user_id: string }[] },
  existing: string[] = []
): Promise<string | null> {
  const skip = new Set(existing);
  const owner = input.owner && !skip.has(input.owner) ? input.owner : null;
  const team = (input.team ?? []).map((t) => t.user_id).filter((id) => !skip.has(id));
  const unknown = new Set(await unknownWorkspaceMembers(admin, tenantId, [...(owner ? [owner] : []), ...team]));
  if (owner && unknown.has(owner)) return "owner_id is not a member of this workspace";
  if (team.some((id) => unknown.has(id))) return "team contains a user who is not a member of this workspace";
  return null;
}
