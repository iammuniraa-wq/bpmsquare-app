import "server-only";
import type { ExportFilter, FieldSpec } from "./types";

function formatValue(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "boolean") return raw ? "true" : "false";
  if (Array.isArray(raw)) return raw.join("; ");
  return String(raw);
}

/**
 * Turns one DB row into the same field-key -> display-string shape import
 * validation already produces, so export/filter/CSV code doesn't need a
 * second notion of "what does this field look like as text."
 */
export function rowToExportValues(record: Record<string, unknown>, fields: FieldSpec[]): Record<string, string> {
  const customData = (record.custom_data as Record<string, unknown> | null) ?? {};
  const out: Record<string, string> = {};
  for (const f of fields) {
    out[f.key] = formatValue(f.custom ? customData[f.key] : record[f.key]);
  }
  return out;
}

function matchesFilter(value: string, filter: ExportFilter, fieldType: string): boolean {
  const v = value.trim();
  const target = filter.value.trim();

  switch (filter.op) {
    case "is_empty":     return v === "";
    case "is_not_empty": return v !== "";
    case "equals":       return v.toLowerCase() === target.toLowerCase();
    case "not_equals":   return v.toLowerCase() !== target.toLowerCase();
    case "contains":     return v.toLowerCase().includes(target.toLowerCase());
    case "on":            return v === target;
    case "gt":
    case "lt": {
      if (fieldType === "date") return compareDates(v, target, filter.op);
      const a = Number(v), b = Number(target);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      return filter.op === "gt" ? a > b : a < b;
    }
    case "before": return compareDates(v, target, "lt");
    case "after":  return compareDates(v, target, "gt");
    default:       return true;
  }
}

function compareDates(v: string, target: string, op: "gt" | "lt"): boolean {
  const a = Date.parse(v), b = Date.parse(target);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return op === "gt" ? a > b : a < b;
}

/** Simple AND-combined field filters — deliberately not the field_rules ConditionNode engine. */
export function applyFilters(
  rows: Record<string, string>[],
  filters: ExportFilter[],
  fieldTypeByKey: Map<string, string>
): Record<string, string>[] {
  if (filters.length === 0) return rows;
  return rows.filter((row) =>
    filters.every((f) => matchesFilter(row[f.field] ?? "", f, fieldTypeByKey.get(f.field) ?? "text"))
  );
}
