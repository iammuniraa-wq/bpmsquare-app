import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantConfig } from "@/lib/constants";
import { loadActorNames } from "@/lib/actorNames";
import {
  APPROVAL_HISTORY_SHOWN, APPROVAL_KIND_TENDER_BID, APPROVAL_OBJECT_TENDER, approverIds, canDecide, decidersFor, effectiveDecision,
  proposalProblem, tenderSettings, type ApprovalEntry, type ApprovalRow, type ApprovalView,
} from "./approval";
import { isMissingSchema, type TenderRow } from "./server";

// Server side of the bid / no-bid approval (migration 0221). Every query is tenant-scoped on the admin client, and every one
// tolerates the table being pending: a missing approval_requests reads as "approval is not available yet", never a crash.

const COLUMNS = "id, requested_by, proposed_value, reason, status, decided_by, decided_at, decision_comment, created_at";

export async function loadApprovals(admin: SupabaseClient, tenantId: string, opportunityId: string): Promise<{ rows: ApprovalRow[]; pending: boolean }> {
  const { data, error } = await admin.from("approval_requests").select(COLUMNS)
    .eq("tenant_id", tenantId).eq("object_type", APPROVAL_OBJECT_TENDER).eq("object_id", opportunityId).eq("kind", APPROVAL_KIND_TENDER_BID)
    .order("created_at", { ascending: false }).limit(200);
  if (error) return { rows: [], pending: isMissingSchema(error) };
  return { rows: (data ?? []) as ApprovalRow[], pending: false };
}

export async function loadApprovalById(admin: SupabaseClient, tenantId: string, opportunityId: string, requestId: string): Promise<ApprovalRow | null> {
  const { data } = await admin.from("approval_requests").select(COLUMNS)
    .eq("id", requestId).eq("tenant_id", tenantId).eq("object_type", APPROVAL_OBJECT_TENDER).eq("object_id", opportunityId).eq("kind", APPROVAL_KIND_TENDER_BID).maybeSingle();
  return (data as ApprovalRow | null) ?? null;
}

/** Everyone in the workspace, and which of them are admins (the default approvers). */
export async function loadMembership(admin: SupabaseClient, tenantId: string): Promise<{ memberIds: string[]; adminIds: string[] }> {
  const { data } = await admin.from("tenant_users").select("user_id, role").eq("tenant_id", tenantId).limit(1000);
  const rows = (data ?? []) as { user_id: string; role: string | null }[];
  return { memberIds: rows.map((r) => r.user_id), adminIds: rows.filter((r) => r.role === "admin").map((r) => r.user_id) };
}

/** Who may approve in this workspace right now (settings + membership). */
export async function loadApprovers(admin: SupabaseClient, tenantId: string, config: Pick<TenantConfig, "tender"> | null | undefined): Promise<{ approvers: string[]; allowSelfApproval: boolean }> {
  const settings = tenderSettings(config);
  const { memberIds, adminIds } = await loadMembership(admin, tenantId);
  return { approvers: approverIds(settings, memberIds, adminIds), allowSelfApproval: settings.allowSelfApproval };
}

/**
 * The decision that stands for the stage guard. `available: false` when the table is not there yet (0221 pending): the guard
 * then stays at its slice-1 behaviour instead of locking every tender in Bid/No-bid behind a screen that cannot work.
 */
export async function standingDecision(admin: SupabaseClient, tenantId: string, opportunityId: string): Promise<{ available: boolean; effective: ApprovalRow | null }> {
  const { rows, pending } = await loadApprovals(admin, tenantId, opportunityId);
  if (pending) return { available: false, effective: null };
  return { available: true, effective: effectiveDecision(rows) };
}

const entry = (r: ApprovalRow, names: Map<string, string>): ApprovalEntry => ({
  id: r.id, decision: r.proposed_value, reason: r.reason, status: r.status,
  requested_by_name: names.get(r.requested_by) ?? null, requested_at: r.created_at,
  decided_by_name: r.decided_by ? names.get(r.decided_by) ?? null : null, decided_at: r.decided_at, comment: r.decision_comment,
});

/** What the Overview is given, for one person looking at one deal. `null` when the approval table is not there yet. */
export async function buildApprovalView(
  admin: SupabaseClient,
  args: { tenantId: string; userId: string; config: Pick<TenantConfig, "tender"> | null | undefined; deal: { stage: string; outcome: string }; tender: Pick<TenderRow, "decision" | "decision_reason" | "decided_by" | "decided_at">; opportunityId: string },
): Promise<ApprovalView | null> {
  const { rows, pending } = await loadApprovals(admin, args.tenantId, args.opportunityId);
  if (pending) return null;
  const { approvers, allowSelfApproval } = await loadApprovers(admin, args.tenantId, args.config);
  const open = rows.find((r) => r.status === "pending") ?? null;
  const standing = effectiveDecision(rows);
  const names = await loadActorNames(admin, args.tenantId, rows.flatMap((r) => [r.requested_by, r.decided_by]));
  const pendingEntry = open ? { ...entry(open, names), mine: open.requested_by === args.userId } : null;
  return {
    standing: standing ? entry(standing, names) : null,
    recordedBefore: args.tender.decision !== null && standing === null,
    pending: pendingEntry,
    canDecide: open ? canDecide(args.userId, approvers, open.requested_by, allowSelfApproval) : false,
    proposalBlocked: proposalProblem({ stage: args.deal.stage, outcome: args.deal.outcome, hasPending: !!open, deciders: decidersFor(approvers, args.userId, allowSelfApproval) }),
    history: rows.filter((r) => r.status !== "pending").slice(0, APPROVAL_HISTORY_SHOWN).map((r) => entry(r, names)),
  };
}
