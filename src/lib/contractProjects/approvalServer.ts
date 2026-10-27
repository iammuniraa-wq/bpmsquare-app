import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantConfig } from "@/lib/constants";
import { loadActorNames } from "@/lib/actorNames";
import { loadApprovers } from "@/lib/tender/approvalServer";
import { askProblem, canDecide, decidersFor, PROJECT_APPROVAL_KIND, PROJECT_APPROVAL_OBJECT } from "./approval";
import { isMissingSchema } from "./server";
import type { RevisionRow } from "./types";

// Server side of the baseline approval (migration 0221's approval_requests, kind project_baseline). Every query is tenant-scoped on
// the admin client, and a missing table reads as "approval is not available yet", never a crash.

export type ProjectApprovalRow = {
  id: string;
  proposed_value: string; // the revision's id
  reason: string | null;
  requested_by: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  decided_by: string | null;
  decided_at: string | null;
  decision_comment: string | null;
  created_at: string;
};

const COLUMNS = "id, proposed_value, reason, requested_by, status, decided_by, decided_at, decision_comment, created_at";

export async function loadProjectApprovals(admin: SupabaseClient, tenantId: string, projectId: string): Promise<{ rows: ProjectApprovalRow[]; pending: boolean }> {
  const { data, error } = await admin.from("approval_requests").select(COLUMNS)
    .eq("tenant_id", tenantId).eq("object_type", PROJECT_APPROVAL_OBJECT).eq("object_id", projectId).eq("kind", PROJECT_APPROVAL_KIND)
    .order("created_at", { ascending: false }).limit(200);
  if (error) return { rows: [], pending: isMissingSchema(error) };
  return { rows: (data ?? []) as ProjectApprovalRow[], pending: false };
}

export async function loadProjectApprovalById(admin: SupabaseClient, tenantId: string, projectId: string, requestId: string): Promise<ProjectApprovalRow | null> {
  const { data } = await admin.from("approval_requests").select(COLUMNS)
    .eq("id", requestId).eq("tenant_id", tenantId).eq("object_type", PROJECT_APPROVAL_OBJECT).eq("object_id", projectId).eq("kind", PROJECT_APPROVAL_KIND).maybeSingle();
  return (data as ProjectApprovalRow | null) ?? null;
}

export type ApprovalEntry = {
  id: string;
  revision_id: string;
  rev_no: number | null;
  status: ProjectApprovalRow["status"];
  reason: string | null;
  requested_by_name: string | null;
  requested_at: string;
  decided_by_name: string | null;
  decided_at: string | null;
  comment: string | null;
};

export type ProjectApprovalView = {
  pending: (ApprovalEntry & { mine: boolean }) | null;
  /** May this person decide the pending request? */
  canDecide: boolean;
  /** Why the shown revision cannot be sent for approval now (shown in place of the button), or null when it can. */
  askBlocked: string | null;
  history: ApprovalEntry[];
};

export const APPROVAL_HISTORY_SHOWN = 10;

export async function buildProjectApprovalView(
  admin: SupabaseClient,
  args: {
    tenantId: string; userId: string; projectId: string; config: Pick<TenantConfig, "tender"> | null | undefined;
    revisions: readonly RevisionRow[]; shown: RevisionRow | null; lineCount: number; linesWithoutResource: number; projectClosed: boolean;
  },
): Promise<ProjectApprovalView | null> {
  const { rows, pending } = await loadProjectApprovals(admin, args.tenantId, args.projectId);
  if (pending) return null;
  const { approvers, allowSelfApproval } = await loadApprovers(admin, args.tenantId, args.config);
  const open = rows.find((r) => r.status === "pending") ?? null;
  const names = await loadActorNames(admin, args.tenantId, rows.flatMap((r) => [r.requested_by, r.decided_by]));
  const revNo = (id: string) => args.revisions.find((r) => r.id === id)?.rev_no ?? null;
  const entry = (r: ProjectApprovalRow): ApprovalEntry => ({
    id: r.id, revision_id: r.proposed_value, rev_no: revNo(r.proposed_value), status: r.status, reason: r.reason,
    requested_by_name: names.get(r.requested_by) ?? null, requested_at: r.created_at,
    decided_by_name: r.decided_by ? names.get(r.decided_by) ?? null : null, decided_at: r.decided_at, comment: r.decision_comment,
  });
  const deciders = decidersFor(approvers, args.userId, allowSelfApproval);
  return {
    pending: open ? { ...entry(open), mine: open.requested_by === args.userId } : null,
    canDecide: open ? canDecide(args.userId, approvers, open.requested_by, allowSelfApproval) : false,
    askBlocked: args.shown ? askProblem({ revision: args.shown, lineCount: args.lineCount, linesWithoutResource: args.linesWithoutResource, deciders, projectClosed: args.projectClosed }) : "No revision yet",
    history: rows.filter((r) => r.status !== "pending").slice(0, APPROVAL_HISTORY_SHOWN).map(entry),
  };
}
