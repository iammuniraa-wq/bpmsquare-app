import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// The person's name for the "By" of a history row: the label set on the business user, else the linked employee's name.
// Never an email address (an employee's login is a generated address nobody should read). Tenant-scoped on the
// service-role client; a missing column or table (migration 0057 pending) just gives no names.

type UserRow = { user_id: string; display_name: string | null; employee_id: string | null };
type EmpRow = { id: string; first_name: string | null; last_name: string | null };

export async function loadActorNames(admin: SupabaseClient, tenantId: string, actorIds: readonly (string | null)[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(actorIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return out;
  const { data: users, error } = await admin.from("tenant_users").select("user_id, display_name, employee_id").eq("tenant_id", tenantId).in("user_id", ids);
  if (error) return out;
  const rows = (users ?? []) as UserRow[];
  const empIds = [...new Set(rows.map((u) => u.employee_id).filter((x): x is string => !!x))];
  const emps = new Map<string, string>();
  if (empIds.length) {
    const { data } = await admin.from("employees").select("id, first_name, last_name").eq("tenant_id", tenantId).in("id", empIds);
    for (const e of (data ?? []) as EmpRow[]) {
      const n = `${e.first_name ?? ""} ${e.last_name ?? ""}`.trim();
      if (n) emps.set(e.id, n);
    }
  }
  for (const u of rows) {
    const name = u.display_name?.trim() || (u.employee_id ? emps.get(u.employee_id) : undefined);
    if (name) out.set(u.user_id, name);
  }
  return out;
}
