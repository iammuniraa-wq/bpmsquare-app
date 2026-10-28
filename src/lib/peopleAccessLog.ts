import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthUser } from "@/lib/supabase-server";
import { diffForLog, logChange, logChangeBatch, type ChangeEntry, type ChangeLogAction } from "@/lib/changeLog";

// Every change to who can sign in, and with what access, lands in the change history under one object type, keyed by the
// login's auth user id (it outlives the membership row, so a removed login keeps its history). Nothing here ever receives
// a password: callers describe a password event, they never pass the value.

export const ACCESS_OBJECT_TYPE = "tenant_users";

/** The login's e-mail, used as the human label of its history. Null when the auth lookup fails: a label is never worth failing a save. */
export async function loginLabel(admin: { auth: { admin: { getUserById: (id: string) => Promise<{ data: { user: { email?: string | null } | null } | null }> } } }, userId: string): Promise<string | null> {
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    return data?.user?.email ?? null;
  } catch {
    return null;
  }
}

/** The membership fields an admin can edit, under the names the history should show. */
const FIELD_NAMES: Record<string, string> = { is_locked: "locked", display_name: "display name", valid_from: "valid from", valid_to: "valid to", counted: "counted user" };

/** What changed on a membership: only the fields in `patch` that differ from `before`. */
export function membershipChanges(before: Record<string, unknown>, patch: Record<string, unknown>): ChangeEntry[] {
  const renamedBefore: Record<string, unknown> = {};
  const renamedPatch: Record<string, unknown> = {};
  for (const [col, name] of Object.entries(FIELD_NAMES)) {
    if (col in patch) {
      renamedBefore[name] = col === "is_locked" ? !!before[col] : before[col] ?? null;
      renamedPatch[name] = col === "is_locked" ? !!patch[col] : patch[col];
    }
  }
  return diffForLog(ACCESS_OBJECT_TYPE, renamedBefore, renamedPatch);
}

export const roleChange = (from: string | null, to: string): ChangeEntry[] => diffForLog(ACCESS_OBJECT_TYPE, { role: from }, { role: to });

/** The names of a set of Business Roles, sorted, as one value; null for none. */
export const roleNamesValue = (names: readonly string[]): string | null => (names.length ? [...names].sort((a, b) => a.localeCompare(b)).join(", ") : null);

export const PASSWORD_RESET_ENTRY: ChangeEntry = { field: "password", from: null, to: "reset: changes at next sign-in" };

type Params = { tenantId: string; userId: string; label: string | null; action: ChangeLogAction; changes: ChangeEntry[] };

/** One history row for a login, with the signed-in admin as the actor. An update that changed nothing writes nothing. */
export async function logAccessChange(session: SupabaseClient, p: Params): Promise<void> {
  if (p.action === "update" && p.changes.length === 0) return;
  const actor = await getAuthUser();
  await logChange(session, {
    tenantId: p.tenantId, objectType: ACCESS_OBJECT_TYPE, objectId: p.userId, objectLabel: p.label,
    action: p.action, actorId: actor?.id ?? null, actorEmail: actor?.email ?? null, changes: p.changes,
  });
}

/** Many logins created in one request (the Data Workbench import). */
export async function logAccessBatch(session: SupabaseClient, tenantId: string, rows: readonly Omit<Params, "tenantId" | "action">[]): Promise<void> {
  if (rows.length === 0) return;
  const actor = await getAuthUser();
  await logChangeBatch(session, rows.map((r) => ({
    tenantId, objectType: ACCESS_OBJECT_TYPE, objectId: r.userId, objectLabel: r.label, action: "create" as const,
    actorId: actor?.id ?? null, actorEmail: actor?.email ?? null, changes: r.changes,
  })));
}
