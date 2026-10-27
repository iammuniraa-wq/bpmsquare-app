import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadActorNames } from "@/lib/actorNames";
import { isMissingSchema } from "./server";
import { CALL_LIMITS, newestFirst, type CallKind, type CallView } from "./calls";

// Server side of the logged calls (migration 0225, slice 4). Tenant-scoped on the admin client; a missing table answers `pending`.

export const CALL_COLS = "id, kind, occurred_at, with_whom, summary, outcome, next_step, next_step_due, next_step_done_at, logged_by";
export type CallRow = {
  id: string; kind: CallKind; occurred_at: string; with_whom: string | null; summary: string; outcome: string | null;
  next_step: string | null; next_step_due: string | null; next_step_done_at: string | null; logged_by: string | null;
};

export async function listCalls(admin: SupabaseClient, tenantId: string, opportunityId: string, caller: { userId: string; isAdmin: boolean }): Promise<{ calls: CallView[]; pending: boolean }> {
  const { data, error } = await admin.from("deal_activities").select(CALL_COLS).eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).order("occurred_at", { ascending: false }).limit(CALL_LIMITS.perDeal);
  if (error) return { calls: [], pending: isMissingSchema(error) };
  const rows = (data ?? []) as CallRow[];
  const names = await loadActorNames(admin, tenantId, rows.map((r) => r.logged_by));
  return {
    pending: false,
    calls: newestFirst(rows.map((r): CallView => ({
      id: r.id, kind: r.kind, occurred_at: r.occurred_at, with_whom: r.with_whom, summary: r.summary, outcome: r.outcome,
      next_step: r.next_step, next_step_due: r.next_step_due, next_step_done_at: r.next_step_done_at,
      logged_by_name: r.logged_by ? names.get(r.logged_by) ?? null : null,
      can_change: caller.isAdmin || r.logged_by === caller.userId,
    }))),
  };
}
