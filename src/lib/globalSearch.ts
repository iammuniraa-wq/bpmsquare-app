// Global search -- object registry + result shape. Pure and dependency-free
// so it's safe to import from the client (the search bar's "search only in…"
// object picker) and the server (the query executor in lib/data/live.ts),
// same split as lib/marketingSegmentation.ts.

import type { WorkcenterKey, ViewableWorkcenters } from "./workcenters";

export type SearchObjectType =
  | "account" | "contact" | "asset" | "case" | "quote"
  | "work_order" | "purchase_order" | "invoice" | "inventory_item"
  | "supplier" | "lead" | "employee";

export type SearchObjectDef = {
  type: SearchObjectType;
  label: string;
  icon: string;
  /** Mirrors NavItem.featureKey (lib/constants.ts) -- if set, this object is
   * only searchable when the tenant has AT LEAST ONE of these features
   * enabled, same gate as the page it links to. Undefined = a core object
   * every tenant has. */
  featureKeys?: string[];
  /** Which workcenter grant(s) make this object visible to a member with
   * scoped Business Roles -- ANY listed workcenter with canView unlocks it.
   * Mirrors the page-level requireWorkcenterView gate on the object's own
   * list page, so search can never surface an object the sidebar (and its
   * pages) would deny. */
  workcenters: WorkcenterKey[];
};

/** Order here is the order results are grouped in when searching "All
 * objects". Adding a new searchable object means one entry here plus one
 * ObjectQuerySpec in lib/data/live.ts's globalSearchLive(). */
export const SEARCH_OBJECTS: SearchObjectDef[] = [
  // Core objects carry their 0067 module flag too -- without it a tenant
  // that never bought a module (e.g. WFM-only) still got its search scope.
  { type: "account", label: "Accounts", icon: "▣", featureKeys: ["accounts"], workcenters: ["accounts"] },
  { type: "contact", label: "Contacts", icon: "◉", featureKeys: ["contacts"], workcenters: ["contacts"] },
  { type: "case", label: "Cases", icon: "☎", featureKeys: ["cases"], workcenters: ["cases"] },
  { type: "quote", label: "Quotations", icon: "₹", featureKeys: ["quotations"], workcenters: ["quotations"] },
  { type: "work_order", label: "Work Orders", icon: "▦", featureKeys: ["work_orders"], workcenters: ["work_orders"] },
  { type: "invoice", label: "Invoices", icon: "▥", featureKeys: ["invoices"], workcenters: ["invoices"] },
  { type: "purchase_order", label: "Purchase Orders", icon: "▤", featureKeys: ["purchasing"], workcenters: ["purchase_orders"] },
  { type: "asset", label: "Assets", icon: "⚙", featureKeys: ["assets"], workcenters: ["assets"] },
  { type: "inventory_item", label: "Inventory", icon: "▧", featureKeys: ["purchasing"], workcenters: ["inventory"] },
  { type: "supplier", label: "Suppliers", icon: "⌂", featureKeys: ["suppliers"], workcenters: ["suppliers"] },
  { type: "lead", label: "Leads", icon: "✦", featureKeys: ["leads"], workcenters: ["leads"] },
  // Workforce: visible via the Employees master-data grant, or to WFM
  // supervisors (whose access comes from wfm canEdit / employee record, not
  // an "employees" grant) -- see wfmSupervisor handling in allowedSearchTypes.
  { type: "employee", label: "Workforce", icon: "⚇", featureKeys: ["business_roles", "wfm"], workcenters: ["employees"] },
];

/** Filters the registry down to what this tenant actually has enabled --
 * shared by the client (dropdown options) and server (which tables get
 * queried at all) so both agree on the same list. */
export function searchObjectsForFeatures(features?: Record<string, boolean>): SearchObjectDef[] {
  return SEARCH_OBJECTS.filter((o) => !o.featureKeys || o.featureKeys.some((k) => features?.[k] === true));
}

export function getSearchObject(type: string): SearchObjectDef | undefined {
  return SEARCH_OBJECTS.find((o) => o.type === type);
}

/**
 * Which object types the caller's Business Role grants let them search --
 * "all" when unrestricted (admins, members with no role assigned). Shared by
 * the search bar (client, from TenantProvider's viewableWorkcenters) and
 * /api/search (server, from resolvePermissions) so the dropdown and the
 * results always agree. `wfmSupervisor` additionally unlocks Workforce, whose
 * supervisor surfaces aren't gated by a viewable workcenter.
 */
export function allowedSearchTypes(
  viewable: ViewableWorkcenters,
  wfmSupervisor: boolean
): "all" | SearchObjectType[] {
  if (viewable === "all") return "all";
  const set = new Set(viewable);
  return SEARCH_OBJECTS
    .filter((o) => o.workcenters.some((wc) => set.has(wc)) || (o.type === "employee" && wfmSupervisor))
    .map((o) => o.type);
}

export type SearchResult = {
  type: SearchObjectType;
  id: string;
  title: string;
  subtitle: string;
  href: string;
  /** Which field matched -- shown as a small hint, e.g. "phone" for a PII
   * fallback match that wouldn't otherwise be obvious from title/subtitle. */
  matched: string;
};
