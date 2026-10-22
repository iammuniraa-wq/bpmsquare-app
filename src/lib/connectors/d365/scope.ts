// A saved Scope per entity: which records of the connected system a pull reads, every time (Sync now, the
// automatic schedule and Full resync). "Customers: Class is A, B, C and Territory is North, East".
// Pure and client-safe. A condition is an attribute of the record in the ERP (never free text typed into a
// search); everything that reaches a $filter is checked against a strict pattern for its kind, and every
// string literal goes through odataString(). Attribute names are checked against the system's own field list
// when a scope is saved (scopeServer.ts); here they only have to be plain identifiers.

import type { ErpField } from "@/lib/middleware/metadata";
import { D365_SCOPE_COMMON, type ScopeCommon } from "./catalog";
import { odataString } from "./mapping";
import type { D365EntityKey, D365Product, EntityScope, ScopeCondition, ScopeKind } from "./types";

export const MAX_SCOPE_CONDITIONS = 5;
export const MAX_SCOPE_VALUES = 50;
/** A long OR chain would exceed the URL limits of Business Central and some gateways. */
export const MAX_SCOPE_FILTER_CHARS = 6000;

/** Shown when a scope was changed and the incremental position still covers the old one. */
export const SCOPE_CHANGED_LINE = "Scope changed: run Full resync to bring in the rest.";

export const SCOPE_KINDS: readonly ScopeKind[] = ["option", "lookup", "text", "number", "boolean"];

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INT_RE = /^-?\d{1,9}$/;
const NUMBER_RE = /^-?\d{1,15}(\.\d{1,6})?$/;
const ENUM_TYPE_RE = /^[A-Za-z_][A-Za-z0-9_.]{0,150}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/g;
const PRODUCT_WORD: Record<D365Product, string> = { fo: "Finance & Operations", bc: "Business Central", dataverse: "Dataverse" };

/** Dataverse reaches the customer of a contact through this navigation property. */
export const CUSTOMER_NAV = "parentcustomerid_account";

export const supportsViaCustomer = (product: D365Product, entity: D365EntityKey): boolean => product === "dataverse" && entity === "contacts";

const cleanText = (v: string): string => v.replace(CONTROL_RE, " ").replace(/\s+/g, " ").trim();

function valueProblem(product: D365Product, c: Pick<ScopeCondition, "kind" | "enum_type">, v: string): string | null {
  switch (c.kind) {
    case "option":
      if (product === "dataverse") return INT_RE.test(v) ? null : "An option must be one of the system's own codes.";
      if (product === "fo") return c.enum_type && IDENT_RE.test(v) ? null : "An option must be one of the system's own values.";
      return v.length >= 1 && v.length <= 60 && cleanText(v) === v ? null : "An option must be one of the system's own values.";
    case "lookup":
      return product === "dataverse" && GUID_RE.test(v) ? null : "Pick the record from the list.";
    case "boolean":
      return v === "true" || v === "false" ? null : "Choose yes or no.";
    case "number":
      return NUMBER_RE.test(v) ? null : "Enter a plain number.";
    case "text":
      return v.length >= 1 && v.length <= 100 && cleanText(v) === v ? null : "A value takes 1 to 100 characters.";
  }
}

export type CleanScope = { ok: true; scope: EntityScope } | { ok: false; error: string };

/** Check a scope arriving from a request (or from stored config) and return it in its one stored shape. */
export function cleanScope(raw: unknown, product: D365Product, entity: D365EntityKey): CleanScope {
  if (raw === undefined || raw === null) return { ok: true, scope: { conditions: [] } };
  if (typeof raw !== "object") return { ok: false, error: "The scope must be a list of conditions." };
  const list = Array.isArray(raw) ? raw : (raw as { conditions?: unknown }).conditions;
  if (list === undefined || list === null) return { ok: true, scope: { conditions: [] } };
  if (!Array.isArray(list)) return { ok: false, error: "The scope must be a list of conditions." };
  if (list.length > MAX_SCOPE_CONDITIONS) return { ok: false, error: `A scope takes at most ${MAX_SCOPE_CONDITIONS} conditions.` };
  const conditions: ScopeCondition[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const x = (item ?? {}) as Record<string, unknown>;
    const attribute = typeof x.attribute === "string" ? x.attribute.trim() : "";
    if (!IDENT_RE.test(attribute) || attribute.length > 100) return { ok: false, error: "Choose an attribute for every condition." };
    const kind = x.kind as ScopeKind;
    if (!SCOPE_KINDS.includes(kind)) return { ok: false, error: `"${attribute.slice(0, 40)}" cannot be used to narrow a sync.` };
    if (kind === "lookup" && product !== "dataverse") return { ok: false, error: `"${attribute.slice(0, 40)}" cannot be used in ${PRODUCT_WORD[product]}.` };
    let via: "customer" | undefined;
    if (x.via !== undefined && x.via !== null) {
      if (x.via !== "customer" || !supportsViaCustomer(product, entity)) return { ok: false, error: "A customer attribute can only narrow Contacts in Dataverse." };
      via = "customer";
    }
    let enum_type: string | undefined;
    if (x.enum_type !== undefined && x.enum_type !== null && x.enum_type !== "") {
      if (typeof x.enum_type !== "string" || !ENUM_TYPE_RE.test(x.enum_type)) return { ok: false, error: "That option list is not valid." };
      enum_type = x.enum_type;
    }
    if (kind === "option" && product === "fo" && !enum_type) return { ok: false, error: `"${attribute.slice(0, 40)}" has no option list in this system.` };
    if (!Array.isArray(x.values) || x.values.length === 0) return { ok: false, error: `Choose at least one value for ${attribute}.` };
    if (x.values.length > MAX_SCOPE_VALUES) return { ok: false, error: `A condition takes at most ${MAX_SCOPE_VALUES} values.` };
    const values: string[] = [];
    const labels: string[] = [];
    const rawLabels = Array.isArray(x.labels) ? x.labels : [];
    for (let i = 0; i < x.values.length; i++) {
      const rv = x.values[i];
      if (typeof rv !== "string" && typeof rv !== "number" && typeof rv !== "boolean") return { ok: false, error: `Check the values for ${attribute}.` };
      const v = typeof rv === "string" ? (kind === "text" ? cleanText(rv) : kind === "lookup" ? rv.trim().replace(/^\{(.*)\}$/, "$1") : rv.trim()) : String(rv);
      const problem = valueProblem(product, { kind, enum_type }, v);
      if (problem) return { ok: false, error: `${attribute}: ${problem}` };
      const dup = kind === "lookup" ? values.findIndex((y) => y.toLowerCase() === v.toLowerCase()) : values.indexOf(v);
      if (dup !== -1) continue;
      values.push(v);
      const lab = typeof rawLabels[i] === "string" ? cleanText(rawLabels[i] as string).slice(0, 80) : "";
      labels.push(lab || v);
    }
    const key = `${via ?? ""}:${attribute}`;
    if (seen.has(key)) return { ok: false, error: `${attribute} is used twice. Put its values in one condition.` };
    seen.add(key);
    const label = typeof x.attribute_label === "string" ? cleanText(x.attribute_label).slice(0, 80) : "";
    conditions.push({
      attribute, kind, values, labels, ...(label ? { attribute_label: label } : {}), ...(enum_type ? { enum_type } : {}), ...(via ? { via } : {}),
    });
  }
  return { ok: true, scope: { conditions } };
}

/** Does this scope narrow anything? */
export const hasScope = (s: EntityScope | undefined | null): boolean => !!s && s.conditions.length > 0;

function literal(product: D365Product, c: ScopeCondition, v: string): string {
  switch (c.kind) {
    case "option":
      if (product === "dataverse") return v;
      return product === "fo" ? `${c.enum_type}'${v}'` : odataString(v);
    case "lookup": return v;
    case "boolean": return v;
    case "number": return v;
    case "text": return odataString(v);
  }
}

const column = (c: ScopeCondition): string => {
  const col = c.kind === "lookup" ? `_${c.attribute}_value` : c.attribute;
  return c.via === "customer" ? `${CUSTOMER_NAV}/${col}` : col;
};

export type BuiltScope = { ok: true; filter: string | undefined } | { ok: false; error: string };

/** The OData $filter of a scope: values OR'd inside one condition, conditions AND'd. Undefined when nothing narrows. */
export function buildScopeFilter(product: D365Product, scope: EntityScope | undefined | null, entity: D365EntityKey = "customers"): BuiltScope {
  if (!hasScope(scope)) return { ok: true, filter: undefined };
  const checked = cleanScope(scope, product, entity);
  if (!checked.ok) return checked;
  const parts = checked.scope.conditions.map((c) => `(${c.values.map((v) => `${column(c)} eq ${literal(product, c, v)}`).join(" or ")})`);
  const filter = parts.join(" and ");
  if (filter.length > MAX_SCOPE_FILTER_CHARS) return { ok: false, error: "The scope has too many values for the system to take in one request. Pick fewer values." };
  return { ok: true, filter };
}

// ── Words ───────────────────────────────────────────────────────────────────

const humanize = (k: string) => k.replace(/^_|_value$/g, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().replace(/^\w/, (c) => c.toUpperCase());

function conditionWord(c: ScopeCondition): string {
  const shown = c.values.slice(0, 3).map((v, i) => c.labels?.[i] || v);
  const more = c.values.length > 3 ? ` +${c.values.length - 3}` : "";
  const name = c.attribute_label || humanize(c.attribute);
  return `${c.via === "customer" ? "Customer " : ""}${name} ${shown.join(", ")}${more}`;
}

/** "Class A, B, C · Territory North", or "" when the scope narrows nothing. */
export function scopeWords(scope: EntityScope | undefined | null): string {
  return hasScope(scope) ? scope!.conditions.map(conditionWord).join(" · ") : "";
}

/** The cell on the Resync table: the words, or "All customers". */
export function scopeSummary(scope: EntityScope | undefined | null, plural: string): string {
  return scopeWords(scope) || `All ${plural.toLowerCase()}`;
}

/** Two scopes that read the same records have the same signature (value order and labels do not matter). */
export function scopeSignature(scope: EntityScope | undefined | null): string {
  return JSON.stringify(
    (scope?.conditions ?? [])
      .map((c) => ({ key: `${c.via ?? ""}:${c.attribute}`, values: [...c.values].map((v) => (c.kind === "lookup" ? v.toLowerCase() : v)).sort() }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  );
}

// ── The attributes a scope can use ──────────────────────────────────────────

export type ScopeAttribute = {
  /** What the UI selects: "territoryid", or "customer:territoryid" for the customer's own attribute. */
  id: string;
  name: string;
  label: string;
  kind: ScopeKind;
  common: boolean;
  enum_type?: string;
  via?: "customer";
};

const DATAVERSE_KIND: Record<string, ScopeKind> = {
  Picklist: "option", State: "option", Status: "option", Boolean: "boolean", Lookup: "lookup", Owner: "lookup", Customer: "lookup",
  String: "text", Integer: "number", BigInt: "number", Decimal: "number", Double: "number", Money: "number",
};
const EDM_KIND: Record<string, ScopeKind> = {
  String: "text", Int16: "number", Int32: "number", Int64: "number", Decimal: "number", Double: "number", Boolean: "boolean", Number: "number",
};

/** What a field can be filtered as, or null when it cannot (dates, ids, files, anything the system does not list). */
export function kindOfField(product: D365Product, f: Pick<ErpField, "name" | "type"> & { filterable?: boolean }): ScopeKind | null {
  if (!IDENT_RE.test(f.name) || f.filterable === false) return null;
  if (product === "dataverse") return DATAVERSE_KIND[f.type] ?? null;
  if (EDM_KIND[f.type]) return EDM_KIND[f.type];
  // An enum type keeps its namespace ("Microsoft.Dynamics.DataEntities.NoYes"); a collection or another Edm type is not an option list.
  return /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(f.type) ? "option" : null;
}

function fromFields(product: D365Product, fields: readonly ErpField[] | null, commons: readonly ScopeCommon[], via?: "customer"): ScopeAttribute[] {
  const idOf = (name: string) => (via ? `customer:${name}` : name);
  const out: ScopeAttribute[] = [];
  const commonNames = new Set(commons.map((c) => c.name));
  if (fields) {
    const byName = new Map(fields.map((f) => [f.name, f]));
    for (const c of commons) {
      const f = byName.get(c.name);
      if (!f) continue;
      const kind = kindOfField(product, f) ?? null;
      if (!kind) continue;
      out.push({ id: idOf(c.name), name: c.name, label: c.label, kind, common: true, ...(kind === "option" && product !== "dataverse" ? { enum_type: f.type } : {}), ...(via ? { via } : {}) });
    }
    const rest: ScopeAttribute[] = [];
    for (const f of fields) {
      if (commonNames.has(f.name)) continue;
      const kind = kindOfField(product, f);
      if (!kind) continue;
      rest.push({ id: idOf(f.name), name: f.name, label: f.label, kind, common: false, ...(kind === "option" && product !== "dataverse" ? { enum_type: f.type } : {}), ...(via ? { via } : {}) });
    }
    rest.sort((a, b) => a.label.localeCompare(b.label) || a.name.localeCompare(b.name));
    return [...out, ...rest];
  }
  // The system's field list could not be read: only the presets the product ships with, so a saved scope still can be edited.
  return commons.map((c) => ({ id: idOf(c.name), name: c.name, label: c.label, kind: c.kind, common: true, ...(via ? { via } : {}) }));
}

/** The attributes to offer for one entity: the common ones first, then the rest of the system's own field list. */
export function scopeAttributes(product: D365Product, entity: D365EntityKey, fields: readonly ErpField[] | null, customerFields: readonly ErpField[] | null = null): ScopeAttribute[] {
  const preset = D365_SCOPE_COMMON[product]?.[entity];
  const own = fromFields(product, fields, preset?.own ?? [], undefined);
  if (!supportsViaCustomer(product, entity)) return own;
  return [...own, ...fromFields(product, customerFields, preset?.customer ?? [], "customer")];
}

/** The attribute a stored condition names, if the system still has it. */
export const conditionId = (c: Pick<ScopeCondition, "attribute" | "via">): string => (c.via === "customer" ? `customer:${c.attribute}` : c.attribute);
