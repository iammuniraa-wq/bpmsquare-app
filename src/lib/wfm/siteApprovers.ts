import "server-only";

import type { createAdminSupabase } from "@/lib/supabase-server";

type Admin = ReturnType<typeof createAdminSupabase>;

/**
 * Additional approvers per site (0124).
 *
 * A site's PRIMARY supervisor is still wfm_sites.supervisor_id — that column
 * is what the reporting tree hangs off, and nothing here changes it. These
 * rows are extra people who may also approve for that site: peers, not a
 * hierarchy, so that one supervisor going on leave doesn't freeze every
 * comp-off / sick-leave / WFH request at their site (BIM, 2026-09-10).
 *
 * Every function tolerates 0124 being pending (42P01) by behaving as if no
 * site had extra approvers — which is precisely the pre-0124 product. That is
 * the §3b rule, and it is what lets this ship to main before the SQL is run.
 */

/** True when the failure is just "0124 hasn't been applied yet". */
function pendingMigration(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "42703";
}

/** Site ids that any of `employeeIds` is listed as an extra approver for. */
export async function sitesApprovedBy(
  admin: Admin,
  tenantId: string,
  employeeIds: string[]
): Promise<string[]> {
  if (employeeIds.length === 0) return [];
  const { data, error } = await admin
    .from("wfm_site_approvers")
    .select("site_id")
    .eq("tenant_id", tenantId)
    .in("employee_id", employeeIds);
  if (error) return []; // 0124 pending, or a read failure — no extra reach, never a crash
  return [...new Set((data ?? []).map((r) => r.site_id as string))];
}

/** Employee ids listed as extra approvers for `siteId`. */
export async function approversForSite(
  admin: Admin,
  tenantId: string,
  siteId: string
): Promise<string[]> {
  const { data, error } = await admin
    .from("wfm_site_approvers")
    .select("employee_id")
    .eq("tenant_id", tenantId)
    .eq("site_id", siteId);
  if (error) return [];
  return (data ?? []).map((r) => r.employee_id as string);
}

/** siteId -> extra approver employee ids, for the whole tenant. */
export async function approversBySite(
  admin: Admin,
  tenantId: string
): Promise<Record<string, string[]>> {
  const { data, error } = await admin
    .from("wfm_site_approvers")
    .select("site_id, employee_id")
    .eq("tenant_id", tenantId);
  if (error) return {};
  const out: Record<string, string[]> = {};
  for (const row of data ?? []) {
    const site = row.site_id as string;
    (out[site] ??= []).push(row.employee_id as string);
  }
  return out;
}

/**
 * Replace a site's extra-approver list.
 *
 * Every id comes from a request body, so each one is verified against this
 * tenant's own active employees before it is written (MULTI_TENANT_GUARDRAILS:
 * "any foreign id read from the request body ... verify it resolves to a row
 * with tenant_id = tenantId BEFORE using it"). Unlike verifySiteSupervisor
 * this does NOT promote anyone to wfm_role = supervisor: an extra approver is
 * granted authority over one site's requests, and silently handing them a
 * supervisor's tenant-wide visibility would be a bigger grant than the admin
 * asked for. canApproveFor() accepts them on the strength of this row alone.
 */
export async function setSiteApprovers(
  admin: Admin,
  tenantId: string,
  siteId: string,
  employeeIds: unknown
): Promise<{ ok: true; ids: string[] } | { error: string }> {
  if (!Array.isArray(employeeIds)) return { error: "approver_ids must be an array of employee ids" };
  const wanted = [...new Set(employeeIds.filter((v): v is string => typeof v === "string" && v.length > 0))];

  if (wanted.length > 0) {
    const { data: verified, error } = await admin
      .from("employees")
      .select("id, status")
      .eq("tenant_id", tenantId)
      .in("id", wanted);
    if (error) return { error: "Could not verify those employees" };
    const byId = new Map((verified ?? []).map((e) => [e.id as string, e]));
    for (const id of wanted) {
      const emp = byId.get(id);
      if (!emp) return { error: "Unknown employee in approver_ids" };
      if (emp.status !== "active") return { error: "An inactive employee can't be a site approver" };
    }
  }

  // Replace wholesale: the client always sends the full intended list, so a
  // removed name has to actually disappear.
  const { error: delErr } = await admin
    .from("wfm_site_approvers")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("site_id", siteId);
  if (delErr) {
    if (pendingMigration(delErr)) return { error: "Extra site approvers need migration 0124 — run it first." };
    return { error: delErr.message };
  }

  if (wanted.length > 0) {
    const { error: insErr } = await admin
      .from("wfm_site_approvers")
      .insert(wanted.map((employee_id) => ({ tenant_id: tenantId, site_id: siteId, employee_id })));
    if (insErr) {
      if (pendingMigration(insErr)) return { error: "Extra site approvers need migration 0124 — run it first." };
      return { error: insErr.message };
    }
  }

  return { ok: true, ids: wanted };
}
