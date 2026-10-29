import { EXPLICIT_SCOPE_ONLY, scopeAllows, type ApiScopes } from "@/app/api/v1/_auth";
import type { ChangeEntry } from "@/lib/changeLog";
import { PII_FIELDS } from "@/lib/piiFields";

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
  // Tender block of a deal (0220): bid decisions and bond amounts are sensitive, so the "tenders" scope, never the wildcard.
  opportunity_tenders: "tenders", opportunity_competitors: "tenders",
  // Contract projects (0226): budget totals and margin are internal cost, so the explicit "contract_projects" scope, never the wildcard.
  contract_projects: "contract_projects",
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

/** Encrypted-at-rest / contact fields are stored already redacted by diffForLog. This is the read-side
 *  backstop for an older or hand-written row: whatever the stored value, an outbound feed shows "[redacted]". */
export function redactChangeEntries(objectType: string, changes: unknown): unknown {
  const pii = PII_FIELDS[objectType] ?? PII_FIELDS[`${objectType}s`];
  if (!pii || !Array.isArray(changes)) return changes;
  return (changes as ChangeEntry[]).map((c) => {
    if (!c || typeof c !== "object" || !pii.has(String(c.field)) || c.redacted === true) return c;
    return { ...c, from: c.from ? "[redacted]" : null, to: c.to ? "[redacted]" : null, redacted: true };
  });
}

export type ChangeLogEventRow = {
  id: string; object_type: string; object_id: string; object_label: string | null;
  action: string; changes: unknown; actor_email: string | null; created_at: string;
};

/** The one columns list both outbound change feeds read. */
export const CHANGE_EVENT_COLUMNS = "id, object_type, object_id, object_label, action, changes, actor_email, created_at";

/** THE shape of a change on every outbound surface (GET /api/v1/changes and event webhook batches):
 *  internal columns stripped, personal fields redacted. One function, so the two cannot drift. */
export function shapeChangeEvent(r: ChangeLogEventRow) {
  return {
    id: r.id,
    object_type: r.object_type,
    object_id: r.object_id,
    object_label: r.object_label,
    action: r.action,
    changes: redactChangeEntries(r.object_type, stripInternalChangeFields(r.object_type, r.changes)),
    actor: r.actor_email ?? null,
    at: r.created_at,
  };
}

/** The change_log object types that need an explicit grant: the ones whose v1 scope is explicit-only. */
export const EXPLICIT_ONLY_CHANGE_TYPES: string[] = MAPPED_CHANGE_TYPES.filter((t) => {
  const scope = scopeForChangeType(t);
  return scope !== null && EXPLICIT_SCOPE_ONLY.has(scope);
});

/** The object_type filter for an event webhook. "All objects" (or nothing named) carries every
 *  type EXCEPT those that need an explicit grant, exactly like a "*" API key; those are delivered
 *  only when the webhook names them (by change type or by its scope name). A named list is
 *  delivered as named. */
export function webhookTypeFilter(objectTypes: string[] | null | undefined): ChangeTypeFilter {
  const named = Array.isArray(objectTypes) && objectTypes.length ? objectTypes : ["*"];
  if (!named.includes("*")) return { kind: "only", types: named };
  return {
    kind: "except",
    types: EXPLICIT_ONLY_CHANGE_TYPES.filter((t) => !named.includes(t) && !named.includes(scopeForChangeType(t) ?? "")),
  };
}

type TypeFilterable<Q> = { in(col: string, vals: string[]): Q; not(col: string, op: string, val: string): Q };

/** Apply a ChangeTypeFilter to a change_log query. */
export function applyChangeTypeFilter<Q extends TypeFilterable<Q>>(q: Q, filter: ChangeTypeFilter): Q {
  if (filter.kind === "only") return q.in("object_type", filter.types.length ? filter.types : ["__none__"]);
  return filter.types.length ? q.not("object_type", "in", `(${filter.types.join(",")})`) : q;
}
