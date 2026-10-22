import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// The run lock, the run history and the link list every pulling connector shares (connector_sync_runs and
// connector_links carry a connector_id). The Dynamics code keeps its own copy of these; a connector written
// after it uses these. Every query names the tenant: this runs on the service-role client.

/** A run older than this cannot still be alive: the routes stop at 300 s. */
export const STALE_RUN_MS = 10 * 60 * 1000;
/** How long one run may keep starting new work; the rest of the 300 s is for the page in flight and the closing writes. */
export const RUN_BUDGET_MS = 240_000;
export const ALREADY_RUNNING = "A sync of this entity is already running — try again in a few minutes.";

export type RunCounts = {
  read: number; created: number; updated: number; unchanged: number; skipped: number; failed: number;
  filtered?: number;
  outside_scope?: number;
};

/**
 * Open a run row, which doubles as the per-entity lock. Runs a killed function left in 'running' are closed first;
 * then, if a live run exists, this one does not start. The partial unique index of 0136 makes the check atomic.
 */
export async function startRun(
  admin: SupabaseClient, tenantId: string, connectorId: string, entity: string, direction: "pull" | "push", trigger: "manual" | "schedule", userId: string | null,
): Promise<{ runId: string | null; locked: boolean }> {
  const now = Date.now();
  await admin.from("connector_sync_runs").update({
    status: "failed", finished_at: new Date(now).toISOString(),
    error: "The run did not finish (the server stopped it). The next run continues.",
  }).eq("tenant_id", tenantId).eq("connector_id", connectorId).eq("status", "running").lt("started_at", new Date(now - STALE_RUN_MS).toISOString());
  const { data: live } = await admin.from("connector_sync_runs").select("id").eq("tenant_id", tenantId).eq("connector_id", connectorId).eq("entity", entity).eq("status", "running").limit(1);
  if (live?.length) return { runId: null, locked: true };
  const { data, error } = await admin.from("connector_sync_runs").insert({ tenant_id: tenantId, connector_id: connectorId, entity, direction, trigger, started_by: userId }).select("id").single();
  if (error?.code === "23505") return { runId: null, locked: true };
  return { runId: (data?.id as string | undefined) ?? null, locked: false };
}

export async function finishRun(admin: SupabaseClient, tenantId: string, runId: string | null, counts: RunCounts, issues: string[], error: string | null, watermark: string | null): Promise<void> {
  if (!runId) return;
  const status = error ? "failed" : counts.failed > 0 ? "partial" : "succeeded";
  await admin.from("connector_sync_runs").update({
    status, finished_at: new Date().toISOString(), counts, issues: issues.slice(0, 25), error: error?.slice(0, 1000) ?? null, watermark,
  }).eq("id", runId).eq("tenant_id", tenantId);
}

export async function lastWatermark(admin: SupabaseClient, tenantId: string, connectorId: string, entity: string): Promise<string | null> {
  const { data } = await admin.from("connector_sync_runs").select("watermark").eq("tenant_id", tenantId).eq("connector_id", connectorId)
    .eq("entity", entity).eq("direction", "pull").in("status", ["succeeded", "partial"]).not("watermark", "is", null)
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  return (data?.watermark as string | null) ?? null;
}

const LINK_PAGE = 1000;

/** Every link of one entity. PostgREST answers at most 1000 rows to a plain select; a partial map would make a pull
 *  re-create records it already has. */
export async function fetchLinks<T>(admin: SupabaseClient, tenantId: string, connectorId: string, entity: string, cols: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += LINK_PAGE) {
    const { data, error } = await admin.from("connector_links").select(cols)
      .eq("tenant_id", tenantId).eq("connector_id", connectorId).eq("entity", entity).order("id").range(from, from + LINK_PAGE - 1);
    if (error) throw error;
    out.push(...((data ?? []) as unknown as T[]));
    if ((data?.length ?? 0) < LINK_PAGE) break;
  }
  return out;
}
