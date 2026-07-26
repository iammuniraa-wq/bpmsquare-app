// Segmentation engine for marketing target groups -- a registry of
// filterable fields + a generic evaluator, in the style of SAP Marketing
// Cloud's segmentation designer (drag an attribute in, pick an operator and
// value, combine with AND/OR). Pure and dependency-free so it's safe to
// import from both the client (palette + canvas UI) and the server
// (recipient resolution), same split as lib/richText.ts vs lib/sanitizeHtml.ts.
//
// THE EXTENSIBILITY POINT: adding a future marketing signal -- contact
// enrichment score, sentiment, a news-mention flag -- means adding one entry
// to SEGMENT_FIELDS below (plus, if it isn't a plain account column, teaching
// the caller that builds the `account` object passed into matchesFilter how
// to compute it). The palette, canvas, drag-and-drop, and evaluator all read
// this registry generically and need no changes.

export type SegmentOperator =
  | "equals" | "not_equals" | "contains"
  | "is_true" | "is_false"
  | "gt" | "lt"
  | "before" | "after";

export type SegmentFieldType = "select" | "text" | "number" | "boolean" | "date";

export type SegmentFieldDef = {
  key: string;
  label: string;
  /** Palette grouping shown in the builder, e.g. "Location". */
  category: string;
  type: SegmentFieldType;
  options?: { value: string; label: string }[];
  operators: SegmentOperator[];
};

export type SegmentFilter = {
  /** Client-generated id, used for list rendering/reordering -- never sent
   * anywhere that treats it as a real database id. */
  id: string;
  field: string;
  operator: SegmentOperator;
  value: string;
};

export const SEGMENT_FIELDS: SegmentFieldDef[] = [
  {
    key: "type", label: "Account type", category: "Account info", type: "select",
    options: [
      { value: "prospect", label: "Prospect" },
      { value: "oem", label: "OEM" },
      { value: "direct", label: "Direct" },
      { value: "end_customer", label: "End customer" },
    ],
    operators: ["equals", "not_equals"],
  },
  { key: "city", label: "City", category: "Location", type: "text", operators: ["equals", "contains", "not_equals"] },
  { key: "state", label: "State", category: "Location", type: "text", operators: ["equals", "contains", "not_equals"] },
  { key: "country", label: "Country", category: "Location", type: "text", operators: ["equals", "contains", "not_equals"] },
  { key: "territory", label: "Territory", category: "Location", type: "text", operators: ["equals", "contains", "not_equals"] },
  { key: "sales_org", label: "Sales org", category: "Business", type: "text", operators: ["equals", "contains"] },
  { key: "industry", label: "Industry", category: "Business", type: "text", operators: ["equals", "contains"] },
  { key: "employee_count", label: "Employee count", category: "Business", type: "text", operators: ["equals", "contains"] },
  { key: "annual_revenue", label: "Annual revenue", category: "Business", type: "number", operators: ["gt", "lt", "equals"] },
  { key: "marketing_opt_out", label: "Marketing opt-out", category: "Engagement", type: "boolean", operators: ["is_true", "is_false"] },
  { key: "created_at", label: "Customer since", category: "Account info", type: "date", operators: ["before", "after"] },
];

export function getSegmentField(key: string): SegmentFieldDef | undefined {
  return SEGMENT_FIELDS.find((f) => f.key === key);
}

export const OPERATOR_LABEL: Record<SegmentOperator, string> = {
  equals: "is", not_equals: "is not", contains: "contains",
  is_true: "is set", is_false: "is not set",
  gt: "is greater than", lt: "is less than",
  before: "is before", after: "is after",
};

/** Filters out anything that isn't a recognised field/operator pair --
 * the actual safety boundary against a spoofed or stale request, since the
 * TS type alone doesn't stop a crafted API call from claiming an unknown
 * field. */
export function sanitizeSegmentFilters(input: unknown): SegmentFilter[] {
  if (!Array.isArray(input)) return [];
  const out: SegmentFilter[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const { id, field, operator, value } = raw as Record<string, unknown>;
    const def = typeof field === "string" ? getSegmentField(field) : undefined;
    if (!def) continue;
    if (typeof operator !== "string" || !def.operators.includes(operator as SegmentOperator)) continue;
    out.push({
      id: typeof id === "string" && id ? id : `${field}_${out.length}`,
      field: field as string,
      operator: operator as SegmentOperator,
      value: typeof value === "string" ? value.slice(0, 200) : "",
    });
  }
  return out.slice(0, 20);
}

export function sanitizeMatch(input: unknown): "all" | "any" {
  return input === "any" ? "any" : "all";
}

function matchesFilter(record: Record<string, unknown>, filter: SegmentFilter): boolean {
  const raw = record[filter.field];
  switch (filter.operator) {
    case "equals": return String(raw ?? "").trim().toLowerCase() === filter.value.trim().toLowerCase();
    case "not_equals": return String(raw ?? "").trim().toLowerCase() !== filter.value.trim().toLowerCase();
    case "contains": return String(raw ?? "").toLowerCase().includes(filter.value.trim().toLowerCase());
    case "is_true": return raw === true;
    case "is_false": return raw !== true;
    case "gt": { const n = parseFloat(String(raw ?? "").replace(/[^0-9.-]/g, "")); return !Number.isNaN(n) && n > parseFloat(filter.value); }
    case "lt": { const n = parseFloat(String(raw ?? "").replace(/[^0-9.-]/g, "")); return !Number.isNaN(n) && n < parseFloat(filter.value); }
    case "before": return typeof raw === "string" && !!raw && new Date(raw) < new Date(filter.value);
    case "after": return typeof raw === "string" && !!raw && new Date(raw) > new Date(filter.value);
    default: return false;
  }
}

/** Evaluates a record (an account, today -- any object shape tomorrow) against
 * a filter set. Empty filters always match, so callers can pass an unused
 * filter array without special-casing it. */
export function matchesAllFilters(record: Record<string, unknown>, filters: SegmentFilter[], match: "all" | "any"): boolean {
  if (filters.length === 0) return true;
  return match === "all" ? filters.every((f) => matchesFilter(record, f)) : filters.some((f) => matchesFilter(record, f));
}
