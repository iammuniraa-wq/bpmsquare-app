import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImportResponse, RowOutcome } from "./types";

type PgError = { code?: string; message?: string; details?: string; hint?: string };

/**
 * Postgres errors are surfaced to end users, so translate the codes we can
 * anticipate rather than leaking raw driver text like
 * "invalid input syntax for type uuid".
 */
export function describeDbError(error: PgError | null | undefined, context?: string): string {
  if (!error) return "Unknown database error";
  const label = context ? `${context}: ` : "";

  switch (error.code) {
    case "23505":
      return `${label}a record with these details already exists`;
    case "23503":
      return `${label}references a record that does not exist`;
    case "23502":
      return `${label}a required field was empty`;
    case "23514":
      return `${label}a value is outside the allowed set for this field`;
    case "22001":
      return `${label}a value is too long for its column`;
    case "22P02":
      return `${label}a value has the wrong format`;
    case "22003":
      return `${label}a number is too large`;
    case "42501":
      return `${label}you do not have permission to create this record`;
    default:
      return `${label}${error.message ?? "could not be saved"}`;
  }
}

const PAGE_SIZE = 1000;

/**
 * PostgREST caps a single response, so a tenant past the cap would otherwise get
 * silent duplicates and false "not found" lookups. Pages until exhausted.
 */
export async function fetchAllRows<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  tenantId: string
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq("tenant_id", tenantId)
      .range(from, from + PAGE_SIZE - 1);

    if (error || !data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
  }
  return all;
}

export function nameKey(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

export type PreparedRow = {
  rowNum: number;
  record: Record<string, unknown>;
};

const CHUNK_SIZE = 200;

/**
 * Inserts in chunks for speed, then falls back to per-row inserts for any chunk
 * that fails so a single bad row cannot discard the whole import.
 */
export async function insertRows(
  supabase: SupabaseClient,
  table: string,
  prepared: PreparedRow[],
  presetOutcomes: RowOutcome[] = []
): Promise<ImportResponse> {
  const outcomes: RowOutcome[] = [...presetOutcomes];

  for (let i = 0; i < prepared.length; i += CHUNK_SIZE) {
    const chunk = prepared.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase.from(table).insert(chunk.map((r) => r.record));

    if (!error) {
      for (const row of chunk) outcomes.push({ rowNum: row.rowNum, status: "inserted" });
      continue;
    }

    for (const row of chunk) {
      const { error: rowError } = await supabase.from(table).insert(row.record);
      if (rowError) {
        outcomes.push({ rowNum: row.rowNum, status: "failed", reason: describeDbError(rowError) });
      } else {
        outcomes.push({ rowNum: row.rowNum, status: "inserted" });
      }
    }
  }

  return summarise(outcomes);
}

export function summarise(outcomes: RowOutcome[]): ImportResponse {
  const sorted = [...outcomes].sort((a, b) => a.rowNum - b.rowNum);
  return {
    inserted: sorted.filter((o) => o.status === "inserted").length,
    skipped: sorted.filter((o) => o.status === "skipped").length,
    failed: sorted.filter((o) => o.status === "failed").length,
    outcomes: sorted,
  };
}

export type ImportRequestBody = { rows: { rowNum: number; values: Record<string, string> }[] };

export function readImportBody(body: unknown): ImportRequestBody["rows"] | null {
  const rows = (body as ImportRequestBody | null)?.rows;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows.filter((r) => r && typeof r.rowNum === "number" && r.values && typeof r.values === "object");
}

/**
 * Keys are stored with their cf_ prefix intact — CustomFieldsSection looks up
 * custom_data by custom_fields.field_key, which is itself prefixed.
 */
export function collectCustomData(values: Record<string, string>): Record<string, string> | undefined {
  const custom: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith("cf_") && value?.trim()) custom[key] = value.trim();
  }
  return Object.keys(custom).length > 0 ? custom : undefined;
}
