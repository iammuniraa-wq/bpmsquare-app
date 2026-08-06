import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { STANDARD_ROLES, expandCrud, type StandardRoleTemplate } from "./standardRoles";
import type { WorkcenterKey } from "./workcenters";

/**
 * Materialise the standard role catalog into this tenant's business_roles.
 * Idempotent and safe to call on every Roles page load: rows are matched on
 * (tenant_id, template_key) -- which 0065 makes uniquely indexed -- so a
 * concurrent double-load can't create duplicates.
 *
 * Deliberately NEVER updates a template row that already exists. Re-syncing
 * an existing standard role's grants is a separate, explicit operation (see
 * `resyncStandardRole`), because silently rewriting grants underneath a
 * live tenant would change people's access with no audit trail and no way
 * to opt out.
 *
 * Best-effort: a failure here must not take down the Roles page, so errors
 * are logged and swallowed. The page then simply shows whatever roles do
 * exist.
 */
export async function provisionStandardRoles(
  admin: SupabaseClient,
  tenantId: string
): Promise<void> {
  const { data: existing, error } = await admin
    .from("business_roles")
    .select("template_key")
    .eq("tenant_id", tenantId)
    .not("template_key", "is", null);
  if (error) {
    console.error("provisionStandardRoles: read failed", error.message);
    return;
  }

  const have = new Set((existing ?? []).map((r) => r.template_key as string));
  const missing = STANDARD_ROLES.filter((t) => !have.has(t.key));
  if (missing.length === 0) return;

  // A tenant may already have a hand-made role using a standard name (the
  // WFM auto-provisioning shipped "WFM Supervisor"/"WFM Employee" before
  // this catalog existed). business_roles has unique(tenant_id, name), so
  // inserting a colliding name would 23505 and lose the whole batch --
  // suffix instead of failing, and let the admin tidy up if they want.
  const { data: named } = await admin
    .from("business_roles")
    .select("name")
    .eq("tenant_id", tenantId);
  const takenNames = new Set((named ?? []).map((r) => (r.name as string).toLowerCase()));

  for (const template of missing) {
    let name = template.name;
    if (takenNames.has(name.toLowerCase())) name = `${template.name} (standard)`;
    if (takenNames.has(name.toLowerCase())) continue; // give up rather than loop

    const { data: role, error: insErr } = await admin
      .from("business_roles")
      .insert({
        tenant_id: tenantId,
        name,
        description: template.description,
        template_key: template.key,
        is_standard: true,
      })
      .select("id")
      .single();
    if (insErr) {
      // 23505 = another request provisioned this template first. Fine.
      if ((insErr as { code?: string }).code !== "23505") {
        console.error(`provisionStandardRoles: insert ${template.key} failed`, insErr.message);
      }
      continue;
    }
    takenNames.add(name.toLowerCase());

    const grantRows = grantRowsFor(template, tenantId, role.id);
    if (grantRows.length > 0) {
      const { error: gErr } = await admin.from("business_role_grants").insert(grantRows);
      if (gErr) console.error(`provisionStandardRoles: grants ${template.key} failed`, gErr.message);
    }
  }
}

export function grantRowsFor(template: StandardRoleTemplate, tenantId: string, roleId: string) {
  return (Object.entries(template.grants) as [WorkcenterKey, Parameters<typeof expandCrud>[0]][]).map(
    ([workcenter, crud]) => ({
      tenant_id: tenantId,
      role_id: roleId,
      workcenter,
      ...expandCrud(crud),
      data_scope: "all",
      territories: [] as string[],
    })
  );
}
