import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describeDbError } from "./server";
import type { RowOutcome, UpdateResponse } from "./types";

export type PreparedUpdate = {
  rowNum: number;
  id: string;
  patch: Record<string, unknown>;
};

export function summariseUpdate(outcomes: RowOutcome[]): UpdateResponse {
  const sorted = [...outcomes].sort((a, b) => a.rowNum - b.rowNum);
  return {
    updated: sorted.filter((o) => o.status === "updated").length,
    skipped: sorted.filter((o) => o.status === "skipped").length,
    failed: sorted.filter((o) => o.status === "failed").length,
    outcomes: sorted,
  };
}

const CONCURRENCY = 10;

/**
 * Applies one PATCH per row, matched by id + tenant_id. PostgREST has no bulk
 * "update many rows, each with different values" primitive, so this is N
 * round trips — chunked with modest concurrency rather than fully serial.
 * A row whose id doesn't match any record in this tenant fails clearly; it
 * is never silently skipped or turned into a new record.
 */
export async function updateRows(
  supabase: SupabaseClient,
  table: string,
  tenantId: string,
  prepared: PreparedUpdate[],
  presetOutcomes: RowOutcome[] = []
): Promise<UpdateResponse> {
  const outcomes: RowOutcome[] = [...presetOutcomes];

  for (let i = 0; i < prepared.length; i += CONCURRENCY) {
    const chunk = prepared.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (row): Promise<RowOutcome> => {
        const { data, error } = await supabase
          .from(table)
          .update(row.patch)
          .eq("id", row.id)
          .eq("tenant_id", tenantId)
          .select("id");

        if (error) return { rowNum: row.rowNum, status: "failed", reason: describeDbError(error) };
        if (!data || data.length === 0) {
          return { rowNum: row.rowNum, status: "failed", reason: `No record with id "${row.id}" found in this workspace` };
        }
        return { rowNum: row.rowNum, status: "updated" };
      })
    );
    outcomes.push(...results);
  }

  return summariseUpdate(outcomes);
}
