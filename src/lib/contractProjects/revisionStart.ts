import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lineAmount, round2 } from "./budget";
import { insertLines, isMissingSchema, lineRows, loadLines, loadRevisions, needsUpdate } from "./server";
import type { DraftLine } from "./types";

// Starting the next budget revision of a project: a DRAFT copy of the approved one (same lines, same line_key so a change can be shown)
// with a reason, optionally with extra lines on the end. The one place this is done: the Revisions route and the approval of a variation
// both call it, so "one open revision at a time" and "a baseline first" are decided once.

export type StartRevision =
  | { ok: true; id: string; revNo: number; fromRevNo: number }
  | { ok: false; status: number; error: string; reason: "no_baseline" | "open_revision" | "failed" | "pending" };

export async function startDraftRevision(
  admin: SupabaseClient,
  args: { tenantId: string; userId: string; projectId: string; justificationCode: string; justificationText: string | null; extraLines?: readonly DraftLine[] },
): Promise<StartRevision> {
  const { tenantId, userId, projectId } = args;
  const { rows: revisions } = await loadRevisions(admin, tenantId, projectId);
  const approved = revisions.find((r) => r.status === "approved");
  if (!approved) return { ok: false, status: 409, error: "Approve the baseline first. Until then revision 0 is edited directly", reason: "no_baseline" };
  if (revisions.some((r) => r.status === "draft" || r.status === "pending")) return { ok: false, status: 409, error: "A revision is already open. Finish or withdraw it first", reason: "open_revision" };

  const extra = args.extraLines ?? [];
  const revNo = Math.max(...revisions.map((r) => r.rev_no)) + 1;
  const total = round2(approved.total + extra.reduce((s, l) => s + lineAmount(l.qty, l.unit_cost), 0));
  const made = await admin.from("project_budget_revisions").insert({
    tenant_id: tenantId, project_id: projectId, rev_no: revNo, status: "draft", justification_code: args.justificationCode, justification_text: args.justificationText, created_by: userId, total,
  }).select("id").single();
  if (made.error || !made.data) {
    if (made.error?.code === "23505") return { ok: false, status: 409, error: "A revision is already open. Finish or withdraw it first", reason: "open_revision" };
    if (isMissingSchema(made.error)) return { ok: false, status: 503, error: needsUpdate().error, reason: "pending" };
    return { ok: false, status: 500, error: made.error?.message ?? "Could not start the revision", reason: "failed" };
  }
  const revisionId = (made.data as { id: string }).id;

  // A copy of the approved lines: same keys, no committed / actual (those belong to the ERP read-back, not to a revision).
  const copy: DraftLine[] = (await loadLines(admin, tenantId, approved.id)).map((l) => ({
    line_key: l.line_key, resource_code: l.resource_code, cost_code: l.cost_code, wbs: l.wbs, description: l.description, qty: l.qty, unit: l.unit,
    unit_cost: l.unit_cost, cost_known: l.cost_known, source_ref: l.source_ref, reserve: l.reserve,
  }));
  const all = [...copy, ...extra];
  if (all.length > 0) {
    const failed = await insertLines(admin, lineRows(tenantId, projectId, revisionId, all));
    if (failed) {
      await admin.from("project_budget_lines").delete().eq("revision_id", revisionId).eq("tenant_id", tenantId);
      await admin.from("project_budget_revisions").delete().eq("id", revisionId).eq("tenant_id", tenantId);
      return { ok: false, status: 500, error: failed.message, reason: "failed" };
    }
  }
  await admin.from("contract_projects").update({ updated_at: new Date().toISOString() }).eq("id", projectId).eq("tenant_id", tenantId);
  return { ok: true, id: revisionId, revNo, fromRevNo: approved.rev_no };
}
