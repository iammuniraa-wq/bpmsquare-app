import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logChange } from "@/lib/changeLog";
import { getAuthUser } from "@/lib/supabase-server";
import { loadWinningBid } from "@/lib/tender/bids/costServer";
import { budgetTotals, round2, round4 } from "./budget";
import { PACKAGE_LIMITS, asTreeItem, lineMemberships, respreadTargets, type LineAllocation, type PackageAllocation, type WorkPackageInput } from "./allocation";
import { WBS_LIMITS, addProblem, autoCodes, cleanText, codeChanges, holdersOf, isLeaf, moveProblem, partsOf, pctText, renumberAll, setSplit, type Membership } from "@/lib/wbs/tree";
import { WBS_PENDING } from "@/lib/wbs/tips";
import { costsFromBoq, costsFromSnapshot, planFill, type BoqCostRow, type FillSkip, type Found } from "./fill";
import {
  ALLOCATION_BUNDLE, allocationSchemaReady, currentRevision, isMissingSchema, loadLines, loadProject, loadRevision, loadRevisions, needsAllocationUpdate, needsUpdate, openProjectRequest,
  refreshRevisionTotal, UUID_RE, type Failure, type ProjectCtx,
} from "./server";
import { checkOwner, loadPackages } from "./workPackagesServer";
import type { AllocationBasis, BudgetLine, ProjectRow, RevisionRow, WorkPackageRow } from "./types";

import { readAllPages } from "@/lib/pagedRead";
// The writes of the budget allocation and the WBS (migrations 0240 and 0243). Every route opens with openAllocation (the contract-projects
// gate, then a project of THIS workspace); money (a typed cost, and in the WBS basis which lines an item holds) needs the project's current
// DRAFT revision, structure and owners stay editable after the baseline is approved (docs/design/wbs.md section 2.6). Every id from a request
// is verified against the workspace and the project, and every query carries the tenant. A missing table or column reads as "needs a
// database update", never as a crash.

export type Result<T> = ({ ok: true } & T) | ({ ok: false } & Failure);
export type AllocationCtx = { req: ProjectCtx; project: ProjectRow };

export async function openAllocation(projectId: string, write: boolean): Promise<Result<AllocationCtx>> {
  const gate = await openProjectRequest({ write });
  if (!gate.ok) return gate;
  const found = await loadProject(gate.req.admin, gate.req.tenantId, projectId);
  if (found.kind === "pending") return { ok: false, ...needsUpdate() };
  if (found.kind !== "ok") return { ok: false, status: 404, error: "Not found" };
  return { ok: true, req: gate.req, project: found.project };
}

const locked = (revision: RevisionRow): Failure => ({
  status: 409, extra: { locked: true },
  error: revision.status === "pending" ? "This budget is waiting for approval and cannot be changed" : "An approved budget is locked. Start a new revision to change it",
});

/** The revision a write lands on: the one named (or the current one), which must be a draft of this project. */
export async function draftRevision(ctx: AllocationCtx, revisionId?: string | null): Promise<Result<{ revision: RevisionRow }>> {
  const { admin, tenantId } = ctx.req;
  if (ctx.project.status === "closed") return { ok: false, status: 409, error: "This project is closed", extra: { locked: true } };
  let revision: RevisionRow | null;
  if (revisionId) revision = UUID_RE.test(revisionId) ? await loadRevision(admin, tenantId, ctx.project.id, revisionId) : null;
  else revision = currentRevision((await loadRevisions(admin, tenantId, ctx.project.id)).rows);
  if (!revision) return { ok: false, status: 404, error: "Revision not found" };
  if (revision.status !== "draft") return { ok: false, ...locked(revision) };
  return { ok: true, revision };
}

const labelOf = (p: ProjectRow) => `${p.ref ?? ""} ${p.name}`.trim();
async function logProject(ctx: AllocationCtx, changes: { field: string; from: unknown; to: unknown }[]) {
  const user = await getAuthUser();
  await logChange(ctx.req.supabase, { tenantId: ctx.req.tenantId, objectType: "contract_projects", objectId: ctx.project.id, objectLabel: labelOf(ctx.project), action: "update", actorId: user?.id, actorEmail: user?.email, changes });
}
const touchProject = (ctx: AllocationCtx) => ctx.req.admin.from("contract_projects").update({ updated_at: new Date().toISOString() }).eq("id", ctx.project.id).eq("tenant_id", ctx.req.tenantId);

// ── Writing line amounts ────────────────────────────────────────────────────────────────────────────────────────────

type LineTarget = { amount: number; unit_cost: number; allocated: boolean; source_ref?: string | null };
const unitCostOf = (qty: number, amount: number) => (qty > 0 ? round4(amount / qty) : amount);
const none: LineTarget = { amount: 0, unit_cost: 0, allocated: false };
const given = (amount: number, qty: number, source_ref?: string | null): LineTarget => ({ amount, unit_cost: unitCostOf(qty, amount), allocated: true, ...(source_ref !== undefined ? { source_ref } : {}) });
const same = (l: BudgetLine, t: LineTarget) => l.allocated === t.allocated && l.amount === t.amount && (t.source_ref === undefined || l.source_ref === t.source_ref);

/** Writes the lines whose allocation changes, a few at a time. Each is matched by id AND workspace AND revision. Returns a problem text, or null. */
async function writeTargets(admin: SupabaseClient, tenantId: string, revisionId: string, lines: readonly BudgetLine[], targets: ReadonlyMap<string, LineTarget>): Promise<string | null> {
  const changed = lines.filter((l) => { const t = targets.get(l.line_key); return t && !same(l, t); });
  for (let i = 0; i < changed.length; i += 25) {
    const results = await Promise.all(changed.slice(i, i + 25).map((l) => {
      const t = targets.get(l.line_key) as LineTarget;
      return admin.from("project_budget_lines").update({ amount: t.amount, unit_cost: t.unit_cost, allocated: t.allocated, ...(t.source_ref !== undefined ? { source_ref: t.source_ref } : {}) })
        .eq("id", l.id).eq("tenant_id", tenantId).eq("revision_id", revisionId);
    }));
    const failed = results.find((r) => r.error);
    if (failed?.error) return isMissingSchema(failed.error) ? needsAllocationUpdate().error : failed.error.message;
  }
  return null;
}

/** Lays every leaf item's cost over what it holds (WBS basis); a line in no item, or in items with no cost yet, is not allocated. */
async function respreadAll(ctx: AllocationCtx, revision: RevisionRow, packages: readonly WorkPackageRow[]): Promise<string | null> {
  const { admin, tenantId } = ctx.req;
  const lines = await loadLines(admin, tenantId, revision.id);
  const spreads = respreadTargets(packages, lines);
  const targets = new Map<string, LineTarget>();
  for (const l of lines) {
    const sp = spreads.get(l.line_key);
    targets.set(l.line_key, sp ? { amount: sp.amount, unit_cost: sp.unit_cost, allocated: true, source_ref: l.source_ref } : none);
  }
  return writeTargets(admin, tenantId, revision.id, lines, targets);
}

async function finish(ctx: AllocationCtx, revision: RevisionRow, before: number, field: string): Promise<number> {
  const total = await refreshRevisionTotal(ctx.req.admin, ctx.req.tenantId, revision.id);
  await touchProject(ctx);
  if (before !== total) await logProject(ctx, [{ field, from: before, to: total }]);
  return total;
}

// ── PUT allocation ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Line mode: a cost typed on each BOQ line (null clears it). */
export async function putLineAllocation(ctx: AllocationCtx, revision: RevisionRow, rows: readonly LineAllocation[]): Promise<Result<{ total: number }>> {
  const { admin, tenantId } = ctx.req;
  if (ctx.project.allocation_basis !== "line") return { ok: false, status: 409, error: "This project is allocated by WBS" };
  if (!(await allocationSchemaReady(admin))) return { ok: false, ...needsAllocationUpdate() };
  const lines = await loadLines(admin, tenantId, revision.id);
  const byKey = new Map(lines.map((l) => [l.line_key, l]));
  if (rows.some((r) => !byKey.has(r.line_key))) return { ok: false, status: 422, error: "A line is not in this budget" };
  const before = budgetTotals(lines).total;
  const targets = new Map<string, LineTarget>();
  for (const r of rows) targets.set(r.line_key, r.amount === null ? none : given(r.amount, (byKey.get(r.line_key) as BudgetLine).qty));
  const problem = await writeTargets(admin, tenantId, revision.id, lines, targets);
  if (problem) return { ok: false, status: 500, error: problem };
  return { ok: true, total: await finish(ctx, revision, before, "Allocated") };
}

/** WBS basis: a cost typed on each leaf item, spread over what it holds (a split line gives each item its share). */
export async function putPackageAllocation(ctx: AllocationCtx, revision: RevisionRow, rows: readonly PackageAllocation[]): Promise<Result<{ total: number }>> {
  const { admin, tenantId } = ctx.req;
  if (ctx.project.allocation_basis !== "package") return { ok: false, status: 409, error: "This project is allocated by BOQ line" };
  const have = await loadPackages(admin, tenantId, ctx.project.id);
  if (have.pending) return { ok: false, ...needsAllocationUpdate() };
  const mine = new Set(have.packages.map((p) => p.id));
  if (rows.some((r) => !mine.has(r.id))) return { ok: false, status: 404, error: "WBS item not found" };
  // A cost is typed on a leaf: a parent's figures are the roll-up of its sub-items and are never stored.
  const items = have.packages.map(asTreeItem);
  const branch = rows.find((r) => r.allocated_cost !== null && !isLeaf(items, r.id));
  if (branch) return { ok: false, status: 422, error: `${have.packages.find((p) => p.id === branch.id)?.code ?? "That item"} has sub-items. Type the cost on one of them` };
  const before = budgetTotals(await loadLines(admin, tenantId, revision.id)).total;
  for (const r of rows) {
    const { error } = await admin.from("project_work_packages").update({ allocated_cost: r.allocated_cost, updated_at: new Date().toISOString() }).eq("id", r.id).eq("tenant_id", tenantId).eq("project_id", ctx.project.id);
    if (error) return { ok: false, status: 500, error: error.message };
  }
  const packages = (await loadPackages(admin, tenantId, ctx.project.id)).packages;
  const problem = await respreadAll(ctx, revision, packages);
  if (problem) return { ok: false, status: 500, error: problem };
  return { ok: true, total: await finish(ctx, revision, before, "Allocated") };
}

// ── PATCH allocation/basis ──────────────────────────────────────────────────────────────────────────────────────────

/** Switching clears what was typed (the WBS is kept) and is only allowed before a baseline is approved or waiting. */
export async function changeBasis(ctx: AllocationCtx, basis: AllocationBasis): Promise<Result<{ basis: AllocationBasis; total: number }>> {
  const { admin, tenantId } = ctx.req;
  if (!(await allocationSchemaReady(admin))) return { ok: false, ...needsAllocationUpdate() };
  const revisions = (await loadRevisions(admin, tenantId, ctx.project.id)).rows;
  if (revisions.some((r) => r.status === "approved" || r.status === "pending")) {
    return { ok: false, status: 409, error: "The basis cannot change once a baseline is waiting for approval or approved", extra: { locked: true } };
  }
  if (ctx.project.status === "closed") return { ok: false, status: 409, error: "This project is closed", extra: { locked: true } };
  const draft = revisions.find((r) => r.status === "draft");
  if (!draft) return { ok: false, status: 404, error: "Revision not found" };
  if (ctx.project.allocation_basis === basis) return { ok: true, basis, total: draft.total };

  const lines = await loadLines(admin, tenantId, draft.id);
  const before = budgetTotals(lines).total;
  const problem = await writeTargets(admin, tenantId, draft.id, lines, new Map(lines.map((l) => [l.line_key, none])));
  if (problem) return { ok: false, status: 500, error: problem };
  const cleared = await admin.from("project_work_packages").update({ allocated_cost: null, updated_at: new Date().toISOString() }).eq("project_id", ctx.project.id).eq("tenant_id", tenantId);
  if (cleared.error && !isMissingSchema(cleared.error)) return { ok: false, status: 500, error: cleared.error.message };
  const set = await admin.from("contract_projects").update({ allocation_basis: basis, updated_at: new Date().toISOString() }).eq("id", ctx.project.id).eq("tenant_id", tenantId);
  if (set.error) return { ok: false, status: 500, error: set.error.message };
  const total = await refreshRevisionTotal(admin, tenantId, draft.id);
  await logProject(ctx, [{ field: "Allocate by", from: ctx.project.allocation_basis === "package" ? "WBS" : "BOQ line", to: basis === "package" ? "WBS" : "BOQ line" }, ...(before !== total ? [{ field: "Allocated", from: before, to: total }] : [])]);
  return { ok: true, basis, total };
}

// ── POST allocation/fill ────────────────────────────────────────────────────────────────────────────────────────────

/** Is there a tender to copy the recorded costs from? */
export function fillAvailable(project: Pick<ProjectRow, "source_opportunity_id">, lines: readonly Pick<BudgetLine, "source_line_id">[]): boolean {
  return !!project.source_opportunity_id && lines.some((l) => !!l.source_line_id);
}

async function recordedCosts(ctx: AllocationCtx, lines: readonly BudgetLine[]): Promise<Map<string, Found>> {
  const { admin, tenantId } = ctx.req;
  const source = ctx.project.source_opportunity_id as string;
  const winning = await loadWinningBid(admin, tenantId, source);
  if (winning?.cost) return costsFromSnapshot(lines, winning.cost, winning.version_no);
  const res = await readAllPages((lo, hi) => admin.from("tender_boq_lines").select("line_id, unit_cost, price_source, price_source_ref").eq("tenant_id", tenantId).eq("opportunity_id", source).order("id", { ascending: true }).range(lo, hi));
  return costsFromBoq(lines, (res.error ? [] : res.data ?? []) as BoqCostRow[]);
}

/** Copies the costs recorded on the tender, once. Lines that already have an allocation are overwritten only with `replace`. */
export async function fillFromTender(ctx: AllocationCtx, revision: RevisionRow, replace: boolean): Promise<Result<{ filled: number; skipped: FillSkip[]; total: number }>> {
  const { admin, tenantId } = ctx.req;
  if (!(await allocationSchemaReady(admin))) return { ok: false, ...needsAllocationUpdate() };
  const lines = await loadLines(admin, tenantId, revision.id);
  if (!fillAvailable(ctx.project, lines)) return { ok: false, status: 409, error: "There is no tender to copy costs from" };
  const before = budgetTotals(lines).total;
  const found = await recordedCosts(ctx, lines);
  const byKey = new Map(lines.map((l) => [l.line_key, l]));
  const skipped: FillSkip[] = [];
  let filled = 0;

  if (ctx.project.allocation_basis === "line") {
    const plan = planFill(lines, found, replace);
    skipped.push(...plan.skipped);
    const targets = new Map<string, LineTarget>(plan.fills.map((f) => [f.line_key, given(f.amount, (byKey.get(f.line_key) as BudgetLine).qty, f.ref)]));
    const problem = await writeTargets(admin, tenantId, revision.id, lines, targets);
    if (problem) return { ok: false, status: 500, error: problem };
    filled = plan.fills.length;
  } else {
    const have = await loadPackages(admin, tenantId, ctx.project.id);
    if (have.pending) return { ok: false, ...needsAllocationUpdate() };
    const plan = planFill(lines, found, true);
    const cost = new Map(plan.fills.map((f) => [f.line_key, f.amount]));
    const memberships = lineMemberships(have.packages);
    const hasChild = new Set(have.packages.map((p) => p.parent_id).filter((x): x is string => !!x));
    for (const p of have.packages) {
      if (hasChild.has(p.id)) continue;
      // What the leaf holds: its whole lines, and its share of each split line.
      const held = [...memberships].flatMap(([key, m]) => {
        const mine = partsOf(m).find((x) => x.wbs_item_id === p.id);
        return mine && byKey.has(key) ? [{ line: byKey.get(key) as BudgetLine, share: mine.share_pct }] : [];
      });
      const priced = held.filter((h) => cost.has(h.line.line_key));
      for (const h of held) if (!cost.has(h.line.line_key)) skipped.push({ item: h.line.wbs ?? h.line.description, reason: (found.get(h.line.line_key) as { skip: string } | undefined)?.skip ?? "no recorded cost on the tender" });
      if (priced.length === 0) continue;
      if (p.allocated_cost !== null && !replace) { skipped.push({ item: p.code, reason: "already allocated" }); continue; }
      const sum = round2(priced.reduce((s, h) => s + ((cost.get(h.line.line_key) as number) * h.share) / 100, 0));
      const { error } = await admin.from("project_work_packages").update({ allocated_cost: sum, updated_at: new Date().toISOString() }).eq("id", p.id).eq("tenant_id", tenantId).eq("project_id", ctx.project.id);
      if (error) return { ok: false, status: 500, error: error.message };
      filled += priced.length;
    }
    const problem = await respreadAll(ctx, revision, (await loadPackages(admin, tenantId, ctx.project.id)).packages);
    if (problem) return { ok: false, status: 500, error: problem };
    for (const l of lines) if (partsOf(memberships.get(l.line_key) ?? { wbs_item_id: null, parts: [] }).length === 0) skipped.push({ item: l.wbs ?? l.description, reason: "not in a WBS item" });
  }
  const total = await finish(ctx, revision, before, "Fill from tender costs");
  return { ok: true, filled, skipped: skipped.slice(0, 200), total };
}


// ── The WBS: items, where lines sit, splits ─────────────────────────────────────────────────────────────────────────

/**
 * What a WBS write works on: the project's current revision (the draft while one is open), and whether money may move in it. Structure
 * (names, codes, parents, owners, new items) is allowed on any revision of an open project; the cost typed on an item and, in the WBS basis,
 * which lines an item holds and how a line is split are money, and need the draft (docs/design/wbs.md section 2.6).
 */
export type WbsWork = { revision: RevisionRow; draft: boolean };

export async function workingRevision(ctx: AllocationCtx): Promise<Result<{ work: WbsWork }>> {
  const { admin, tenantId } = ctx.req;
  if (ctx.project.status === "closed") return { ok: false, status: 409, error: "This project is closed", extra: { locked: true } };
  const revision = currentRevision((await loadRevisions(admin, tenantId, ctx.project.id)).rows);
  if (!revision) return { ok: false, status: 404, error: "Revision not found" };
  return { ok: true, work: { revision, draft: revision.status === "draft" } };
}

export const LINES_LOCKED = "Allocation locked: start a revision to move lines";

/** In the WBS basis, which lines an item holds IS the allocation, so after the baseline is waiting or approved it cannot change. In the BOQ-line basis it can. */
const moneyLock = (ctx: AllocationCtx, work: WbsWork): Failure | null =>
  ctx.project.allocation_basis === "package" && !work.draft ? { status: 409, error: LINES_LOCKED, extra: { locked: true } } : null;

const pending = (): Failure => ({ status: 503, error: WBS_PENDING, extra: { needsDatabaseUpdate: true, bundle: ALLOCATION_BUNDLE } });
const itemsOf = (packages: readonly WorkPackageRow[]) => packages.map(asTreeItem);
const holdersIn = (packages: readonly WorkPackageRow[]) => holdersOf([...lineMemberships(packages).values()]);
const codeFor = (packages: readonly WorkPackageRow[], id: string) => packages.find((p) => p.id === id)?.code ?? "?";
const nextSort = (packages: readonly WorkPackageRow[], parentId: string | null, skip?: string) => packages.filter((p) => (p.parent_id ?? null) === parentId && p.id !== skip).reduce((m, p) => Math.max(m, p.sort_order), 0) + 10;
const heldCount = (packages: readonly WorkPackageRow[], id: string) => [...lineMemberships(packages).values()].filter((m) => partsOf(m).some((s) => s.wbs_item_id === id)).length;
const label = (l: Pick<BudgetLine, "wbs" | "description"> | undefined) => l?.wbs ?? l?.description ?? "A line";

async function owned(ctx: AllocationCtx, ownerId: string | null | undefined): Promise<Failure | null> {
  if (!ownerId) return null;
  const ok = await checkOwner(ctx.req.admin, ctx.req.tenantId, ownerId);
  if (ok.ok) return null;
  return { status: ok.status, error: ok.error, ...(ok.needs_login ? { extra: { needs_login: true, employee_id: ownerId } } : {}) };
}

/** A line already in ANOTHER item (whole or as a share), as the plain message the screen shows. */
function takenBy(lines: readonly BudgetLine[], packages: readonly WorkPackageRow[], keys: readonly string[], selfId?: string): string | null {
  for (const k of keys) {
    const whole = packages.find((p) => p.id !== selfId && p.line_keys.includes(k));
    if (whole) return `${label(lines.find((x) => x.line_key === k))} is already in ${whole.code}`;
    if (packages.some((p) => (p.line_parts ?? []).some((x) => x.line_key === k))) return `${label(lines.find((x) => x.line_key === k))} is split across items. Edit its split instead`;
  }
  return null;
}

async function insertLinks(admin: SupabaseClient, tenantId: string, projectId: string, packageId: string, keys: readonly string[]): Promise<string | null> {
  if (keys.length === 0) return null;
  const { error } = await admin.from("project_work_package_lines").insert(keys.map((k, i) => ({ tenant_id: tenantId, project_id: projectId, package_id: packageId, line_key: k, sort_order: i })));
  if (!error) return null;
  return error.code === "23505" ? "A line is already in another WBS item" : error.message;
}

/** Sets the codes a recode produced, parking items on unique temporary codes first so a swap never meets the (project, code) constraint. */
async function applyCodes(ctx: AllocationCtx, changes: readonly { id: string; to: string; manual_cleared?: boolean }[]): Promise<string | null> {
  if (changes.length === 0) return null;
  const { admin, tenantId } = ctx.req;
  const now = new Date().toISOString();
  const write = (id: string, code: string, extra: Record<string, unknown> = {}) =>
    admin.from("project_work_packages").update({ code, updated_at: now, ...extra }).eq("id", id).eq("tenant_id", tenantId).eq("project_id", ctx.project.id);
  if (changes.length > 1) {
    for (const c of changes) {
      const { error } = await write(c.id, `~${c.id.replace(/-/g, "").slice(0, 18)}`);
      if (error) return error.message;
    }
  }
  for (const c of changes) {
    const { error } = await write(c.id, c.to, c.manual_cleared ? { code_is_manual: false } : {});
    if (error) return error.message;
  }
  return null;
}

/** Recodes every auto-numbered item after the tree changed. `packages` is the tree AS IT NOW STANDS. */
const recode = (ctx: AllocationCtx, packages: readonly WorkPackageRow[]) => applyCodes(ctx, codeChanges(itemsOf(packages)).map((c) => ({ id: c.id, to: c.to })));

async function respreadIfDraft(ctx: AllocationCtx, work: WbsWork): Promise<string | null> {
  if (ctx.project.allocation_basis !== "package" || !work.draft) return null;
  const problem = await respreadAll(ctx, work.revision, (await loadPackages(ctx.req.admin, ctx.req.tenantId, ctx.project.id)).packages);
  if (problem) return problem;
  await refreshRevisionTotal(ctx.req.admin, ctx.req.tenantId, work.revision.id);
  return null;
}

/** Everything an item holds (whole lines and shares) moves to another item; the cost typed on it goes with it. Used when a leaf gains its first sub-item. */
async function moveHeld(ctx: AllocationCtx, from: WorkPackageRow, toId: string): Promise<string | null> {
  const { admin, tenantId } = ctx.req;
  const a = await admin.from("project_work_package_lines").update({ package_id: toId }).eq("tenant_id", tenantId).eq("project_id", ctx.project.id).eq("package_id", from.id);
  if (a.error) return a.error.message;
  const b = await admin.from("project_work_package_line_parts").update({ package_id: toId }).eq("tenant_id", tenantId).eq("project_id", ctx.project.id).eq("package_id", from.id);
  if (b.error && !isMissingSchema(b.error)) return b.error.message;
  if (from.allocated_cost !== null) {
    const c = await admin.from("project_work_packages").update({ allocated_cost: from.allocated_cost, updated_at: new Date().toISOString() }).eq("id", toId).eq("tenant_id", tenantId).eq("project_id", ctx.project.id);
    if (c.error) return c.error.message;
    const d = await admin.from("project_work_packages").update({ allocated_cost: null, updated_at: new Date().toISOString() }).eq("id", from.id).eq("tenant_id", tenantId).eq("project_id", ctx.project.id);
    if (d.error) return d.error.message;
  }
  return null;
}

export async function createPackage(ctx: AllocationCtx, work: WbsWork, input: Partial<WorkPackageInput> & { name: string }): Promise<Result<{ id: string; code: string }>> {
  const { admin, tenantId } = ctx.req;
  const keys = input.line_keys ?? [];
  const typed = input.code ? cleanText(input.code, WBS_LIMITS.codeMax) : null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const have = await loadPackages(admin, tenantId, ctx.project.id);
    if (have.pending) return { ok: false, ...needsAllocationUpdate() };
    const parentId = input.parent_id ?? null;
    if (parentId !== null && have.treePending) return { ok: false, ...pending() };
    const items = itemsOf(have.packages);
    if (parentId !== null && !have.packages.some((p) => p.id === parentId)) return { ok: false, status: 404, error: "WBS item not found" };
    const problem = addProblem(items, parentId);
    if (problem) return { ok: false, status: items.length >= PACKAGE_LIMITS.maxPerRecord ? 409 : 422, error: problem };
    if (typed && have.packages.some((p) => p.code === typed)) return { ok: false, status: 409, error: `The code ${typed} is already used on this project` };
    if (keys.length > 0) {
      const lock = moneyLock(ctx, work);
      if (lock) return { ok: false, ...lock };
    }
    const lines = await loadLines(admin, tenantId, work.revision.id);
    const clash = takenBy(lines, have.packages, keys);
    if (clash) return { ok: false, status: 409, error: clash };
    const bad = await owned(ctx, input.owner_employee_id);
    if (bad) return { ok: false, ...bad };

    const parent = parentId ? have.packages.find((p) => p.id === parentId) ?? null : null;
    const parentHolds = !!parent && (parent.line_keys.length > 0 || (parent.line_parts ?? []).length > 0 || parent.allocated_cost !== null);
    const id = randomUUID();
    const sort = nextSort(have.packages, parentId);
    const draft: WorkPackageRow = { id, code: "?", name: input.name, owner_employee_id: input.owner_employee_id ?? null, owner_name: null, allocated_cost: null, sort_order: sort, note: input.note ?? null, line_keys: [], parent_id: parentId, code_is_manual: !!typed };
    const code = typed ?? (autoCodes([...items, asTreeItem({ ...draft, code_is_manual: false })]).get(id) as string);
    const made = await admin.from("project_work_packages").insert({
      id, tenant_id: tenantId, project_id: ctx.project.id, code, name: input.name, owner_employee_id: input.owner_employee_id ?? null, note: input.note ?? null, sort_order: sort, created_by: ctx.req.userId,
      ...(have.treePending ? {} : { parent_id: parentId, code_is_manual: !!typed }),
    });
    if (made.error) {
      if (made.error.code === "23505") { if (typed) return { ok: false, status: 409, error: `The code ${typed} is already used on this project` }; continue; }
      if (isMissingSchema(made.error)) return { ok: false, ...needsAllocationUpdate() };
      return { ok: false, status: 500, error: made.error.message };
    }
    // A leaf that gains its first sub-item hands what it holds (lines, shares, cost) to it: the lines stay on a leaf.
    let moved = 0;
    if (parent && parentHolds) {
      moved = heldCount(have.packages, parent.id);
      const err = await moveHeld(ctx, parent, id);
      if (err) { await admin.from("project_work_packages").delete().eq("id", id).eq("tenant_id", tenantId); return { ok: false, status: 500, error: err }; }
    }
    const linked = await insertLinks(admin, tenantId, ctx.project.id, id, keys);
    if (linked) {
      await admin.from("project_work_packages").delete().eq("id", id).eq("tenant_id", tenantId);
      return { ok: false, status: 409, error: linked };
    }
    const err = await respreadIfDraft(ctx, work);
    if (err) return { ok: false, status: 500, error: err };
    await touchProject(ctx);
    const n = keys.length + moved;
    await logProject(ctx, [{ field: `WBS ${code} added`, from: null, to: `${input.name}${n > 0 ? `, ${n} line${n === 1 ? "" : "s"}` : ""}` }]);
    return { ok: true, id, code };
  }
  return { ok: false, status: 409, error: "Another change took the next code. Try again" };
}

export async function updatePackage(ctx: AllocationCtx, work: WbsWork, current: WorkPackageRow, input: Partial<WorkPackageInput>): Promise<Result<{ code: string }>> {
  const { admin, tenantId } = ctx.req;
  const have = await loadPackages(admin, tenantId, ctx.project.id);
  if (have.pending) return { ok: false, ...needsAllocationUpdate() };
  const items = itemsOf(have.packages);
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  const patch: Record<string, unknown> = {};
  let tree = have.packages;
  let reorder = false;

  if ("owner_employee_id" in input && (input.owner_employee_id ?? null) !== current.owner_employee_id) {
    const bad = await owned(ctx, input.owner_employee_id);
    if (bad) return { ok: false, ...bad };
    patch.owner_employee_id = input.owner_employee_id ?? null;
    changes.push({ field: `WBS ${current.code} owner`, from: current.owner_employee_id, to: input.owner_employee_id ?? null });
  }
  if (input.name !== undefined && input.name !== current.name) { patch.name = input.name; changes.push({ field: `WBS ${current.code} renamed`, from: current.name, to: input.name }); }
  if ("note" in input && (input.note ?? null) !== (current.note ?? null)) patch.note = input.note ?? null;

  if ("parent_id" in input && (input.parent_id ?? null) !== (current.parent_id ?? null)) {
    const parentId = input.parent_id ?? null;
    if (parentId !== null && !have.packages.some((p) => p.id === parentId)) return { ok: false, status: 404, error: "WBS item not found" };
    const problem = moveProblem(items, current.id, parentId, holdersIn(have.packages));
    if (problem) return { ok: false, status: 422, error: problem };
    patch.parent_id = parentId;
    patch.sort_order = nextSort(have.packages, parentId, current.id);
    tree = tree.map((p) => (p.id === current.id ? { ...p, parent_id: parentId, sort_order: patch.sort_order as number } : p));
    changes.push({ field: `WBS ${current.code} moved`, from: current.parent_id ? codeFor(have.packages, current.parent_id) : "top level", to: parentId ? codeFor(have.packages, parentId) : "top level" });
    reorder = true;
  }
  if (input.code !== undefined) {
    if (input.code === "") {
      if (current.code_is_manual) {
        patch.code_is_manual = false;
        tree = tree.map((p) => (p.id === current.id ? { ...p, code_is_manual: false } : p));
        changes.push({ field: `WBS ${current.code} code`, from: current.code, to: "numbered automatically" });
        reorder = true;
      }
    } else if (input.code !== current.code) {
      if (have.packages.some((p) => p.id !== current.id && p.code === input.code)) return { ok: false, status: 409, error: `The code ${input.code} is already used on this project` };
      patch.code = input.code; patch.code_is_manual = true;
      tree = tree.map((p) => (p.id === current.id ? { ...p, code: input.code as string, code_is_manual: true } : p));
      changes.push({ field: `WBS ${current.code} code`, from: current.code, to: input.code });
      reorder = true;
    }
  }

  let linesChanged = false;
  if (input.line_keys && JSON.stringify([...input.line_keys].sort()) !== JSON.stringify([...current.line_keys].sort())) {
    const lock = moneyLock(ctx, work);
    if (lock) return { ok: false, ...lock };
    if (!isLeaf(items, current.id)) return { ok: false, status: 422, error: `${current.code} has sub-items` };
    const lines = await loadLines(admin, tenantId, work.revision.id);
    const clash = takenBy(lines, have.packages, input.line_keys, current.id);
    if (clash) return { ok: false, status: 409, error: clash };
    linesChanged = true;
  }

  if (have.treePending) {
    // 0243 is not applied: names, codes and owners still save; a move cannot, and a typed code is not remembered as typed.
    if ("parent_id" in patch) return { ok: false, ...pending() };
    delete patch.code_is_manual;
  }
  if (Object.keys(patch).length > 0) {
    const { error } = await admin.from("project_work_packages").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", current.id).eq("tenant_id", tenantId).eq("project_id", ctx.project.id);
    if (error) {
      if (error.code === "23505") return { ok: false, status: 409, error: `The code ${typeof patch.code === "string" ? patch.code : current.code} is already used on this project` };
      return isMissingSchema(error) ? { ok: false, ...pending() } : { ok: false, status: 500, error: error.message };
    }
  }
  if (linesChanged) {
    const keys = input.line_keys as string[];
    const gone = await admin.from("project_work_package_lines").delete().eq("package_id", current.id).eq("tenant_id", tenantId).eq("project_id", ctx.project.id);
    if (gone.error) return { ok: false, status: 500, error: gone.error.message };
    const linked = await insertLinks(admin, tenantId, ctx.project.id, current.id, keys);
    if (linked) {
      await insertLinks(admin, tenantId, ctx.project.id, current.id, current.line_keys);
      return { ok: false, status: 409, error: linked };
    }
    changes.push({ field: `WBS ${current.code} lines`, from: current.line_keys.length, to: keys.length });
    const err = await respreadIfDraft(ctx, work);
    if (err) return { ok: false, status: 500, error: err };
  }
  let code = (patch.code as string | undefined) ?? current.code;
  if (reorder) {
    const err = await recode(ctx, tree);
    if (err) return { ok: false, status: 500, error: err };
    code = autoCodes(itemsOf(tree)).get(current.id) ?? code;
  }
  await touchProject(ctx);
  if (changes.length > 0) await logProject(ctx, changes);
  return { ok: true, code };
}

/**
 * Removes an item: its whole lines go back to unassigned, its shares of split lines go with it (each split line then shows an unassigned
 * remainder, nothing is re-spread), its sub-items move up one level, and the cost typed on it leaves with it. After the baseline is waiting or
 * approved an item can only go when it holds no allocation and no lines.
 */
export async function deletePackage(ctx: AllocationCtx, work: WbsWork, current: WorkPackageRow): Promise<Result<{ lines: number; parts: number }>> {
  const { admin, tenantId } = ctx.req;
  const have = await loadPackages(admin, tenantId, ctx.project.id);
  if (have.pending) return { ok: false, ...needsAllocationUpdate() };
  const parts = (current.line_parts ?? []).length;
  if (!work.draft && (current.allocated_cost !== null || current.line_keys.length > 0 || parts > 0)) {
    return { ok: false, status: 409, error: `${current.code} holds ${current.allocated_cost !== null ? "an allocation" : "lines"}. Start a revision to remove it`, extra: { locked: true } };
  }
  const kids = have.packages.filter((p) => p.parent_id === current.id);
  for (const [n, k] of kids.entries()) {
    const { error } = await admin.from("project_work_packages").update({ parent_id: current.parent_id ?? null, sort_order: current.sort_order + n, updated_at: new Date().toISOString() }).eq("id", k.id).eq("tenant_id", tenantId).eq("project_id", ctx.project.id);
    if (error) return { ok: false, status: 500, error: error.message };
  }
  const links = await admin.from("project_work_package_lines").delete().eq("package_id", current.id).eq("tenant_id", tenantId).eq("project_id", ctx.project.id);
  if (links.error) return { ok: false, status: 500, error: links.error.message };
  const shares = await admin.from("project_work_package_line_parts").delete().eq("package_id", current.id).eq("tenant_id", tenantId).eq("project_id", ctx.project.id);
  if (shares.error && !isMissingSchema(shares.error)) return { ok: false, status: 500, error: shares.error.message };
  const gone = await admin.from("project_work_packages").delete().eq("id", current.id).eq("tenant_id", tenantId).eq("project_id", ctx.project.id);
  if (gone.error) return { ok: false, status: 500, error: gone.error.message };

  const after = have.packages.filter((p) => p.id !== current.id).map((p) => (p.parent_id === current.id ? { ...p, parent_id: current.parent_id ?? null, sort_order: current.sort_order + kids.findIndex((k) => k.id === p.id) } : p));
  const err = await recode(ctx, after);
  if (err) return { ok: false, status: 500, error: err };
  const problem = await respreadIfDraft(ctx, work);
  if (problem) return { ok: false, status: 500, error: problem };
  await touchProject(ctx);
  await logProject(ctx, [{ field: `WBS ${current.code} removed`, from: current.name, to: current.line_keys.length + parts > 0 ? `${current.line_keys.length} line${current.line_keys.length === 1 ? "" : "s"} to unassigned${parts > 0 ? `, ${parts} share${parts === 1 ? "" : "s"} of split lines now unassigned` : ""}` : null }]);
  return { ok: true, lines: current.line_keys.length, parts };
}

/** Group into WBS: puts those budget lines into one leaf item (null = unassigned). A split line in the list is unsplit; the answer says how many. */
export async function assignLineKeys(ctx: AllocationCtx, work: WbsWork, keys: readonly string[], packageId: string | null): Promise<Result<{ assigned: number; unsplit: number }>> {
  const { admin, tenantId } = ctx.req;
  const have = await loadPackages(admin, tenantId, ctx.project.id);
  if (have.pending) return { ok: false, ...needsAllocationUpdate() };
  if (have.treePending) return { ok: false, ...pending() };
  const lock = moneyLock(ctx, work);
  if (lock) return { ok: false, ...lock };
  if (packageId !== null) {
    const target = have.packages.find((p) => p.id === packageId);
    if (!target) return { ok: false, status: 404, error: "WBS item not found" };
    if (!isLeaf(itemsOf(have.packages), packageId)) return { ok: false, status: 422, error: `${target.code} has sub-items. Choose one of them` };
  }
  const memberships = lineMemberships(have.packages);
  const unsplit = keys.filter((k) => (memberships.get(k)?.parts.length ?? 0) > 0).length;
  const before = packageId ? heldCount(have.packages, packageId) : 0;
  const cleared = await admin.from("project_work_package_lines").delete().eq("tenant_id", tenantId).eq("project_id", ctx.project.id).in("line_key", keys as string[]);
  if (cleared.error) return { ok: false, status: 500, error: cleared.error.message };
  const shares = await admin.from("project_work_package_line_parts").delete().eq("tenant_id", tenantId).eq("project_id", ctx.project.id).in("line_key", keys as string[]);
  if (shares.error) return { ok: false, status: 500, error: shares.error.message };
  if (packageId !== null) {
    const linked = await insertLinks(admin, tenantId, ctx.project.id, packageId, keys);
    if (linked) return { ok: false, status: 409, error: linked };
  }
  const problem = await respreadIfDraft(ctx, work);
  if (problem) return { ok: false, status: 500, error: problem };
  await touchProject(ctx);
  if (packageId) {
    const was = keys.filter((k) => partsOf(memberships.get(k) ?? { wbs_item_id: null, parts: [] }).some((s) => s.wbs_item_id === packageId)).length;
    await logProject(ctx, [{ field: `WBS ${codeFor(have.packages, packageId)} lines`, from: before, to: before + keys.length - was }]);
  } else await logProject(ctx, [{ field: "WBS lines unassigned", from: null, to: `${keys.length} line${keys.length === 1 ? "" : "s"}` }]);
  return { ok: true, assigned: keys.length, unsplit };
}

/** Writes a line's split as one set; a set of one part is the line sitting whole in that item. */
export async function setLineSplit(ctx: AllocationCtx, work: WbsWork, lineKey: string, parts: readonly { package_id: string; share_pct: number }[]): Promise<Result<{ kind: "whole" | "parts" }>> {
  const { admin, tenantId } = ctx.req;
  const have = await loadPackages(admin, tenantId, ctx.project.id);
  if (have.pending) return { ok: false, ...needsAllocationUpdate() };
  if (have.treePending) return { ok: false, ...pending() };
  const lock = moneyLock(ctx, work);
  if (lock) return { ok: false, ...lock };
  const mine = new Set(have.packages.map((p) => p.id));
  if (parts.some((p) => !mine.has(p.package_id))) return { ok: false, status: 404, error: "WBS item not found" };
  const verdict = setSplit(itemsOf(have.packages), parts.map((p) => ({ wbs_item_id: p.package_id, share_pct: p.share_pct })));
  if (!verdict.ok) return { ok: false, status: 422, error: verdict.error };
  const lines = await loadLines(admin, tenantId, work.revision.id);
  const line = lines.find((l) => l.line_key === lineKey);
  if (!line) return { ok: false, status: 404, error: "Line not found" };
  const old = lineMemberships(have.packages).get(lineKey);

  const clearWhole = await admin.from("project_work_package_lines").delete().eq("tenant_id", tenantId).eq("project_id", ctx.project.id).eq("line_key", lineKey);
  if (clearWhole.error) return { ok: false, status: 500, error: clearWhole.error.message };
  const clearParts = await admin.from("project_work_package_line_parts").delete().eq("tenant_id", tenantId).eq("project_id", ctx.project.id).eq("line_key", lineKey);
  if (clearParts.error) return { ok: false, status: 500, error: clearParts.error.message };
  if (verdict.kind === "whole") {
    const linked = await insertLinks(admin, tenantId, ctx.project.id, verdict.wbs_item_id, [lineKey]);
    if (linked) return { ok: false, status: 409, error: linked };
  } else {
    const ins = await admin.from("project_work_package_line_parts").insert(verdict.parts.map((p, i) => ({ tenant_id: tenantId, project_id: ctx.project.id, package_id: p.wbs_item_id, line_key: lineKey, share_pct: p.share_pct, sort_order: i })));
    if (ins.error) {
      await restoreMembership(ctx, lineKey, old);
      return { ok: false, status: 500, error: ins.error.message };
    }
  }
  const problem = await respreadIfDraft(ctx, work);
  if (problem) return { ok: false, status: 500, error: problem };
  await touchProject(ctx);
  const at = (m: Membership | undefined) => (m ? partsOf(m).map((s) => `${codeFor(have.packages, s.wbs_item_id)} ${pctText(s.share_pct)} %`).join(" · ") : null);
  await logProject(ctx, verdict.kind === "whole"
    ? [{ field: `WBS unsplit ${label(line)}`, from: at(old), to: codeFor(have.packages, verdict.wbs_item_id) }]
    : [{ field: `WBS split ${label(line)}`, from: old && old.parts.length > 0 ? at(old) : null, to: verdict.parts.map((p) => `${codeFor(have.packages, p.wbs_item_id)} ${pctText(p.share_pct)} %`).join(" · ") }]);
  return { ok: true, kind: verdict.kind };
}

/** A failed split write puts the line back where it was. */
async function restoreMembership(ctx: AllocationCtx, lineKey: string, old: Membership | undefined) {
  if (!old) return;
  const { admin, tenantId } = ctx.req;
  if (old.wbs_item_id) await insertLinks(admin, tenantId, ctx.project.id, old.wbs_item_id, [lineKey]);
  if (old.parts.length > 0) await admin.from("project_work_package_line_parts").insert(old.parts.map((p, i) => ({ tenant_id: tenantId, project_id: ctx.project.id, package_id: p.wbs_item_id, line_key: lineKey, share_pct: p.share_pct, sort_order: i })));
}

/** Unsplit: the whole line goes to the named item, else to the item of its first share. */
export async function unsplitLine(ctx: AllocationCtx, work: WbsWork, lineKey: string, packageId?: string | null): Promise<Result<{ package_id: string }>> {
  const have = await loadPackages(ctx.req.admin, ctx.req.tenantId, ctx.project.id);
  if (have.pending) return { ok: false, ...needsAllocationUpdate() };
  const m = lineMemberships(have.packages).get(lineKey);
  if (!m || m.parts.length === 0) return { ok: false, status: 422, error: "That line is not split" };
  const target = packageId ?? m.parts[0].wbs_item_id;
  const done = await setLineSplit(ctx, work, lineKey, [{ package_id: target, share_pct: 100 }]);
  return done.ok ? { ok: true, package_id: target } : done;
}

/** Renumber: the auto-numbered codes are recomputed and a typed code is kept; with `all` every code is recomputed and the typed flag cleared. */
export async function renumberPackages(ctx: AllocationCtx, opts: { all?: boolean } = {}): Promise<Result<{ changed: number }>> {
  const have = await loadPackages(ctx.req.admin, ctx.req.tenantId, ctx.project.id);
  if (have.pending) return { ok: false, ...needsAllocationUpdate() };
  if (have.treePending) return { ok: false, ...pending() };
  const items = itemsOf(have.packages);
  if (!opts.all) {
    const keep = codeChanges(items);
    const err = await applyCodes(ctx, keep.map((c) => ({ id: c.id, to: c.to })));
    if (err) return { ok: false, status: 500, error: err };
    if (keep.length > 0) { await touchProject(ctx); await logProject(ctx, [{ field: "WBS renumbered", from: null, to: `${keep.length} code${keep.length === 1 ? "" : "s"}` }]); }
    return { ok: true, changed: keep.length };
  }
  const changes = renumberAll(items);
  const err = await applyCodes(ctx, changes.map((c) => ({ id: c.id, to: c.to, manual_cleared: c.manual_cleared })));
  if (err) return { ok: false, status: 500, error: err };
  const flagOnly = have.packages.filter((p) => p.code_is_manual && !changes.some((c) => c.id === p.id));
  for (const p of flagOnly) await ctx.req.admin.from("project_work_packages").update({ code_is_manual: false, updated_at: new Date().toISOString() }).eq("id", p.id).eq("tenant_id", ctx.req.tenantId).eq("project_id", ctx.project.id);
  if (changes.length + flagOnly.length > 0) { await touchProject(ctx); await logProject(ctx, [{ field: "WBS renumbered", from: null, to: `${changes.length} code${changes.length === 1 ? "" : "s"}` }]); }
  return { ok: true, changed: changes.length };
}
