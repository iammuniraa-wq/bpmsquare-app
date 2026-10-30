import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logChange } from "@/lib/changeLog";
import { getAuthUser } from "@/lib/supabase-server";
import { loadWinningBid } from "@/lib/tender/bids/costServer";
import { budgetTotals, round2, round4 } from "./budget";
import { PACKAGE_LIMITS, spreadPackageCost, type LineAllocation, type PackageAllocation, type WorkPackageInput } from "./allocation";
import { costsFromBoq, costsFromSnapshot, planFill, type BoqCostRow, type FillSkip, type Found } from "./fill";
import {
  allocationSchemaReady, currentRevision, isMissingSchema, loadLines, loadProject, loadRevision, loadRevisions, needsAllocationUpdate, needsUpdate, openProjectRequest,
  refreshRevisionTotal, UUID_RE, type Failure, type ProjectCtx,
} from "./server";
import { checkOwner, loadPackages } from "./workPackagesServer";
import type { AllocationBasis, BudgetLine, ProjectRow, RevisionRow, WorkPackageRow } from "./types";

import { readAllPages } from "@/lib/pagedRead";
// The writes of the budget allocation and the work breakdown (migration 0240). Every route opens with openAllocation (the contract-projects
// gate, then a project of THIS workspace), every write needs the project's current DRAFT revision (an approved or waiting budget is locked),
// every id from a request is verified against the workspace and the project, and every query carries the tenant. A missing table or column
// reads as "needs a database update", never as a crash.

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

/** Lays every package's cost over its lines (package mode); a line in no package, or in one with no cost yet, is not allocated. */
async function respreadAll(ctx: AllocationCtx, revision: RevisionRow, packages: readonly WorkPackageRow[]): Promise<string | null> {
  const { admin, tenantId } = ctx.req;
  const lines = await loadLines(admin, tenantId, revision.id);
  const byKey = new Map(lines.map((l) => [l.line_key, l]));
  const targets = new Map<string, LineTarget>();
  for (const l of lines) targets.set(l.line_key, none);
  for (const p of packages) {
    if (p.allocated_cost === null) continue;
    const held = p.line_keys.map((k) => byKey.get(k)).filter((l): l is BudgetLine => !!l);
    for (const sp of spreadPackageCost(p.allocated_cost, held.map((l) => ({ line_key: l.line_key, client_amount: l.client_amount, qty: l.qty })))) {
      const l = byKey.get(sp.line_key) as BudgetLine;
      targets.set(sp.line_key, { amount: sp.amount, unit_cost: sp.unit_cost, allocated: true, source_ref: l.source_ref });
    }
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
  if (ctx.project.allocation_basis !== "line") return { ok: false, status: 409, error: "This project is allocated by work package" };
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

/** Package mode: a cost typed on each work package, spread over its lines. */
export async function putPackageAllocation(ctx: AllocationCtx, revision: RevisionRow, rows: readonly PackageAllocation[]): Promise<Result<{ total: number }>> {
  const { admin, tenantId } = ctx.req;
  if (ctx.project.allocation_basis !== "package") return { ok: false, status: 409, error: "This project is allocated by BOQ line" };
  const have = await loadPackages(admin, tenantId, ctx.project.id);
  if (have.pending) return { ok: false, ...needsAllocationUpdate() };
  const mine = new Set(have.packages.map((p) => p.id));
  if (rows.some((r) => !mine.has(r.id))) return { ok: false, status: 404, error: "Work package not found" };
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

/** Switching clears what was typed (the package grouping is kept) and is only allowed before a baseline is approved or waiting. */
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
  await logProject(ctx, [{ field: "Allocate by", from: ctx.project.allocation_basis === "package" ? "Work package" : "BOQ line", to: basis === "package" ? "Work package" : "BOQ line" }, ...(before !== total ? [{ field: "Allocated", from: before, to: total }] : [])]);
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
    for (const p of have.packages) {
      const held = p.line_keys.map((k) => byKey.get(k)).filter((l): l is BudgetLine => !!l);
      const priced = held.filter((l) => cost.has(l.line_key));
      for (const l of held) if (!cost.has(l.line_key)) skipped.push({ item: l.wbs ?? l.description, reason: (found.get(l.line_key) as { skip: string } | undefined)?.skip ?? "no recorded cost on the tender" });
      if (priced.length === 0) continue;
      if (p.allocated_cost !== null && !replace) { skipped.push({ item: p.code, reason: "already allocated" }); continue; }
      const sum = round2(priced.reduce((s, l) => s + (cost.get(l.line_key) as number), 0));
      const { error } = await admin.from("project_work_packages").update({ allocated_cost: sum, updated_at: new Date().toISOString() }).eq("id", p.id).eq("tenant_id", tenantId).eq("project_id", ctx.project.id);
      if (error) return { ok: false, status: 500, error: error.message };
      filled += priced.length;
    }
    const problem = await respreadAll(ctx, revision, (await loadPackages(admin, tenantId, ctx.project.id)).packages);
    if (problem) return { ok: false, status: 500, error: problem };
    for (const l of lines) if (!have.packages.some((p) => p.line_keys.includes(l.line_key))) skipped.push({ item: l.wbs ?? l.description, reason: "not in a work package" });
  }
  const total = await finish(ctx, revision, before, "Fill from tender costs");
  return { ok: true, filled, skipped: skipped.slice(0, 200), total };
}

// ── Work packages ───────────────────────────────────────────────────────────────────────────────────────────────────

async function owned(ctx: AllocationCtx, ownerId: string | null | undefined): Promise<Failure | null> {
  if (!ownerId) return null;
  const ok = await checkOwner(ctx.req.admin, ctx.req.tenantId, ownerId);
  if (ok.ok) return null;
  return { status: ok.status, error: ok.error, ...(ok.needs_login ? { extra: { needs_login: true, employee_id: ownerId } } : {}) };
}

/** A line_key already in ANOTHER package of the project, as the plain message the screen shows. */
function takenBy(lines: readonly BudgetLine[], packages: readonly WorkPackageRow[], keys: readonly string[], selfId?: string): string | null {
  for (const k of keys) {
    const other = packages.find((p) => p.id !== selfId && p.line_keys.includes(k));
    if (other) { const l = lines.find((x) => x.line_key === k); return `${l?.wbs ?? l?.description ?? "A line"} is already in ${other.code}`; }
  }
  return null;
}

async function insertLinks(admin: SupabaseClient, tenantId: string, projectId: string, packageId: string, keys: readonly string[]): Promise<string | null> {
  if (keys.length === 0) return null;
  const { error } = await admin.from("project_work_package_lines").insert(keys.map((k, i) => ({ tenant_id: tenantId, project_id: projectId, package_id: packageId, line_key: k, sort_order: i })));
  if (!error) return null;
  return error.code === "23505" ? "A line is already in another work package" : error.message;
}

export async function createPackage(ctx: AllocationCtx, revision: RevisionRow, input: Partial<WorkPackageInput> & { code: string; name: string }): Promise<Result<{ id: string }>> {
  const { admin, tenantId } = ctx.req;
  const have = await loadPackages(admin, tenantId, ctx.project.id);
  if (have.pending) return { ok: false, ...needsAllocationUpdate() };
  if (have.packages.length >= PACKAGE_LIMITS.maxPerProject) return { ok: false, status: 409, error: `A project holds up to ${PACKAGE_LIMITS.maxPerProject} work packages` };
  const lines = await loadLines(admin, tenantId, revision.id);
  const keys = input.line_keys ?? [];
  const clash = takenBy(lines, have.packages, keys);
  if (clash) return { ok: false, status: 409, error: clash };
  const bad = await owned(ctx, input.owner_employee_id);
  if (bad) return { ok: false, ...bad };
  const sort = have.packages.reduce((m, p) => Math.max(m, p.sort_order), 0) + 10;
  const made = await admin.from("project_work_packages").insert({
    tenant_id: tenantId, project_id: ctx.project.id, code: input.code, name: input.name, owner_employee_id: input.owner_employee_id ?? null, note: input.note ?? null, sort_order: sort, created_by: ctx.req.userId,
  }).select("id").single();
  if (made.error || !made.data) {
    if (made.error?.code === "23505") return { ok: false, status: 409, error: `The code ${input.code} is already used on this project` };
    if (isMissingSchema(made.error)) return { ok: false, ...needsAllocationUpdate() };
    return { ok: false, status: 500, error: made.error?.message ?? "Could not save the work package" };
  }
  const id = (made.data as { id: string }).id;
  const linked = await insertLinks(admin, tenantId, ctx.project.id, id, keys);
  if (linked) {
    await admin.from("project_work_packages").delete().eq("id", id).eq("tenant_id", tenantId);
    return { ok: false, status: 409, error: linked };
  }
  if (ctx.project.allocation_basis === "package") await respreadAll(ctx, revision, (await loadPackages(admin, tenantId, ctx.project.id)).packages);
  await touchProject(ctx);
  await logProject(ctx, [{ field: `Work package ${input.code} added`, from: null, to: `${input.name}, ${keys.length} line${keys.length === 1 ? "" : "s"}` }]);
  return { ok: true, id };
}

export async function updatePackage(ctx: AllocationCtx, revision: RevisionRow, current: WorkPackageRow, input: Partial<WorkPackageInput>): Promise<Result<object>> {
  const { admin, tenantId } = ctx.req;
  const have = await loadPackages(admin, tenantId, ctx.project.id);
  const lines = await loadLines(admin, tenantId, revision.id);
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  if (input.line_keys) {
    const clash = takenBy(lines, have.packages, input.line_keys, current.id);
    if (clash) return { ok: false, status: 409, error: clash };
  }
  if ("owner_employee_id" in input && input.owner_employee_id && input.owner_employee_id !== current.owner_employee_id) {
    const bad = await owned(ctx, input.owner_employee_id);
    if (bad) return { ok: false, ...bad };
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ["code", "name", "owner_employee_id", "note"] as const) {
    if (k in input && JSON.stringify(input[k] ?? null) !== JSON.stringify(current[k] ?? null)) { patch[k] = input[k] ?? null; changes.push({ field: `Work package ${current.code} ${k.replace("_employee_id", "").replace("_", " ")}`, from: current[k] ?? null, to: input[k] ?? null }); }
  }
  const { error } = await admin.from("project_work_packages").update(patch).eq("id", current.id).eq("tenant_id", tenantId).eq("project_id", ctx.project.id);
  if (error) return error.code === "23505" ? { ok: false, status: 409, error: `The code ${input.code} is already used on this project` } : { ok: false, status: 500, error: error.message };

  if (input.line_keys && JSON.stringify([...input.line_keys].sort()) !== JSON.stringify([...current.line_keys].sort())) {
    const gone = await admin.from("project_work_package_lines").delete().eq("package_id", current.id).eq("tenant_id", tenantId).eq("project_id", ctx.project.id);
    if (gone.error) return { ok: false, status: 500, error: gone.error.message };
    const linked = await insertLinks(admin, tenantId, ctx.project.id, current.id, input.line_keys);
    if (linked) {
      await insertLinks(admin, tenantId, ctx.project.id, current.id, current.line_keys);
      return { ok: false, status: 409, error: linked };
    }
    changes.push({ field: `Work package ${current.code} lines`, from: current.line_keys.length, to: input.line_keys.length });
    if (ctx.project.allocation_basis === "package") {
      const problem = await respreadAll(ctx, revision, (await loadPackages(admin, tenantId, ctx.project.id)).packages);
      if (problem) return { ok: false, status: 500, error: problem };
      await refreshRevisionTotal(admin, tenantId, revision.id);
    }
  }
  await touchProject(ctx);
  if (changes.length > 0) await logProject(ctx, changes);
  return { ok: true };
}

export async function deletePackage(ctx: AllocationCtx, revision: RevisionRow, current: WorkPackageRow): Promise<Result<object>> {
  const { admin, tenantId } = ctx.req;
  await admin.from("project_work_package_lines").delete().eq("package_id", current.id).eq("tenant_id", tenantId).eq("project_id", ctx.project.id);
  const gone = await admin.from("project_work_packages").delete().eq("id", current.id).eq("tenant_id", tenantId).eq("project_id", ctx.project.id);
  if (gone.error) return { ok: false, status: 500, error: gone.error.message };
  if (ctx.project.allocation_basis === "package") {
    // Its cost leaves with it: the lines it held go back to not allocated.
    const problem = await respreadAll(ctx, revision, (await loadPackages(admin, tenantId, ctx.project.id)).packages);
    if (problem) return { ok: false, status: 500, error: problem };
    await refreshRevisionTotal(admin, tenantId, revision.id);
  }
  await touchProject(ctx);
  await logProject(ctx, [{ field: `Work package ${current.code} removed`, from: current.name, to: null }]);
  return { ok: true };
}
