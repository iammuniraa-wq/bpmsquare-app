import { createAdminSupabase } from "@/lib/supabase-server";
import type { TenantFeatures } from "@/lib/constants";

/**
 * Object -> the module a tenant has to have bought to see it, anywhere.
 *
 * Written 2026-09-22 after the snasquare workspace showed Cases, Contacts,
 * Assets and Quotations tabs on the Account page despite owning none of
 * those modules. The tabs were one symptom; the audit found the same hole
 * on every v1 API endpoint and every Data Workbench route, because each
 * surface decided for itself which objects a tenant may reach -- and four
 * of them simply never asked.
 *
 * So the question is asked in exactly one place now. The keys are every
 * name any surface uses for an object, including the spellings that differ
 * between surfaces (Data Workbench says `quotes` and `purchase_orders`, v1
 * says `quotations` and `purchase-orders`) -- deliberately listed rather
 * than normalised, so a lookup can never quietly miss.
 *
 * `null` means "deliberately ungated", and each one says why. Anything
 * absent throws: a new object added without a decision here fails the
 * gating test (`objectFeatures.test.ts`) rather than shipping open.
 */
export const OBJECT_FEATURE: Record<string, keyof TenantFeatures | null> = {
  accounts: "accounts",
  assets: "assets",
  cases: "cases",
  contacts: "contacts",
  // Employees ship as part of the Business Roles/Business Users module --
  // same key the nav item uses (constants.ts NAV).
  employees: "business_roles",
  // Inventory is the stock side of Purchasing; it has never had a key of
  // its own, and the nav gates it on `purchasing` too.
  inventory: "purchasing",
  invoices: "invoices",
  // Reachable through /api/v1/ask rather than an endpoint of its own, but
  // it is a LIST_SOURCES object, so it needs a module behind it like any
  // other.
  leads: "leads",
  opportunities: "pipeline",
  pricing: "pricing_engine",
  products: "products",
  projects: "wfm_projects",
  wfm_projects: "wfm_projects",
  purchase_orders: "purchasing",
  "purchase-orders": "purchasing",
  quotes: "quotations",
  quotations: "quotations",
  // The DW quote-lines object has its own narrower opt-in (a tenant can
  // own Quotations without being allowed to bulk-edit lines).
  quote_lines: "quote_lines_dw",
  suppliers: "suppliers",
  work_orders: "work_orders",
  "work-orders": "work_orders",
  // Workspace users are not a sold module -- they are how anyone
  // administers the workspace at all. Gated on `administration` for the
  // same reason the nav item is.
  users: "administration",
};

/** The feature a surface must check before exposing `object`. Throws on an
 *  object nobody has decided about, which is the point. */
export function featureForObject(object: string): keyof TenantFeatures | null {
  if (!(object in OBJECT_FEATURE)) {
    throw new Error(
      `No feature mapping for object "${object}". Add it to OBJECT_FEATURE in src/lib/objectFeatures.ts before exposing it on any surface.`
    );
  }
  return OBJECT_FEATURE[object];
}

/** Does this tenant own the module that owns `object`? */
export async function tenantOwnsObject(tenantId: string, object: string): Promise<boolean> {
  const key = featureForObject(object);
  if (key === null) return true;
  const { data } = await createAdminSupabase()
    .from("tenants")
    .select("features")
    .eq("id", tenantId)
    .maybeSingle();
  return !!(data?.features as TenantFeatures | undefined)?.[key];
}

/**
 * API-route guard. Returns a ready-to-return 404 when the tenant does not
 * own the module, or null to continue.
 *
 * 404 and not 403 on purpose (bpmsquarecore §3b): a tenant without the
 * module should not learn the endpoint exists.
 *
 *   const gate = await assertObjectFeature(tenantId, "products");
 *   if (gate) return gate;
 */
export async function assertObjectFeature(
  tenantId: string,
  object: string
): Promise<Response | null> {
  if (await tenantOwnsObject(tenantId, object)) return null;
  return Response.json({ error: "Not found" }, { status: 404 });
}
