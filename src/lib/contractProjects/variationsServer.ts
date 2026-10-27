import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadActorNames } from "@/lib/actorNames";
import { logChange } from "@/lib/changeLog";
import { getAuthUser } from "@/lib/supabase-server";
import { getTenant } from "@/lib/tenant";
import { insertWithMasterRef } from "@/lib/masterRef";
import { loadApprovers } from "@/lib/tender/approvalServer";
import { loadNotifyTenant, memberEmails } from "@/lib/tender/notify";
import { canDecide, decidersFor } from "./approval";
import { projectInboxNote, projectLink, sendProjectMail } from "./notify";
import { startDraftRevision } from "./revisionStart";
import { APPROVAL_BUNDLE, costResourceCodes, existingCodes, isMissingSchema, UUID_RE, type Failure, type ProjectCtx } from "./server";
import type { ProjectRow } from "./types";
import {
  VARIATION_APPROVAL_KIND, VARIATION_APPROVAL_OBJECT, VARIATION_FALLBACK_REASON_CODE, VARIATION_LIMITS, VARIATION_REASON_CODE, approveProblem, askMessage, outcomeMessage,
  requestReason, revisionNote, submitProblem, variationCostLine, variationTotals, type VariationInput, type VariationRow, type VariationTotals,
} from "./variations";

// Server side of the variations (migration 0231). Every query is tenant-scoped on the admin client and every one tolerates the migration
// being pending (a missing table reads as `pending`, never a crash). The approval reuses approval_requests (migration 0221) and the
// people who approve project budgets; the contract value moves only here, only on an approval.

export const AFTER_AWARD_BUNDLE = "scripts/run-bundle-41-after-award-2026-10-27.sql";
export const needsVariationUpdate = (): Failure => ({
  status: 503, error: "Variations need a database update (migration 0231). Ask your administrator to apply it.",
  extra: { needsDatabaseUpdate: true, bundle: AFTER_AWARD_BUNDLE },
});

const COLS = "id, project_id, ref, title, description, status, amount, cost_amount, change_request_ref, note, submitted_by, submitted_at, decided_by, decided_at, budget_revision_id, created_by, created_at, updated_at";

export const normaliseVariation = (r: Record<string, unknown>): VariationRow => ({
  ...(r as unknown as VariationRow), amount: Number(r.amount ?? 0), cost_amount: Number(r.cost_amount ?? 0),
});

export type VariationView = VariationRow & {
  submitted_by_name: string | null;
  decided_by_name: string | null;
  revision_no: number | null;
  /** May the person looking decide this one (it is waiting, they are an approver, and it is not their own unless allowed). */
  can_decide: boolean;
  /** Did the person looking submit it (so they can withdraw it)? */
  mine: boolean;
};

export type VariationsData = {
  variations: VariationView[];
  totals: VariationTotals;
  currency: string | null;
  pending: boolean;
  canEdit: boolean;
};

export async function loadVariations(admin: SupabaseClient, tenantId: string, projectId: string): Promise<{ rows: VariationRow[]; pending: boolean }> {
  const { data, error } = await admin.from("contract_project_variations").select(COLS).eq("tenant_id", tenantId).eq("project_id", projectId).order("created_at", { ascending: false }).limit(VARIATION_LIMITS.maxPerProject);
  if (error) return { rows: [], pending: isMissingSchema(error) };
  return { rows: ((data ?? []) as Record<string, unknown>[]).map(normaliseVariation), pending: false };
}

export async function loadVariation(admin: SupabaseClient, tenantId: string, projectId: string, id: string): Promise<VariationRow | null> {
  if (!UUID_RE.test(id)) return null;
  const { data, error } = await admin.from("contract_project_variations").select(COLS).eq("id", id).eq("tenant_id", tenantId).eq("project_id", projectId).maybeSingle();
  return error || !data ? null : normaliseVariation(data as Record<string, unknown>);
}

/** What the Variations tab (and GET .../variations) is given, for one person looking at one project. */
export async function buildVariationsData(req: ProjectCtx, project: ProjectRow): Promise<VariationsData> {
  const { admin, tenantId, userId } = req;
  const { rows, pending } = await loadVariations(admin, tenantId, project.id);
  if (pending) return { variations: [], totals: variationTotals([], project.contract_value), currency: project.currency, pending: true, canEdit: req.canEdit };
  const tenant = await getTenant();
  const { approvers, allowSelfApproval } = await loadApprovers(admin, tenantId, tenant?.config);
  const names = await loadActorNames(admin, tenantId, rows.flatMap((r) => [r.submitted_by, r.decided_by]));
  const revIds = [...new Set(rows.map((r) => r.budget_revision_id).filter((x): x is string => !!x))];
  const revNo = new Map<string, number>();
  if (revIds.length > 0) {
    const { data } = await admin.from("project_budget_revisions").select("id, rev_no").eq("tenant_id", tenantId).eq("project_id", project.id).in("id", revIds);
    for (const r of (data ?? []) as { id: string; rev_no: number }[]) revNo.set(r.id, Number(r.rev_no));
  }
  return {
    variations: rows.map((r) => ({
      ...r, submitted_by_name: r.submitted_by ? names.get(r.submitted_by) ?? null : null, decided_by_name: r.decided_by ? names.get(r.decided_by) ?? null : null,
      revision_no: r.budget_revision_id ? revNo.get(r.budget_revision_id) ?? null : null,
      can_decide: r.status === "submitted" && !!r.submitted_by && canDecide(userId, approvers, r.submitted_by, allowSelfApproval),
      mine: r.submitted_by === userId,
    })),
    totals: variationTotals(rows, project.contract_value), currency: project.currency, pending: false, canEdit: req.canEdit,
  };
}

// ── Writes ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

type Result<T> = ({ ok: true } & T) | ({ ok: false } & Failure);

const labelOf = (p: ProjectRow) => `${p.ref ?? ""} ${p.name}`.trim();

async function logVariation(req: ProjectCtx, project: ProjectRow, changes: { field: string; from: unknown; to: unknown }[]) {
  const user = await getAuthUser();
  await logChange(req.supabase, { tenantId: req.tenantId, objectType: "contract_projects", objectId: project.id, objectLabel: labelOf(project), action: "update", actorId: user?.id, actorEmail: user?.email, changes });
}

export async function createVariation(req: ProjectCtx, project: ProjectRow, input: VariationInput): Promise<Result<{ variation: VariationRow }>> {
  const { admin, tenantId, userId } = req;
  if (project.status === "closed") return { ok: false, status: 409, error: "This project is closed" };
  const count = await admin.from("contract_project_variations").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("project_id", project.id);
  if (count.error && isMissingSchema(count.error)) return { ok: false, ...needsVariationUpdate() };
  if ((count.count ?? 0) >= VARIATION_LIMITS.maxPerProject) return { ok: false, status: 409, error: `A project holds up to ${VARIATION_LIMITS.maxPerProject} variations` };
  const made = await insertWithMasterRef<Record<string, unknown>>(admin, "contract_project_variations", tenantId, {
    tenant_id: tenantId, project_id: project.id, status: "draft", title: input.title, description: input.description, amount: input.amount, cost_amount: input.cost_amount,
    change_request_ref: input.change_request_ref, note: input.note, created_by: userId,
  }, COLS);
  if (made.error || !made.data) {
    if (isMissingSchema(made.error)) return { ok: false, ...needsVariationUpdate() };
    return { ok: false, status: 500, error: made.error?.message ?? "Could not save the variation" };
  }
  const variation = normaliseVariation(made.data);
  await logVariation(req, project, [{ field: `Variation ${variation.ref ?? ""} added`.replace("  ", " "), from: null, to: `${variation.title}, contract value ${variation.amount}, cost ${variation.cost_amount}` }]);
  return { ok: true, variation };
}

/** An edit of a draft (or rejected) variation. A rejected one goes back to draft. The compare-and-set on status stops an edit slipping under a submit. */
export async function editVariation(req: ProjectCtx, project: ProjectRow, variation: VariationRow, input: Partial<VariationInput>): Promise<Result<{ variation: VariationRow }>> {
  const { admin, tenantId } = req;
  if (variation.status !== "draft" && variation.status !== "rejected") return { ok: false, status: 409, error: variation.status === "submitted" ? "This variation is waiting for approval. Withdraw it to change it" : "An approved variation cannot be changed" };
  const patch: Record<string, unknown> = { ...input, updated_at: new Date().toISOString(), ...(variation.status === "rejected" ? { status: "draft", decided_by: null, decided_at: null } : {}) };
  const saved = await admin.from("contract_project_variations").update(patch).eq("id", variation.id).eq("tenant_id", tenantId).eq("project_id", project.id).eq("status", variation.status).select(COLS);
  if (saved.error) return { ok: false, status: 500, error: saved.error.message };
  const row = (saved.data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) return { ok: false, status: 409, error: "This variation changed while you were editing. Reload and try again" };
  const next = normaliseVariation(row);
  const changes = (["title", "description", "amount", "cost_amount", "change_request_ref", "note"] as const)
    .filter((k) => k in input && JSON.stringify(variation[k] ?? null) !== JSON.stringify(next[k] ?? null))
    .map((k) => ({ field: `Variation ${variation.ref ?? ""} ${k.replace("_", " ")}`.replace("  ", " "), from: variation[k] ?? null, to: next[k] ?? null }));
  if (changes.length > 0) await logVariation(req, project, changes);
  return { ok: true, variation: next };
}

export async function removeVariation(req: ProjectCtx, project: ProjectRow, variation: VariationRow): Promise<Result<object>> {
  const { admin, tenantId } = req;
  if (variation.status !== "draft" && variation.status !== "rejected") return { ok: false, status: 409, error: "Only a draft or rejected variation can be removed" };
  const gone = await admin.from("contract_project_variations").delete().eq("id", variation.id).eq("tenant_id", tenantId).eq("project_id", project.id).in("status", ["draft", "rejected"]).select("id");
  if (gone.error) return { ok: false, status: 500, error: gone.error.message };
  if ((gone.data ?? []).length === 0) return { ok: false, status: 409, error: "This variation changed. Reload and try again" };
  await logVariation(req, project, [{ field: `Variation ${variation.ref ?? ""} removed`.replace("  ", " "), from: variation.title, to: null }]);
  return { ok: true };
}

async function notify(req: ProjectCtx, project: ProjectRow, to: string[], build: (link: string) => { subject: string; text: string; comment: string }) {
  try {
    const tenant = await loadNotifyTenant(req.admin, req.tenantId);
    const emails = await memberEmails(req.admin, req.tenantId, to);
    if (!tenant || emails.length === 0) return;
    const user = await getAuthUser();
    const msg = build(projectLink(tenant, project.id));
    await projectInboxNote(req.admin, { tenantId: req.tenantId, projectId: project.id, authorId: req.userId, authorEmail: user?.email ?? null, body: msg.comment, mentionEmails: emails.map((t) => t.email) });
    await sendProjectMail(req.admin, tenant, { to: emails.map((t) => t.email), subject: msg.subject, text: msg.text, projectId: project.id, projectLabel: labelOf(project), actorId: req.userId, actorEmail: user?.email ?? null });
  } catch (e) {
    console.error("[contract-projects] variation notification failed", (e as Error).message);
  }
}

async function displayName(req: ProjectCtx): Promise<string> {
  const user = await getAuthUser();
  return (await loadActorNames(req.admin, req.tenantId, [req.userId])).get(req.userId) ?? user?.email ?? "A colleague";
}

/** Ask the people who approve project budgets to approve this variation. */
export async function submitVariation(req: ProjectCtx, project: ProjectRow, variation: VariationRow): Promise<Result<{ request_id: string }>> {
  const { admin, tenantId, userId } = req;
  if (project.status === "closed") return { ok: false, status: 409, error: "This project is closed" };
  const problem = submitProblem(variation);
  if (problem) return { ok: false, status: 409, error: problem };
  const tenant = await getTenant();
  const { approvers, allowSelfApproval } = await loadApprovers(admin, tenantId, tenant?.config);
  const deciders = decidersFor(approvers, userId, allowSelfApproval);
  if (deciders.length === 0) return { ok: false, status: 409, error: "No one else can approve it. Choose approvers in Settings > Tenders, or allow self-approval there" };

  const reason = requestReason(variation, project.currency);
  const made = await admin.from("approval_requests").insert({
    tenant_id: tenantId, object_type: VARIATION_APPROVAL_OBJECT, object_id: variation.id, kind: VARIATION_APPROVAL_KIND, proposed_value: variation.id, reason, requested_by: userId, status: "pending",
  }).select("id").single();
  if (made.error || !made.data) {
    if (isMissingSchema(made.error)) return { ok: false, status: 503, error: "Approval needs a database update (migration 0221). Ask your administrator to apply it", extra: { needsDatabaseUpdate: true, bundle: APPROVAL_BUNDLE } };
    if (made.error?.code === "23505") return { ok: false, status: 409, error: "This variation is already waiting for approval" };
    return { ok: false, status: 500, error: made.error?.message ?? "Could not ask for approval" };
  }
  const requestId = (made.data as { id: string }).id;
  const now = new Date().toISOString();
  const locked = await admin.from("contract_project_variations")
    .update({ status: "submitted", submitted_by: userId, submitted_at: now, decided_by: null, decided_at: null, updated_at: now })
    .eq("id", variation.id).eq("tenant_id", tenantId).eq("project_id", project.id).in("status", ["draft", "rejected"]).select("id");
  if (locked.error || (locked.data ?? []).length === 0) {
    await admin.from("approval_requests").delete().eq("id", requestId).eq("tenant_id", tenantId);
    return { ok: false, status: 409, error: "This variation changed while you were sending it. Reload and try again" };
  }
  await logVariation(req, project, [{ field: `Variation ${variation.ref ?? ""} sent for approval`.replace("  ", " "), from: null, to: reason }]);
  const proposer = await displayName(req);
  await notify(req, project, deciders, (link) => askMessage({ project: project.name, projectRef: project.ref, variation, proposer, reason, link }));
  return { ok: true, request_id: requestId };
}

/** The person who sent it takes it back; it returns to draft. */
export async function withdrawVariation(req: ProjectCtx, project: ProjectRow, variation: VariationRow): Promise<Result<object>> {
  const { admin, tenantId, userId } = req;
  if (variation.status !== "submitted") return { ok: false, status: 409, error: "This variation is not waiting for approval" };
  if (variation.submitted_by !== userId) return { ok: false, status: 403, error: "Only the person who sent it can withdraw it" };
  const now = new Date().toISOString();
  await admin.from("approval_requests").update({ status: "cancelled", decided_by: userId, decided_at: now }).eq("tenant_id", tenantId).eq("object_type", VARIATION_APPROVAL_OBJECT).eq("object_id", variation.id).eq("kind", VARIATION_APPROVAL_KIND).eq("status", "pending");
  const back = await admin.from("contract_project_variations").update({ status: "draft", updated_at: now }).eq("id", variation.id).eq("tenant_id", tenantId).eq("project_id", project.id).eq("status", "submitted").select("id");
  if (back.error) return { ok: false, status: 500, error: back.error.message };
  if ((back.data ?? []).length === 0) return { ok: false, status: 409, error: "This variation was just decided. Reload" };
  await logVariation(req, project, [{ field: `Variation ${variation.ref ?? ""} request withdrawn`.replace("  ", " "), from: null, to: null }]);
  return { ok: true };
}

export type DecideOutcome = { status: "approved" | "rejected"; contract_value?: number; revision: "started" | "already_open" | "no_baseline" | "no_reason" | "failed" | null; revision_id?: string; revision_no?: number };

/**
 * An approver decides a variation waiting for approval. Approving adds the amount to the project's contract value (compare-and-set on the
 * value read, so two approvals at once cannot lose one) and opens a budget revision for the cost when the project has an approved baseline
 * and no revision already open. The request is claimed with a compare-and-set on status = pending, so two people cannot both decide it.
 */
export async function decideVariation(req: ProjectCtx, project: ProjectRow, variation: VariationRow, action: "approve" | "reject", comment: string | null): Promise<Result<{ outcome: DecideOutcome }>> {
  const { admin, tenantId, userId } = req;
  const pendingReq = await admin.from("approval_requests").select("id, requested_by").eq("tenant_id", tenantId).eq("object_type", VARIATION_APPROVAL_OBJECT).eq("object_id", variation.id).eq("kind", VARIATION_APPROVAL_KIND).eq("status", "pending").maybeSingle();
  if (pendingReq.error) {
    if (isMissingSchema(pendingReq.error)) return { ok: false, status: 503, error: "Approval needs a database update (migration 0221). Ask your administrator to apply it", extra: { needsDatabaseUpdate: true, bundle: APPROVAL_BUNDLE } };
    return { ok: false, status: 500, error: pendingReq.error.message };
  }
  const request = pendingReq.data as { id: string; requested_by: string } | null;
  if (!request || variation.status !== "submitted") return { ok: false, status: 409, error: "This variation is not waiting for approval" };
  const tenant = await getTenant();
  const { approvers, allowSelfApproval } = await loadApprovers(admin, tenantId, tenant?.config);
  if (!canDecide(userId, approvers, request.requested_by, allowSelfApproval)) {
    const own = request.requested_by === userId && approvers.includes(userId);
    return { ok: false, status: 403, error: own ? "You cannot approve your own request" : "You are not an approver for project budgets" };
  }
  if (action === "approve") {
    const problem = approveProblem(variation, project);
    if (problem) return { ok: false, status: 409, error: problem };
  }

  const now = new Date().toISOString();
  const claimed = await admin.from("approval_requests")
    .update({ status: action === "approve" ? "approved" : "rejected", decided_by: userId, decided_at: now, decision_comment: comment })
    .eq("id", request.id).eq("tenant_id", tenantId).eq("status", "pending").select("id");
  if (claimed.error) return { ok: false, status: 500, error: claimed.error.message };
  if ((claimed.data ?? []).length === 0) return { ok: false, status: 409, error: "This request has already been decided" };
  const undoClaim = () => admin.from("approval_requests").update({ status: "pending", decided_by: null, decided_at: null, decision_comment: null }).eq("id", request.id).eq("tenant_id", tenantId);

  const decided = await admin.from("contract_project_variations")
    .update({ status: action === "approve" ? "approved" : "rejected", decided_by: userId, decided_at: now, updated_at: now })
    .eq("id", variation.id).eq("tenant_id", tenantId).eq("project_id", project.id).eq("status", "submitted").select("id");
  if (decided.error || (decided.data ?? []).length === 0) { await undoClaim(); return { ok: false, status: decided.error ? 500 : 409, error: decided.error?.message ?? "This variation is no longer waiting for approval" }; }

  const undoDecision = async () => {
    await admin.from("contract_project_variations").update({ status: "submitted", decided_by: null, decided_at: null }).eq("id", variation.id).eq("tenant_id", tenantId);
    await undoClaim();
  };
  const projectName = project.name;
  const decider = await displayName(req);

  if (action === "reject") {
    await logVariation(req, project, [{ field: `Variation ${variation.ref ?? ""} rejected`.replace("  ", " "), from: null, to: comment }]);
    if (request.requested_by !== userId) await notify(req, project, [request.requested_by], (link) => outcomeMessage({ project: projectName, projectRef: project.ref, variation, decider, approved: false, comment, link }));
    return { ok: true, outcome: { status: "rejected", revision: null } };
  }

  // Approved: the contract value moves, once, by the amount. Compare-and-set on the value read; one retry on a lost race.
  let before = project.contract_value;
  let after = Math.round((before + variation.amount) * 100) / 100;
  let moved = false;
  for (let attempt = 0; attempt < 3 && !moved; attempt++) {
    const up = await admin.from("contract_projects").update({ contract_value: after, updated_at: now }).eq("id", project.id).eq("tenant_id", tenantId).eq("contract_value", before).select("id");
    if (up.error) { await undoDecision(); return { ok: false, status: 500, error: up.error.message }; }
    if ((up.data ?? []).length > 0) { moved = true; break; }
    const fresh = await admin.from("contract_projects").select("contract_value").eq("id", project.id).eq("tenant_id", tenantId).maybeSingle();
    before = Number((fresh.data as { contract_value?: number | string } | null)?.contract_value ?? before);
    after = Math.round((before + variation.amount) * 100) / 100;
    if (after < 0) { await undoDecision(); return { ok: false, status: 409, error: "Approving this would take the contract value below zero" }; }
  }
  if (!moved) { await undoDecision(); return { ok: false, status: 409, error: "The contract value changed at the same moment. Try again" }; }

  // The budget revision for the cost, through the same helper the Revisions route uses.
  let revision: DecideOutcome["revision"] = null;
  let revisionId: string | undefined;
  let revisionNo: number | undefined;
  if (variation.cost_amount !== 0) {
    const reasons = await existingCodes(admin, tenantId, "justification", [VARIATION_REASON_CODE, VARIATION_FALLBACK_REASON_CODE]);
    const code = reasons.has(VARIATION_REASON_CODE) ? VARIATION_REASON_CODE : reasons.has(VARIATION_FALLBACK_REASON_CODE) ? VARIATION_FALLBACK_REASON_CODE : null;
    if (!code) {
      revision = "no_reason";
    } else {
      const resources = await costResourceCodes(admin, tenantId);
      const line = variationCostLine(variation, resources.has("51") ? "51" : null);
      const started = await startDraftRevision(admin, { tenantId, userId, projectId: project.id, justificationCode: code, justificationText: revisionNote(variation), extraLines: line ? [line] : [] });
      if (started.ok) {
        revision = "started"; revisionId = started.id; revisionNo = started.revNo;
        await admin.from("contract_project_variations").update({ budget_revision_id: started.id }).eq("id", variation.id).eq("tenant_id", tenantId);
      } else {
        revision = started.reason === "open_revision" ? "already_open" : started.reason === "no_baseline" ? "no_baseline" : "failed";
      }
    }
  }
  await logVariation(req, project, [
    { field: `Variation ${variation.ref ?? ""} approved`.replace("  ", " "), from: null, to: comment ?? variation.title },
    { field: "Contract value", from: before, to: after },
    ...(revision === "started" ? [{ field: "Budget revision started", from: null, to: `Revision ${revisionNo}: ${variation.ref ?? "variation"}` }] : []),
  ]);
  if (request.requested_by !== userId) await notify(req, project, [request.requested_by], (link) => outcomeMessage({ project: projectName, projectRef: project.ref, variation, decider, approved: true, comment, link }));
  return { ok: true, outcome: { status: "approved", contract_value: after, revision, revision_id: revisionId, revision_no: revisionNo } };
}

