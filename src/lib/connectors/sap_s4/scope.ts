// A saved Scope for a SAP entity: which records every pull reads. Pure and client-safe. It narrows the MAIN entity
// set only (the business partner, the product): attributes that live on an associated entity -- sales area, the
// country of an address -- are not offered, and the screen says so. Nothing a person types reaches a $filter raw:
// attribute names must be plain identifiers that the system itself lists, every literal goes through odataString().

import type { ErpField } from "@/lib/middleware/metadata";
import { MAX_SCOPE_CONDITIONS, MAX_SCOPE_VALUES, MAX_SCOPE_FILTER_CHARS } from "@/lib/connectors/d365/scope";
import type { ScopeAttribute } from "@/lib/connectors/d365/scope";
import { odataString } from "@/lib/connectors/d365/mapping";
import type { EntityScope, ScopeCondition, ScopeKind } from "@/lib/connectors/d365/types";
import { SAP_SCOPE_COMMON } from "./catalog";
import type { SapBpKey } from "./types";

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const INT_RE = /^-?\d{1,9}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/g;
const cleanText = (v: string): string => v.replace(CONTROL_RE, " ").replace(/\s+/g, " ").trim();

const SAP_KINDS: readonly ScopeKind[] = ["option", "text", "number", "boolean"];

/** Plain words for the one thing a SAP scope can not do. Shown in the scope panel's "i". */
export const SAP_SCOPE_NOTE = "A SAP scope narrows the record itself (category, grouping, industry). Sales area and country are not offered yet.";

function valueProblem(kind: ScopeKind, v: string): string | null {
  switch (kind) {
    case "boolean": return v === "true" || v === "false" ? null : "Choose yes or no.";
    case "number": return INT_RE.test(v) ? null : "Enter a whole number.";
    default: return v.length >= 1 && v.length <= 100 && cleanText(v) === v ? null : "A value takes 1 to 100 characters.";
  }
}

export type CleanSapScope = { ok: true; scope: EntityScope } | { ok: false; error: string };

export function cleanSapScope(raw: unknown): CleanSapScope {
  if (raw === undefined || raw === null) return { ok: true, scope: { conditions: [] } };
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
    if (!SAP_KINDS.includes(kind)) return { ok: false, error: `"${attribute.slice(0, 40)}" cannot be used to narrow a sync.` };
    if (x.via !== undefined && x.via !== null) return { ok: false, error: "SAP scopes narrow the main record only." };
    if (!Array.isArray(x.values) || x.values.length === 0) return { ok: false, error: `Choose at least one value for ${attribute}.` };
    if (x.values.length > MAX_SCOPE_VALUES) return { ok: false, error: `A condition takes at most ${MAX_SCOPE_VALUES} values.` };
    const values: string[] = [];
    const labels: string[] = [];
    const rawLabels = Array.isArray(x.labels) ? x.labels : [];
    for (let i = 0; i < x.values.length; i++) {
      const rv = x.values[i];
      if (typeof rv !== "string" && typeof rv !== "number" && typeof rv !== "boolean") return { ok: false, error: `Check the values for ${attribute}.` };
      const v = typeof rv === "string" ? (kind === "boolean" || kind === "number" ? rv.trim() : cleanText(rv)) : String(rv);
      const problem = valueProblem(kind, v);
      if (problem) return { ok: false, error: `${attribute}: ${problem}` };
      if (values.includes(v)) continue;
      values.push(v);
      const lab = typeof rawLabels[i] === "string" ? cleanText(rawLabels[i] as string).slice(0, 80) : "";
      labels.push(lab || v);
    }
    if (seen.has(attribute)) return { ok: false, error: `${attribute} is used twice. Put its values in one condition.` };
    seen.add(attribute);
    const label = typeof x.attribute_label === "string" ? cleanText(x.attribute_label).slice(0, 80) : "";
    conditions.push({ attribute, kind, values, labels, ...(label ? { attribute_label: label } : {}) });
  }
  return { ok: true, scope: { conditions } };
}

const literal = (c: ScopeCondition, v: string): string => (c.kind === "number" || c.kind === "boolean" ? v : odataString(v));

export type BuiltSapScope = { ok: true; filter: string | undefined } | { ok: false; error: string };

/** Values OR'd inside one condition, conditions AND'd. Undefined when nothing narrows. */
export function buildSapScopeFilter(scope: EntityScope | undefined | null): BuiltSapScope {
  if (!scope || scope.conditions.length === 0) return { ok: true, filter: undefined };
  const checked = cleanSapScope(scope);
  if (!checked.ok) return checked;
  const filter = checked.scope.conditions.map((c) => `(${c.values.map((v) => `${c.attribute} eq ${literal(c, v)}`).join(" or ")})`).join(" and ");
  if (filter.length > MAX_SCOPE_FILTER_CHARS) return { ok: false, error: "The scope has too many values for SAP to take in one request. Pick fewer values." };
  return { ok: true, filter };
}

const EDM_KIND: Record<string, ScopeKind> = { String: "text", Boolean: "boolean", Int16: "number", Int32: "number", Int64: "number" };

/** What a SAP property can be filtered as, or null (dates, decimals, binary: not offered). */
export function kindOfSapField(f: Pick<ErpField, "name" | "type">): ScopeKind | null {
  return IDENT_RE.test(f.name) ? EDM_KIND[f.type] ?? null : null;
}

/** The attributes offered: the common ones first, then every other filterable property the system lists.
 *  Without the system's list (it could not be read) only the common ones are offered. */
export function sapScopeAttributes(entity: SapBpKey, fields: readonly ErpField[] | null): ScopeAttribute[] {
  const commons = SAP_SCOPE_COMMON[entity];
  const out: ScopeAttribute[] = [];
  const byName = new Map((fields ?? []).map((f) => [f.name, f]));
  for (const c of commons) {
    if (fields && !byName.has(c.name)) continue;
    out.push({ id: c.name, name: c.name, label: c.label, kind: c.kind, common: true });
  }
  if (fields) {
    const names = new Set(commons.map((c) => c.name));
    const rest: ScopeAttribute[] = [];
    for (const f of fields) {
      if (names.has(f.name)) continue;
      const kind = kindOfSapField(f);
      if (!kind) continue;
      rest.push({ id: f.name, name: f.name, label: f.label, kind, common: false });
    }
    rest.sort((a, b) => a.label.localeCompare(b.label) || a.name.localeCompare(b.name));
    out.push(...rest);
  }
  return out;
}

/** The fixed pick-list of a common attribute, when it has one. */
export function sapScopeOptions(entity: SapBpKey, attribute: string): { value: string; label: string }[] | null {
  return SAP_SCOPE_COMMON[entity].find((c) => c.name === attribute)?.options ?? null;
}
