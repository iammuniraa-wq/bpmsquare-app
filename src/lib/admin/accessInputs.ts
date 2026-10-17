import "server-only";
import { createAdminSupabase } from "@/lib/supabase-server";
import { isMembershipActive } from "@/lib/constants";
import { resolveAccess, type AccessInput, type GrantRow } from "@/lib/accessView";

/**
 * What each member of ONE tenant resolves to (admin-panel "Who sees what").
 * Four batched reads, every one filtered to the tenant, and nothing written.
 * The service-role client is deliberate -- this page is platform-admin only
 * (admin/layout.tsx) and reads other people's access -- so the tenant filter
 * on each query is the isolation (MULTI_TENANT_GUARDRAILS.md).
 */
export async function loadAccessInputs(tenantId: string): Promise<Record<string, AccessInput>> {
  const admin = createAdminSupabase();

  const [{ data: members }, { data: assignments }, { data: roles }, { data: grants }] = await Promise.all([
    admin.from("tenant_users").select("user_id, role, employee_id, is_locked, valid_from, valid_to").eq("tenant_id", tenantId),
    admin.from("business_user_roles").select("user_id, role_id").eq("tenant_id", tenantId),
    admin.from("business_roles").select("id, name").eq("tenant_id", tenantId),
    admin.from("business_role_grants").select("role_id, workcenter, can_view, can_edit").eq("tenant_id", tenantId),
  ]);

  const employeeIds = [...new Set((members ?? []).map((m) => m.employee_id as string | null).filter((x): x is string => !!x))];
  const supervisors = new Set<string>();
  if (employeeIds.length > 0) {
    const { data: employees } = await admin
      .from("employees")
      .select("id, wfm_role, status")
      .eq("tenant_id", tenantId)
      .in("id", employeeIds);
    for (const e of employees ?? []) if (e.status === "active" && e.wfm_role === "supervisor") supervisors.add(e.id as string);
  }

  const roleName = new Map((roles ?? []).map((r) => [r.id as string, r.name as string]));
  const out: Record<string, AccessInput> = {};
  for (const m of members ?? []) {
    const role = (m.role as "admin" | "member") ?? "member";
    const assigned = (assignments ?? []).filter((a) => a.user_id === m.user_id).map((a) => a.role_id as string);
    const resolved = resolveAccess({
      role,
      assignedRoleIds: assigned,
      grants: (grants ?? []) as GrantRow[],
      employeeIsActiveSupervisor: !!m.employee_id && supervisors.has(m.employee_id as string),
    });
    const active = isMembershipActive({
      is_locked: m.is_locked as boolean | null,
      valid_from: m.valid_from as string | null,
      valid_to: m.valid_to as string | null,
    });
    out[m.user_id as string] = {
      role,
      ...resolved,
      roleNames: assigned.map((id) => roleName.get(id)).filter((n): n is string => !!n),
      blocked: active ? null : m.is_locked ? "This login is locked" : "This login is outside its valid dates",
    };
  }
  return out;
}
