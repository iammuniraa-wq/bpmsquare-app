import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTenant } from "@/lib/tenant";
import { resolveCurrency } from "@/lib/currency";
import { diffForLog, logChange } from "@/lib/changeLog";
import { getAuthUser } from "@/lib/supabase-server";
import { insertWithMasterRef } from "@/lib/masterRef";
import { loadOpportunity, loadOpportunityLines } from "@/lib/sales/opportunityServer";
import { loadTender, accountInTenant } from "@/lib/tender/server";
import { budgetTotals, round2 } from "./budget";
import { contractValueFor, mapTenderToBudget, projectNameFromDeal, type BoqInfo, type DealLine } from "./fromTender";
import {
  allocationSchemaReady, draftAmount, ensureMasterSeeds, existingCodes, insertLines, isMissingSchema, lineRows, loadProjectBySource, memberInTenant, needsAllocationUpdate, needsSourceUpdate, needsUpdate, normaliseProject,
  sourceSchemaReady, UUID_RE, type Failure, type ProjectCtx,
} from "./server";
import { PROJECT_SOURCE_LABEL, type DraftLine, type ProjectRow, type ProjectSourceType } from "./types";
import { copyTenderWbs, type WbsCopyResult } from "./copyWbs";

import { readAllPages } from "@/lib/pagedRead";
// Making a contract project (slice 5a): from an awarded tender or an accepted quote in one step, or by hand. Both paths end the same way: a project, its
// revision 0 (draft, the baseline to be approved) and its lines, with every foreign id checked against THIS workspace first. From a tender
// the lines are the CONTRACT (quantity, unit, the client's rate and amount) with an empty allocation: no cost is guessed.

/** The thing a project is made from: the id of a tender deal, or of the accepted quote. `label` is the quote's reference, for the log and the message. */
export type ProjectSource = { type: Exclude<ProjectSourceType, "manual" | "estimate">; id: string; label?: string | null };

export type CreateInput = {
  name: string;
  account_id: string | null;
  /** The tender deal; for a quote project, the deal the quote belongs to (a back link only, never read as "this is a tender"). */
  source_opportunity_id: string | null;
  /** Absent: a tender when source_opportunity_id is set, else by hand. */
  source?: ProjectSource | null;
  contract_value: number;
  currency: string | null;
  planned_start: string | null;
  planned_end: string | null;
  manager_id: string | null;
  lines: DraftLine[];
  /** Where the baseline budget started from, in words (kept on the baseline revision as its note). */
  budget_note?: string | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const cleanDate = (v: unknown): string | null => (typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
export const cleanName = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);
export const cleanCurrency = (v: unknown): string | null => (typeof v === "string" && /^[A-Za-z]{3}$/.test(v.trim()) ? v.trim().toUpperCase() : null);
export function cleanMoney(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n >= 0 && n <= 999_999_999_999 ? round2(n) : null;
}

export type TenderSource = {
  title: string;
  accountId: string;
  currency: string | null;
  contractValue: number;
  lines: DraftLine[];
  unmappedCodes: string[];
  skipped: number;
  budgetNote: string;
};

export const TENDER_BUDGET_NOTE = "Contract lines from the tender; costs to be allocated.";

/** What an awarded tender of this workspace gives a project: its lines as the contract, its account and its contract value. */
export async function loadTenderSource(admin: SupabaseClient, tenantId: string, opportunityId: string): Promise<{ ok: true; source: TenderSource } | ({ ok: false } & Failure)> {
  if (!UUID_RE.test(opportunityId)) return { ok: false, status: 404, error: "Tender not found" };
  const opp = await loadOpportunity(admin, tenantId, opportunityId);
  const tender = opp ? await loadTender(admin, tenantId, opportunityId) : null;
  if (!opp || !tender) return { ok: false, status: 404, error: "Tender not found" };
  if (opp.stage !== "awarded" || opp.outcome !== "won") return { ok: false, status: 409, error: "Only an awarded tender becomes a contract project" };

  const tenant = await getTenant();
  await ensureMasterSeeds(admin, tenantId);

  const [deal, boqRes] = await Promise.all([
    loadOpportunityLines(admin, tenantId, opportunityId),
    readAllPages((lo, hi) => admin.from("tender_boq_lines").select("line_id, item_no, cost_code").eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).order("id", { ascending: true }).range(lo, hi)),
  ]);
  const boq = new Map<string, Pick<BoqInfo, "item_no" | "cost_code">>();
  for (const r of ((boqRes.error ? [] : boqRes.data ?? []) as { line_id: string | null; item_no: string | null; cost_code: string | null }[])) {
    if (r.line_id) boq.set(r.line_id, { item_no: r.item_no, cost_code: r.cost_code });
  }
  const codes = [...new Set([...boq.values()].map((b) => b.cost_code?.trim()).filter((c): c is string => !!c))];
  const costCodes = await existingCodes(admin, tenantId, "cost_code", codes);
  const mapping = mapTenderToBudget({ lines: deal as unknown as DealLine[], boq, costCodes });

  // The award value arrives with the outcome facts of bid versions (a later migration): read it if it is there, ignore it if not.
  const award = await admin.from("opportunity_tenders").select("award_value").eq("opportunity_id", opportunityId).eq("tenant_id", tenantId).maybeSingle();
  const awardValue = award.error ? null : Number((award.data as { award_value?: number | string | null } | null)?.award_value ?? 0) || null;

  return {
    ok: true,
    source: {
      title: opp.title, accountId: opp.account_id, currency: opp.currency ?? resolveCurrency(tenant?.config).code,
      contractValue: contractValueFor({ awardValue, dealAmount: Number(opp.amount) }),
      lines: mapping.lines, unmappedCodes: mapping.unmappedCodes, skipped: mapping.skipped, budgetNote: TENDER_BUDGET_NOTE,
    },
  };
}

const sourceWords = (src: ProjectSource) => (src.type === "tender" ? "tender" : `${PROJECT_SOURCE_LABEL[src.type]}${src.label ? ` ${src.label}` : ""}`);

/** Checks every foreign id, then writes the project, revision 0 and the lines. A failure after the project row takes it back out. */
export async function createProject(req: ProjectCtx, input: CreateInput): Promise<{ ok: true; project: ProjectRow; revisionId: string; wbs: WbsCopyResult | null } | ({ ok: false } & Failure)> {
  const { admin, supabase, tenantId, userId } = req;
  const source: ProjectSource | null = input.source ?? (input.source_opportunity_id ? { type: "tender", id: input.source_opportunity_id } : null);
  const isTender = source?.type === "tender";
  if (input.account_id && !(await accountInTenant(admin, tenantId, input.account_id))) return { ok: false, status: 404, error: "Account not found" };
  if (input.manager_id && !(await memberInTenant(admin, tenantId, input.manager_id))) return { ok: false, status: 404, error: "Manager not found" };
  // A quote project records which quote (0248); without that column nothing is made, so a project never loses where it came from.
  if (source && !isTender && !(await sourceSchemaReady(admin))) return { ok: false, ...needsSourceUpdate() };
  if (source) {
    const existing = await loadProjectBySource(admin, tenantId, { type: source.type, id: source.id });
    if (existing) return { ok: false, status: 409, error: `This ${sourceWords(source)} already has a contract project${existing.ref ? `: ${existing.ref}` : ""}`, extra: { already_exists: true, project_id: existing.id } };
  }
  await ensureMasterSeeds(admin, tenantId);
  // A project made from a tender or a quote is an empty allocation: it needs the allocation columns (0240). Say so rather than make a budget that cannot say "not allocated".
  if (input.lines.some((l) => l.allocated === false) && !(await allocationSchemaReady(admin))) return { ok: false, ...needsAllocationUpdate() };

  const row: Record<string, unknown> = {
    tenant_id: tenantId, name: input.name, account_id: input.account_id, source_opportunity_id: input.source_opportunity_id, status: "draft",
    contract_value: input.contract_value, currency: input.currency, planned_start: input.planned_start, planned_end: input.planned_end,
    manager_id: input.manager_id, created_by: userId,
  };
  type Made = { id: string; ref: string | null };
  let made = await insertWithMasterRef<Made>(admin, "contract_projects", tenantId, source ? { ...row, source_type: source.type, source_id: source.id } : row, "id, ref");
  // A tender project is still made before 0248: the same row, without the two columns it cannot hold yet.
  if (made.error && isTender && isMissingSchema(made.error)) made = await insertWithMasterRef<Made>(admin, "contract_projects", tenantId, row, "id, ref");
  if (made.error || !made.data) {
    if (isMissingSchema(made.error)) return { ok: false, ...(source && !isTender ? needsSourceUpdate() : needsUpdate()) };
    if (made.error?.code === "23505") {
      const again = source ? await loadProjectBySource(admin, tenantId, { type: source.type, id: source.id }) : null;
      return { ok: false, status: 409, error: `This ${source ? sourceWords(source) : "tender"} already has a contract project${again?.ref ? `: ${again.ref}` : ""}`, extra: { already_exists: true, ...(again ? { project_id: again.id } : {}) } };
    }
    return { ok: false, status: 500, error: made.error?.message ?? "Could not create the project" };
  }
  const projectId = made.data.id;
  const undo = () => admin.from("contract_projects").delete().eq("id", projectId).eq("tenant_id", tenantId);

  const total = budgetTotals(input.lines.map((l) => ({ ...l, amount: draftAmount(l) }))).total;
  const rev = await admin.from("project_budget_revisions").insert({ tenant_id: tenantId, project_id: projectId, rev_no: 0, status: "draft", created_by: userId, total, justification_text: input.budget_note ? input.budget_note.slice(0, 1000) : null }).select("id").single();
  if (rev.error || !rev.data) { await undo(); return { ok: false, status: 500, error: rev.error?.message ?? "Could not create the budget" }; }
  const revisionId = (rev.data as { id: string }).id;
  if (input.lines.length > 0) {
    const failed = await insertLines(admin, lineRows(tenantId, projectId, revisionId, input.lines));
    if (failed) { await undo(); return { ok: false, status: 500, error: failed.message }; }
  }

  // The tender's WBS becomes the project's own copy (docs/design/wbs.md 2.5). While 0243 is pending, or if the copy fails, the project is made without one and says so.
  const wbs = isTender && input.source_opportunity_id ? await copyTenderWbs(admin, tenantId, projectId, userId, input.source_opportunity_id, revisionId) : null;

  const user = await getAuthUser();
  const full = await admin.from("contract_projects").select("*").eq("id", projectId).eq("tenant_id", tenantId).maybeSingle();
  const project = normaliseProject((full.data as Record<string, unknown> | null) ?? { id: projectId, ref: made.data.ref, ...input, tenant_id: tenantId, status: "draft" });
  await logChange(supabase, {
    tenantId, objectType: "contract_projects", objectId: projectId, objectLabel: `${project.ref ?? ""} ${project.name}`.trim(), action: "create", actorId: user?.id, actorEmail: user?.email,
    changes: [
      ...(source ? [{ field: `Created from ${isTender ? "tender" : PROJECT_SOURCE_LABEL[source.type]}`, from: null, to: isTender ? input.name : source.label ?? input.name }] : []),
      ...(wbs?.text ? [{ field: "WBS copied from tender", from: null, to: wbs.text }] : []),
      ...(wbs?.failed ? [{ field: "WBS copied from tender", from: null, to: "could not be copied" }] : []),
      ...diffForLog("contract_projects", {}, { name: project.name, contract_value: project.contract_value, budget_lines: input.lines.length, baseline_budget: total }),
    ],
  });
  return { ok: true, project, revisionId, wbs };
}

export { projectNameFromDeal };
export { loadQuoteSource } from "./fromQuote";
