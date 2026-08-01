import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describeDbError } from "./server";
import type { RowOutcome, UpdateResponse } from "./types";
import { diffForLog, logChangeBatch, type ChangeLogEntryParams } from "@/lib/changeLog";

export type PreparedUpdate = {
  rowNum: number;
  id: string;
  patch: Record<string, unknown>;
  // Plaintext version of `patch`, used only for the change-log diff -- for
  // accounts/contacts, `patch` holds re-encrypted PII (a fresh IV every
  // call, so ciphertext always "changes"); `diffPatch` carries the same
  // keys' real values so the audit entry reflects whether the value
  // actually moved. Defaults to `patch` when the row has no encrypted fields.
  diffPatch?: Record<string, unknown>;
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

export type UpdateChangeLogContext = {
  objectType: string;
  labelField: string;
  actorId?: string | null;
  actorEmail?: string | null;
  // For accounts/contacts, the raw "before" row has ciphertext in its PII
  // columns -- diffing that against diffPatch's plaintext would show every
  // PII field as "changed" on every update. Decrypts the row (same shape
  // decryptAccount()/decryptContact() already produce) before it reaches
  // diffForLog, mirroring the single-record PATCH routes' own pattern.
  decryptBefore?: (row: Record<string, unknown>) => Record<string, unknown>;
};

/**
 * Applies one PATCH per row, matched by id + tenant_id. PostgREST has no bulk
 * "update many rows, each with different values" primitive, so this is N
 * round trips — chunked with modest concurrency rather than fully serial.
 * A row whose id doesn't match any record in this tenant fails clearly; it
 * is never silently skipped or turned into a new record.
 *
 * When `changeLog` is passed, every row that actually changes something gets
 * a change_log entry too -- Data Workbench bulk update is a real write path
 * (arguably the highest-volume one), so it needs the same audit trail as a
 * single-record PATCH. Fetches every "before" row in one query up front and
 * writes all resulting change_log rows in a single batch insert, so this
 * adds at most two extra round trips total, not two per row.
 */
export async function updateRows(
  supabase: SupabaseClient,
  table: string,
  tenantId: string,
  prepared: PreparedUpdate[],
  presetOutcomes: RowOutcome[] = [],
  changeLog?: UpdateChangeLogContext
): Promise<UpdateResponse> {
  const outcomes: RowOutcome[] = [...presetOutcomes];
  const logRows: ChangeLogEntryParams[] = [];

  let beforeById: Map<string, Record<string, unknown>> | null = null;
  if (changeLog && prepared.length > 0) {
    const { data: beforeRows } = await supabase
      .from(table)
      .select("*")
      .in("id", prepared.map((p) => p.id))
      .eq("tenant_id", tenantId);
    beforeById = new Map(
      (beforeRows ?? []).map((r) => {
        const row = r as Record<string, unknown>;
        return [row.id as string, changeLog.decryptBefore ? changeLog.decryptBefore(row) : row];
      })
    );
  }

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

        if (changeLog && beforeById) {
          const before = beforeById.get(row.id) ?? {};
          const changes = diffForLog(changeLog.objectType, before, row.diffPatch ?? row.patch);
          if (changes.length > 0) {
            logRows.push({
              tenantId, objectType: changeLog.objectType, objectId: row.id,
              objectLabel: (before[changeLog.labelField] as string | undefined) ?? null,
              action: "update", actorId: changeLog.actorId, actorEmail: changeLog.actorEmail, changes,
            });
          }
        }

        return { rowNum: row.rowNum, status: "updated" };
      })
    );
    outcomes.push(...results);
  }

  if (logRows.length > 0) await logChangeBatch(supabase, logRows);

  return summariseUpdate(outcomes);
}
