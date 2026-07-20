import type { FieldSpec, ObjectSpec, RowIssue, ValidatedRow } from "./types";

export function coerceBoolean(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (v === "") return null;
  if (["true", "yes", "y", "1", "x"].includes(v)) return true;
  if (["false", "no", "n", "0"].includes(v)) return false;
  return null;
}

/** Handles ₹ symbols, Indian digit grouping (1,50,000) and trailing/leading spaces. */
export function coerceNumber(raw: string): number | null {
  const cleaned = raw.replace(/[₹$€£,\s]/g, "").replace(/%$/, "");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const SLASH_DATE = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/;

/** Returns YYYY-MM-DD. Day-first is assumed for slash dates, matching Indian convention. */
export function coerceDate(raw: string): string | null {
  const v = raw.trim();
  if (v === "") return null;

  const iso = ISO_DATE.exec(v);
  if (iso) {
    const [, y, m, d] = iso;
    return validDate(Number(y), Number(m), Number(d));
  }

  const slash = SLASH_DATE.exec(v);
  if (slash) {
    const [, a, b, cRaw] = slash;
    const year = cRaw.length === 2 ? 2000 + Number(cRaw) : Number(cRaw);
    return validDate(year, Number(b), Number(a));
  }

  return null;
}

function validDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function matchEnum(raw: string, options: readonly string[]): string | null {
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return options.find((o) => o.toLowerCase() === v) ?? null;
}

/**
 * Validates and normalises one field. Returns the canonical value to store, plus
 * any issue. Errors block the row; warnings let it through with the value dropped.
 */
export function validateField(field: FieldSpec, raw: string): { value: string; issue?: RowIssue } {
  const trimmed = (raw ?? "").trim();

  if (trimmed === "") {
    if (field.required) {
      return { value: "", issue: { field: field.key, message: `${field.label} is required`, severity: "error" } };
    }
    return { value: "" };
  }

  switch (field.type) {
    case "enum": {
      const matched = matchEnum(trimmed, field.options ?? []);
      if (!matched) {
        return {
          value: "",
          issue: {
            field: field.key,
            message: `${field.label} must be one of: ${(field.options ?? []).join(", ")} — got "${trimmed}"`,
            severity: "error",
          },
        };
      }
      return { value: matched };
    }

    case "email": {
      if (!EMAIL.test(trimmed)) {
        return {
          value: "",
          issue: {
            field: field.key,
            message: `${field.label} "${trimmed}" is not a valid email address`,
            severity: field.required ? "error" : "warning",
          },
        };
      }
      return { value: trimmed.toLowerCase() };
    }

    case "number":
    case "integer": {
      const n = coerceNumber(trimmed);
      if (n == null) {
        return {
          value: "",
          issue: { field: field.key, message: `${field.label} "${trimmed}" is not a number`, severity: "error" },
        };
      }
      return { value: String(field.type === "integer" ? Math.round(n) : n) };
    }

    case "date": {
      const d = coerceDate(trimmed);
      if (!d) {
        return {
          value: "",
          issue: {
            field: field.key,
            message: `${field.label} "${trimmed}" is not a recognised date — use YYYY-MM-DD or DD/MM/YYYY`,
            severity: "error",
          },
        };
      }
      return { value: d };
    }

    case "boolean": {
      const b = coerceBoolean(trimmed);
      if (b == null) {
        return {
          value: "",
          issue: {
            field: field.key,
            message: `${field.label} "${trimmed}" must be true or false`,
            severity: "warning",
          },
        };
      }
      return { value: String(b) };
    }

    default:
      return { value: trimmed };
  }
}

export function validateRow(spec: ObjectSpec, values: Record<string, string>, rowNum: number): ValidatedRow {
  const out: Record<string, string> = {};
  const issues: RowIssue[] = [];

  for (const field of spec.fields) {
    const { value, issue } = validateField(field, values[field.key] ?? "");
    if (issue) issues.push(issue);
    if (value !== "") out[field.key] = value;
  }

  return { rowNum, values: out, issues };
}

export function hasBlockingIssue(row: ValidatedRow): boolean {
  return row.issues.some((i) => i.severity === "error");
}

/**
 * Quote rows are line items; header fields only apply to the first row of each
 * quote, so required-header checks run per group rather than per row.
 */
export function validateQuoteRows(spec: ObjectSpec, rows: { values: Record<string, string>; rowNum: number }[]): ValidatedRow[] {
  const seenGroups = new Set<string>();
  const headerFields = spec.fields.filter((f) => f.scope === "header");
  const lineFields = spec.fields.filter((f) => f.scope !== "header");

  return rows.map(({ values, rowNum }) => {
    const groupKey = (values.quote_name ?? "").trim().toLowerCase();
    const isFirstOfGroup = groupKey !== "" && !seenGroups.has(groupKey);
    if (isFirstOfGroup) seenGroups.add(groupKey);

    const out: Record<string, string> = {};
    const issues: RowIssue[] = [];

    for (const field of headerFields) {
      const raw = values[field.key] ?? "";
      const applies = field.key === "quote_name" || isFirstOfGroup;
      const effective: FieldSpec = applies ? field : { ...field, required: false };
      const { value, issue } = validateField(effective, raw);
      if (issue) issues.push(issue);
      if (value !== "") out[field.key] = value;
    }

    for (const field of lineFields) {
      const { value, issue } = validateField(field, values[field.key] ?? "");
      if (issue) issues.push(issue);
      if (value !== "") out[field.key] = value;
    }

    return { rowNum, values: out, issues };
  });
}
