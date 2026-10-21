import type { QueryableField } from "@/lib/api/query";

// What of a record the assistant is shown. The whitelist is the object's own queryable-field list (the one the
// REST API, Report Builder and the chat's query tool validate against); fields marked sensitive (email, phone) are
// never included, for the same reason Report Builder never lists them out. Nothing that is not a declared field
// (custom_data, _links, internal columns) can pass, however the row was loaded. Pure.

type Row = Record<string, unknown>;

const MAX_VALUE_CHARS = 200;

function pick(row: Row, path: string): unknown {
  let cur: unknown = row;
  for (const part of path.split(".")) {
    if (cur && typeof cur === "object") cur = (cur as Row)[part];
    else return undefined;
  }
  return cur;
}

/** Declared, non-sensitive, non-empty fields of a row as a flat { "account.name": "..." } object. */
export function summarizeRow(fields: readonly QueryableField[], row: Row): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const f of fields) {
    if (f.sensitive) continue;
    const v = pick(row, f.path);
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "string") out[f.path] = v.length > MAX_VALUE_CHARS ? `${v.slice(0, MAX_VALUE_CHARS - 1)}…` : v;
    else if (typeof v === "number" || typeof v === "boolean") out[f.path] = v;
  }
  return out;
}

/**
 * Query-tool rows: the same whitelist, trimmed to what a question needs. Nulls, `_links` and every undeclared key
 * are dropped, and sensitive fields are never returned even when the model did not name them in `select` (before
 * this, a query with no `select` returned the whole loaded row).
 */
export function trimRows(fields: readonly QueryableField[], rows: Row[]): Row[] {
  // A row that was projected by `select` simply has no value for the other fields, so they drop out here.
  return rows.map((row) => summarizeRow(fields, row));
}
