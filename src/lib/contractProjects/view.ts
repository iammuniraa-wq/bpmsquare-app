import "server-only";
import { getTenant } from "@/lib/tenant";
import { loadActorNames } from "@/lib/actorNames";
import { budgetTotals, diffRevisions, plannedMargin, type BudgetTotals, type RevisionDiff } from "./budget";
import { buildProjectApprovalView, type ProjectApprovalView } from "./approvalServer";
import { currentRevision, ensureMasterSeeds, loadLines, loadMasters, loadRevisions, type ProjectCtx } from "./server";
import type { BudgetLine, ProjectRow, RevisionRow } from "./types";

// Everything the project screen (and GET /api/contract-projects/[id]) is given, assembled once: the header with the names behind its
// ids, the revisions, the lines of the revision being looked at, the totals and planned margin, the approval state and, for a
// revision other than the baseline, what changed against the one before it (or against the approved one for a draft).

export type RevisionView = RevisionRow & { created_by_name: string | null; approved_by_name: string | null };

export type ProjectView = {
  project: ProjectRow;
  account_name: string | null;
  manager_name: string | null;
  source: { id: string; title: string; ref: string | null } | null;
  revisions: RevisionView[];
  revision: RevisionView | null;
  lines: BudgetLine[];
  totals: BudgetTotals;
  margin: { amount: number; pct: number | null };
  compare: { against: { id: string; rev_no: number; status: string }; diff: RevisionDiff } | null;
  resources: { code: string; name: string; revenue_side: boolean }[];
  justifications: { code: string; name: string }[];
  /** null while approval_requests (migration 0221) is not there yet. */
  approval: ProjectApprovalView | null;
  canEdit: boolean;
  needsApprovalUpdate: boolean;
};

export async function buildProjectView(req: ProjectCtx, project: ProjectRow, opts: { revisionId?: string | null } = {}): Promise<ProjectView> {
  const { admin, tenantId, userId } = req;
  await ensureMasterSeeds(admin, tenantId);
  const [{ rows: revs }, tenant, resourceRows, justificationRows] = await Promise.all([
    loadRevisions(admin, tenantId, project.id),
    getTenant(),
    loadMasters(admin, tenantId, "resource"),
    loadMasters(admin, tenantId, "justification", { activeOnly: true }),
  ]);
  const shown = (opts.revisionId ? revs.find((r) => r.id === opts.revisionId) : null) ?? currentRevision(revs);
  const lines = shown ? await loadLines(admin, tenantId, shown.id) : [];
  const totals = budgetTotals(lines);

  // What the shown revision is held against: a draft or waiting revision against the approved one; an approved or superseded one
  // against the revision before it. The baseline has nothing before it.
  let against: RevisionRow | null = null;
  if (shown) {
    if (shown.status === "draft" || shown.status === "pending") against = revs.find((r) => r.status === "approved") ?? null;
    else against = [...revs].reverse().find((r) => r.rev_no < shown.rev_no) ?? null;
  }
  const compare = shown && against ? { against: { id: against.id, rev_no: against.rev_no, status: against.status }, diff: diffRevisions(await loadLines(admin, tenantId, against.id), lines) } : null;

  const [accountRow, sourceRow, names, approval] = await Promise.all([
    project.account_id ? admin.from("accounts").select("name").eq("id", project.account_id).eq("tenant_id", tenantId).maybeSingle() : Promise.resolve({ data: null }),
    project.source_opportunity_id ? admin.from("opportunities").select("id, ref, title").eq("id", project.source_opportunity_id).eq("tenant_id", tenantId).maybeSingle() : Promise.resolve({ data: null }),
    loadActorNames(admin, tenantId, [project.manager_id, ...revs.flatMap((r) => [r.created_by, r.approved_by])]),
    buildProjectApprovalView(admin, {
      tenantId, userId, projectId: project.id, config: tenant?.config, revisions: revs, shown, lineCount: lines.length,
      linesWithoutResource: totals.noResourceCount, projectClosed: project.status === "closed",
    }),
  ]);

  return {
    project,
    account_name: (accountRow.data as { name?: string } | null)?.name ?? null,
    manager_name: project.manager_id ? names.get(project.manager_id) ?? null : null,
    source: (sourceRow.data as { id: string; ref: string | null; title: string } | null) ?? null,
    revisions: revs.map((r) => ({ ...r, created_by_name: r.created_by ? names.get(r.created_by) ?? null : null, approved_by_name: r.approved_by ? names.get(r.approved_by) ?? null : null })),
    revision: shown ? { ...shown, created_by_name: shown.created_by ? names.get(shown.created_by) ?? null : null, approved_by_name: shown.approved_by ? names.get(shown.approved_by) ?? null : null } : null,
    lines, totals, margin: plannedMargin(project.contract_value, totals.total), compare,
    resources: resourceRows.filter((r) => r.active || lines.some((l) => l.resource_code === r.code)).map((r) => ({ code: r.code, name: r.name, revenue_side: r.flags?.revenue_side === true })),
    justifications: justificationRows.map((r) => ({ code: r.code, name: r.name })),
    approval, canEdit: req.canEdit, needsApprovalUpdate: approval === null,
  };
}
