// Advanced filtering -- shared condition model, URL codec and evaluator.
//
// Client-safe (no server imports): the filter panel builds conditions in the
// browser, they travel in the `af` searchParam, and the server-rendered list
// pages evaluate them in memory against the same already-tenant-scoped,
// already-decrypted rows they filter today. Evaluating in JS (not SQL) is
// deliberate: it keeps the whole feature inside each page's existing
// data-access path (no new query surface to guard per
// MULTI_TENANT_GUARDRAILS.md), and it works uniformly for encrypted PII
// columns and custom_data JSONB fields, neither of which are filterable at
// the database layer.

import type { WidgetType } from "@/lib/fieldRegistry";

export type FilterOp =
  | "eq" | "neq" | "contains" | "ncontains" | "starts"
  | "gt" | "gte" | "lt" | "lte" | "between"
  | "empty" | "nempty";

/** The comparison semantics a condition should use -- carried on the
 * condition itself so the server evaluator doesn't need the field catalog. */
export type FilterValueType = "text" | "number" | "date" | "select" | "checkbox";

export type FilterCond = {
  field: string;
  op: FilterOp;
  /** Comparison semantics. Anything unrecognised degrades to "text". */
  t: FilterValueType;
  value?: string;
  /** Upper bound, "between" only. */
  value2?: string;
};

export const OP_LABEL: Record<FilterOp, string> = {
  eq: "is", neq: "is not", contains: "contains", ncontains: "doesn't contain",
  starts: "starts with", gt: ">", gte: "≥", lt: "<", lte: "≤",
  between: "between", empty: "is empty", nempty: "is not empty",
};

export const OPS_BY_TYPE: Record<FilterValueType, FilterOp[]> = {
  text:     ["contains", "ncontains", "eq", "neq", "starts", "empty", "nempty"],
  number:   ["eq", "neq", "gt", "gte", "lt", "lte", "between", "empty", "nempty"],
  date:     ["eq", "gte", "lte", "between", "empty", "nempty"],
  select:   ["eq", "neq", "empty", "nempty"],
  checkbox: ["eq"],
};

/** Ops that need no value input at all. */
export const VALUELESS_OPS: ReadonlySet<FilterOp> = new Set(["empty", "nempty"]);

export function widgetToFilterType(widget: WidgetType): FilterValueType {
  switch (widget) {
    case "number": return "number";
    case "date": return "date";
    case "select": case "enum": return "select";
    case "checkbox": return "checkbox";
    default: return "text"; // text, textarea, tel, email, url
  }
}

// ── URL codec ─────────────────────────────────────────────────────────────────

const ALL_OPS = new Set<string>(Object.keys(OP_LABEL));
const ALL_TYPES = new Set<string>(["text", "number", "date", "select", "checkbox"]);
const MAX_CONDS = 20;

export function encodeConds(conds: FilterCond[]): string {
  return JSON.stringify(conds.map((c) => {
    const out: Record<string, string> = { field: c.field, op: c.op, t: c.t };
    if (c.value !== undefined) out.value = c.value;
    if (c.value2 !== undefined) out.value2 = c.value2;
    return out;
  }));
}

/** Tolerant parse of the `af` searchParam -- malformed input (hand-edited
 * URLs, stale saved links) degrades to "no advanced filter", never a crash.
 * Field names are plain object keys looked up on an in-memory record, so a
 * fabricated name simply matches nothing. */
export function parseConds(raw: string | undefined | null): FilterCond[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: FilterCond[] = [];
  for (const item of parsed.slice(0, MAX_CONDS)) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    if (typeof c.field !== "string" || !c.field || c.field.length > 80) continue;
    if (typeof c.op !== "string" || !ALL_OPS.has(c.op)) continue;
    const t = typeof c.t === "string" && ALL_TYPES.has(c.t) ? (c.t as FilterValueType) : "text";
    out.push({
      field: c.field,
      op: c.op as FilterOp,
      t,
      value: typeof c.value === "string" ? c.value.slice(0, 300) : undefined,
      value2: typeof c.value2 === "string" ? c.value2.slice(0, 300) : undefined,
    });
  }
  return out;
}

// ── Evaluator ─────────────────────────────────────────────────────────────────

function isEmptyVal(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

/** Record values may be full timestamps; condition values are yyyy-mm-dd from
 * a date input. Comparing the ISO date prefix keeps "on this day" meaningful. */
function datePart(v: unknown): string {
  return String(v).slice(0, 10);
}

function matchesCond(record: Record<string, unknown>, cond: FilterCond): boolean {
  const v = record[cond.field];
  if (cond.op === "empty") return isEmptyVal(v);
  if (cond.op === "nempty") return !isEmptyVal(v);
  // Every other op needs a value on both sides.
  if (cond.value === undefined || cond.value === "") return true; // incomplete condition -- no-op
  if (isEmptyVal(v)) return false;

  if (cond.t === "checkbox") {
    const b = v === true || v === "true" || v === 1;
    return cond.op === "eq" ? String(b) === cond.value : true;
  }

  if (cond.t === "number") {
    const n = typeof v === "number" ? v : Number(v);
    const a = Number(cond.value);
    if (Number.isNaN(n) || Number.isNaN(a)) return false;
    switch (cond.op) {
      case "eq": return n === a;
      case "neq": return n !== a;
      case "gt": return n > a;
      case "gte": return n >= a;
      case "lt": return n < a;
      case "lte": return n <= a;
      case "between": {
        const b = Number(cond.value2);
        return !Number.isNaN(b) && n >= Math.min(a, b) && n <= Math.max(a, b);
      }
      default: return false;
    }
  }

  if (cond.t === "date") {
    const d = datePart(v);
    switch (cond.op) {
      case "eq": return d === cond.value;
      case "gte": return d >= cond.value;
      case "lte": return d <= cond.value;
      case "between": return !!cond.value2 && d >= cond.value && d <= cond.value2;
      default: return false;
    }
  }

  // text / select
  const s = String(v).toLowerCase();
  const a = cond.value.toLowerCase();
  switch (cond.op) {
    case "eq": return s === a;
    case "neq": return s !== a;
    case "contains": return s.includes(a);
    case "ncontains": return !s.includes(a);
    case "starts": return s.startsWith(a);
    default: return false;
  }
}

/** AND of all conditions (the model every filter bar in the app implies). */
export function matchesConds(record: Record<string, unknown>, conds: FilterCond[]): boolean {
  return conds.every((c) => matchesCond(record, c));
}

/** Merges an object's custom_data JSONB up into the flat record so custom
 * fields filter exactly like standard columns (their field_key IS the
 * custom_data key). Standard columns win on a name collision. */
export function flattenForFilter(row: Record<string, unknown>): Record<string, unknown> {
  const custom = row.custom_data;
  if (custom && typeof custom === "object" && !Array.isArray(custom)) {
    return { ...(custom as Record<string, unknown>), ...row };
  }
  return row;
}

/** One-call helper for the server list pages. */
export function applyAdvancedFilter<T>(
  rows: T[],
  rawParam: string | undefined | null,
  toRecord: (row: T) => Record<string, unknown>
): T[] {
  const conds = parseConds(rawParam);
  if (conds.length === 0) return rows;
  return rows.filter((r) => matchesConds(flattenForFilter(toRecord(r)), conds));
}
