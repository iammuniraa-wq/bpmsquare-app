import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OpportunityStageDef } from "@/lib/constants";
import { diffForLog, logChange, type ChangeEntry } from "@/lib/changeLog";
import { emitOpportunityStageChanged, emitOpportunityClosed } from "@/lib/events/emitters";
import { isClosedStage, outcomeForStage, probabilityFor } from "./opportunity";
import { loadOpportunity } from "./opportunityServer";

// A deal is closed as WON by something other than the rep dragging its card:
// today, its Standard Quote being accepted. This is the opportunity route's
// own close (stage + outcome + closed_at + probability, the same change-log
// entry shape, and the same emitOpportunityStageChanged / emitOpportunityClosed
// emitters) so the board, the change history and the event feed see exactly
// what they see when a rep moves the deal to Won by hand.
//
// Only a deal that is still open is touched: a deal already won, lost or
// dropped is left alone, so calling this twice (a retried request, a quote
// flipped accepted -> sent -> accepted) closes it once.

export type CloseDealResult =
  | { status: "closed"; stage: string }
  | { status: "already_closed" | "not_found" | "no_won_stage" | "error" };

/** The stage a "won" close lands on: the first closed stage whose outcome is won. */
export function wonStage(stages: OpportunityStageDef[]): OpportunityStageDef | null {
  return stages.find((s) => s.is_closed === true && outcomeForStage(stages, s.value) === "won") ?? null;
}

export async function closeOpportunityAsWon(
  admin: SupabaseClient,
  args: {
    tenantId: string;
    opportunityId: string;
    stages: OpportunityStageDef[];
    actor: { id?: string | null; email?: string | null };
    /** Why, for the change history, e.g. "Quote SQ-2026-0003 accepted". */
    reason: string;
  },
): Promise<CloseDealResult> {
  const { tenantId, opportunityId, stages, actor, reason } = args;
  const before = await loadOpportunity(admin, tenantId, opportunityId);
  if (!before) return { status: "not_found" };
  if (before.outcome !== "open" || isClosedStage(stages, before.stage)) return { status: "already_closed" };
  const won = wonStage(stages);
  if (!won) return { status: "no_won_stage" };

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    stage: won.value,
    outcome: "won",
    closed_at: now,
    loss_reason: null,
    loss_note: null,
    probability: probabilityFor(stages, won.value, before.probability_override),
    updated_at: now,
  };
  // The outcome guard makes a concurrent second close match zero rows.
  const { data, error } = await admin
    .from("opportunities")
    .update(patch)
    .eq("id", opportunityId)
    .eq("tenant_id", tenantId)
    .eq("outcome", "open")
    .select("id");
  if (error) {
    console.error("[closeDeal] update failed", error.message);
    return { status: "error" };
  }
  if (!Array.isArray(data) || data.length === 0) return { status: "already_closed" };

  const { updated_at: _u, probability: _p, ...diffPatch } = patch;
  const changes: ChangeEntry[] = [
    { field: "Closed as won", from: null, to: reason },
    ...diffForLog("opportunities", before as unknown as Record<string, unknown>, diffPatch),
  ];
  await logChange(admin, {
    tenantId, objectType: "opportunities", objectId: opportunityId, objectLabel: `${before.ref ?? ""} ${before.title}`.trim(),
    action: "update", actorId: actor.id, actorEmail: actor.email, changes,
  });

  const after = await loadOpportunity(admin, tenantId, opportunityId);
  const amount = after?.amount ?? before.amount;
  await emitOpportunityStageChanged(tenantId, {
    opportunityId, ref: before.ref, from: before.stage, to: won.value, outcome: "won", amount,
    accountId: before.account_id, contactId: before.contact_id, stamp: now, actorId: actor.id,
  });
  await emitOpportunityClosed(tenantId, {
    opportunityId, ref: before.ref, outcome: "won", amount,
    accountId: before.account_id, contactId: before.contact_id, stamp: now, actorId: actor.id,
  });
  return { status: "closed", stage: won.value };
}
