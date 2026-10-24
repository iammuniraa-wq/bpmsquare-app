import { scopeAllows, type ApiScopes } from "@/app/api/v1/_auth";
import type { ChangeEntry } from "@/lib/changeLog";

// GET /api/v1/changes is the change_log of the whole workspace. It used to be
// reachable with ANY read-scoped key and returned every object type, so a key
// scoped to "products" read the changes of employees, supplier RFQ prices and
// estimates, and a "*" key read the very objects the wildcard is documented NOT
// to reach (audit 2026-10-21, M1). The feed now follows the same scope rule as
// the list endpoints: a change is shown only to a key that could read the object
// it belongs to.
//
// change_log.object_type -> the v1 scope name that governs reading that object.
// A type with no entry (assets, suppliers, work orders, leads,
// journeys ...) has no v1 endpoint of its own, so it is reachable through the
// wildcard only, exactly like the list endpoints that do not exist for it.
const SCOPE_FOR_TYPE: Record<string, string> = {
  accounts: "accounts", account: "accounts",
  quotes: "quotations", quote: "quotations",
  cases: "cases", case: "cases",
  invoices: "invoices", invoice: "invoices",
  purchase_orders: "purchase-orders", purchase_order: "purchase-orders",
  inventory: "inventory",
  products: "products", product: "products",
  employees: "employees",
  contacts: "contacts", contact: "contacts",
  // Supplier prices are commercially sensitive (0128): the RFQ scope, never the wildcard.
  rfqs: "rfqs", pricing_rfqs: "rfqs",
  estimates: "estimates", estimate: "estimates", estimate_templates: "estimates",
  opportunities: "opportunities",
  wfm_projects: "projects",
  abm_programs: "abm_programs", abm_program: "abm_programs",
  abm_target_accounts: "abm_targets", abm_buying_group_members: "abm_targets", abm_target: "abm_targets",
  // Standard quotes (0053): the same class of data as quotations (a customer-facing price, no personal
  // data), so like quotations the wildcard reaches them and a named key must name "standard_quotes".
  standard_quotes: "standard_quotes", standard_quote: "standard_quotes",
  // Sales orders (0212): a customer-facing document with no personal data in the v1 shape, so like quotations the wildcard
  // reaches them and a named key must name "sales_orders". Order types are settings, not an API object: wildcard-only.
  sales_orders: "sales_orders", sales_order: "sales_orders",
};

/** Columns that are internal by design and are kept out of every API select; the feed must not
 *  carry them back out as the from/to of a change. */
const INTERNAL_FIELDS: Record<string, ReadonlySet<string>> = {
  products: new Set(["cost_price"]),
  product: new Set(["cost_price"]),
};

export function scopeForChangeType(objectType: string): string | null {
  return SCOPE_FOR_TYPE[objectType] ?? null;
}

/** Every change_log object type the code maps to a scope, for building the query. */
export const MAPPED_CHANGE_TYPES = Object.keys(SCOPE_FOR_TYPE);

export function canReadChangeType(scopes: ApiScopes, objectType: string): boolean {
  if (!scopes.read) return false;
  const scope = scopeForChangeType(objectType);
  if (scope) return scopeAllows(scopes, scope, false);
  return scopes.objects.includes("*");
}

export type ChangeTypeFilter =
  | { kind: "only"; types: string[] }      // restrict to exactly these object types
  | { kind: "except"; types: string[] };   // everything except these object types

/** The object_type filter to put on the query for this key. */
export function changeTypeFilter(scopes: ApiScopes): ChangeTypeFilter {
  if (scopes.objects.includes("*")) {
    return { kind: "except", types: MAPPED_CHANGE_TYPES.filter((t) => !canReadChangeType(scopes, t)) };
  }
  return { kind: "only", types: MAPPED_CHANGE_TYPES.filter((t) => canReadChangeType(scopes, t)) };
}

export function stripInternalChangeFields(objectType: string, changes: unknown): unknown {
  const internal = INTERNAL_FIELDS[objectType];
  if (!internal || !Array.isArray(changes)) return changes;
  return (changes as ChangeEntry[]).filter((c) => !(c && typeof c === "object" && internal.has(String(c.field))));
}
