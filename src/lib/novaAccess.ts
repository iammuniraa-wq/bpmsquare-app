import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase-server";
import { featureForObject } from "@/lib/objectFeatures";
import { resolvePermissions, canViewWorkcenter } from "@/lib/permissions";
import type { WorkcenterKey } from "@/lib/workcenters";
import type { TenantFeatures } from "@/lib/constants";

/**
 * Who may see a record's Nova comments. A comment thread is part of the record,
 * so it follows the record's own gates: the workspace must own the module that
 * owns the object (OBJECT_FEATURE), and a member with scoped Business Roles
 * must hold a view grant on the object's workcenter. Audit 2026-10-21, L1:
 * until now any member could read and post on any object type of the workspace.
 *
 * `table` is the object's table (the record's existence is verified against it,
 * tenant-scoped). `feature` is the OBJECT_FEATURE key. `workcenters` are the
 * grants that open the object's own pages: any one with canView unlocks it,
 * the same rule global search uses (SEARCH_OBJECTS).
 */
export const NOVA_OBJECTS: Record<string, { table: string; feature: string; workcenters: WorkcenterKey[] }> = {
  accounts: { table: "accounts", feature: "accounts", workcenters: ["accounts"] },
  contacts: { table: "contacts", feature: "contacts", workcenters: ["contacts"] },
  quotes: { table: "quotes", feature: "quotes", workcenters: ["quotations"] },
  standard_quotes: { table: "standard_quotes", feature: "standard_quotes", workcenters: ["standard_quotes"] },
  cases: { table: "service_cases", feature: "cases", workcenters: ["cases"] },
  work_orders: { table: "work_orders", feature: "work_orders", workcenters: ["work_orders"] },
  invoices: { table: "invoices", feature: "invoices", workcenters: ["invoices"] },
  assets: { table: "assets", feature: "assets", workcenters: ["assets"] },
  suppliers: { table: "suppliers", feature: "suppliers", workcenters: ["suppliers"] },
  products: { table: "products", feature: "products", workcenters: ["products"] },
  opportunities: { table: "opportunities", feature: "opportunities", workcenters: ["pipeline"] },
  inventory: { table: "inventory_items", feature: "inventory", workcenters: ["inventory"] },
  purchase_orders: { table: "purchase_orders", feature: "purchase_orders", workcenters: ["purchase_orders"] },
  // Workforce supervisors reach employees through the WFM hub, not an "employees" grant.
  employees: { table: "employees", feature: "employees", workcenters: ["employees", "wfm"] },
  wfm_projects: { table: "wfm_projects", feature: "wfm_projects", workcenters: ["wfm"] },
  rfqs: { table: "rfqs", feature: "rfqs", workcenters: ["rfqs"] },
  estimates: { table: "estimates", feature: "estimates", workcenters: ["estimates"] },
  leads: { table: "leads", feature: "leads", workcenters: ["leads"] },
  abm_programs: { table: "abm_programs", feature: "abm_programs", workcenters: ["abm"] },
  abm_targets: { table: "abm_target_accounts", feature: "abm_targets", workcenters: ["abm"] },
};

/**
 * The subset of `types` this caller may see comments for. One read of the
 * tenant's features and one permission resolve, however many types are asked.
 */
export async function allowedNovaTypes(args: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  role: "admin" | "member";
  types: string[];
}): Promise<Set<string>> {
  const wanted = [...new Set(args.types)].filter((t) => NOVA_OBJECTS[t]);
  if (wanted.length === 0) return new Set();

  const [{ data: tenant }, perms] = await Promise.all([
    createAdminSupabase().from("tenants").select("features").eq("id", args.tenantId).maybeSingle(),
    resolvePermissions(args.supabase, args.tenantId, args.userId, args.role),
  ]);
  const features = (tenant?.features ?? {}) as TenantFeatures;

  const allowed = new Set<string>();
  for (const t of wanted) {
    const def = NOVA_OBJECTS[t];
    const key = featureForObject(def.feature);
    if (key !== null && !features[key]) continue;
    if (!def.workcenters.some((w) => canViewWorkcenter(perms, w))) continue;
    allowed.add(t);
  }
  return allowed;
}
