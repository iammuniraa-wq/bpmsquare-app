import "server-only";
import { logChange } from "@/lib/changeLog";
import { getAuthUser } from "@/lib/supabase-server";
import { isCategoryLine, type BudgetLine, type RevisionRow, type WorkPackageRow } from "@/lib/contractProjects/types";
import { lineMemberships } from "@/lib/contractProjects/allocation";
import {
  createPackage, deletePackage, draftRevision, updatePackage, workingRevision, type AllocationCtx,
} from "@/lib/contractProjects/allocationServer";
import { currentRevision, isMissingSchema, loadLines, loadRevisions, refreshRevisionTotal } from "@/lib/contractProjects/server";
import { loadPackages } from "@/lib/contractProjects/workPackagesServer";
import { buildingCodeProblem, buildingOfLine, type BuildingItem } from "./buildings";
import { editProblem, parseElementEdit, type ElementEdit } from "./edit";
import { cleanBuildingCode, planIssue, planReissue, validatePattern, type IssuePlan } from "./pattern";
import { clientQtyOf, repriceForQty } from "./quantity";
import { buildPayload, linesUnder, type BuildingsPayload, type NeutralLine } from "./rows";
import { chunks, fail, isMissingElementSchema, loadElementSettings, loadElementTypes, type ElementTypeChoice, type Failure, type Result } from "./server";
import { COMMON_BUILDING, ELEMENTS_BUNDLE, ELEMENTS_PENDING, type ElementsSettings } from "./types";

// Buildings and element codes on a CONTRACT PROJECT (docs/design/pcbs-buildings-elements.md). A building is a level-1 WBS item that carries a
// code (project_work_packages.building_code); an element is a budget line that carries a type and a code (project_budget_lines, 0253). Every
// query is tenant-scoped on the service-role client and every write names the project, the revision and the workspace. Element fields are
// written ONLY from here (the budget grid carries them, never edits them) and only on a DRAFT revision: an approved budget is read-only, and a
// change to it is a revision with a reason. While 0253 is pending the screens say so and nothing else changes.

const pendingFailure = (): Failure => ({ status: 503, error: ELEMENTS_PENDING, extra: { needsDatabaseUpdate: true, bundle: ELEMENTS_BUNDLE } });
const labelOf = (ctx: AllocationCtx) => `${ctx.project.ref ?? ""} ${ctx.project.name}`.trim();

async function log(ctx: AllocationCtx, changes: { field: string; from: unknown; to: unknown }[]) {
  if (changes.length === 0) return;
  const user = await getAuthUser();
  await logChange(ctx.req.supabase, { tenantId: ctx.req.tenantId, objectType: "contract_projects", objectId: ctx.project.id, objectLabel: labelOf(ctx), action: "update", actorId: user?.id, actorEmail: user?.email, changes });
}

const asItems = (packages: readonly WorkPackageRow[]): BuildingItem[] => packages.map((p) => ({
  id: p.id, code: p.code, name: p.name, parent_id: p.parent_id ?? null, sort_order: p.sort_order, code_is_manual: p.code_is_manual === true,
  owner_employee_id: p.owner_employee_id, building_code: p.building_code ?? null,
}));

const neutral = (lines: readonly BudgetLine[], memberships: ReturnType<typeof lineMemberships>): NeutralLine[] => lines.map((l) => {
  const m = memberships.get(l.line_key) ?? { wbs_item_id: null, parts: [] };
  return {
    key: l.line_key, line_no: l.line_no, ref: l.wbs, description: l.description, unit: l.unit, qty: l.qty,
    client_qty: l.client_qty ?? null, model_qty: l.model_qty ?? null, client_rate: l.client_rate, client_amount: l.client_amount ?? 0,
    cost: l.allocated ? l.amount : null, element_type: l.element_type ?? null, element_code: l.element_code ?? null,
    is_category: isCategoryLine(l), wbs_item_id: m.wbs_item_id, parts: m.parts,
  };
});

async function elementColumnsReady(ctx: AllocationCtx): Promise<boolean> {
  const { error } = await ctx.req.admin.from("project_budget_lines").select("element_code").eq("tenant_id", ctx.req.tenantId).limit(1);
  return !isMissingElementSchema(error);
}

export type ProjectBuildingsData = BuildingsPayload & {
  enabled: true;
  scope: "project";
  /** 0253 is not applied: the Buildings view and the element fields are not there yet. */
  pending: boolean;
  settings: Pick<ElementsSettings, "pattern" | "code_max" | "qty_tolerance_pct" | "level_names">;
  /** The pattern this project issues in: its own frozen one once a code has been issued, else the workspace's. */
  pattern: string;
  pattern_frozen: boolean;
  types: ElementTypeChoice[];
  revision: { id: string; rev_no: number; status: RevisionRow["status"] } | null;
  /** Why nothing can be changed right now, in words; null when the budget is a draft of an open project. */
  lock: string | null;
  /** The structure (buildings: add, rename, remove) can change: it can on any revision of an open project, unlike an element, which needs a draft. */
  structure_open: boolean;
  /** Reissuing codes after a building code change is allowed only before a baseline is approved and before anything reaches the ERP. */
  can_reissue: boolean;
  allocation_basis: "line" | "package";
  currency: string | null;
};

const LOCK_WORDS = (project: AllocationCtx["project"], revision: RevisionRow | null): string | null => {
  if (project.status === "closed") return "This project is closed";
  if (!revision) return "There is no budget yet";
  if (revision.status === "pending") return "This budget is waiting for approval and cannot be changed";
  if (revision.status !== "draft") return "An approved budget is locked. Start a revision to change an element, with a reason.";
  return null;
};

export async function projectBuildings(ctx: AllocationCtx): Promise<Result<{ data: ProjectBuildingsData }>> {
  const { admin, tenantId } = ctx.req;
  const have = await loadPackages(admin, tenantId, ctx.project.id);
  if (have.pending) return fail(503, "The WBS needs a database update (migration 0240)");
  const settings = await loadElementSettings();
  const revisions = await loadRevisions(admin, tenantId, ctx.project.id);
  const revision = currentRevision(revisions.rows);
  const lines = revision ? await loadLines(admin, tenantId, revision.id) : [];
  const pending = have.treePending === true || have.buildingsPending === true || !(await elementColumnsReady(ctx));
  const items = asItems(have.packages);
  const frozen = ctx.project.element_pattern ?? null;
  const pattern = frozen ?? settings.pattern;
  const payload = buildPayload(items, neutral(lines, lineMemberships(have.packages)), { pattern, qty_tolerance_pct: settings.qty_tolerance_pct }, ctx.project.ref);
  const baseline = revisions.rows.some((r) => r.status === "approved" || r.status === "superseded");
  const types = pending ? [] : await loadElementTypes(admin, tenantId);
  return {
    ok: true,
    data: {
      ...payload, enabled: true, scope: "project", pending,
      settings: { pattern: settings.pattern, code_max: settings.code_max, qty_tolerance_pct: settings.qty_tolerance_pct, level_names: settings.level_names },
      pattern, pattern_frozen: !!frozen, types,
      revision: revision ? { id: revision.id, rev_no: revision.rev_no, status: revision.status } : null,
      lock: LOCK_WORDS(ctx.project, revision), structure_open: ctx.project.status !== "closed",
      can_reissue: !baseline && revision?.status === "draft" && !ctx.project.handover_sent_at && !ctx.project.erp_id,
      allocation_basis: ctx.project.allocation_basis, currency: ctx.project.currency,
    },
  };
}

// ── Buildings ───────────────────────────────────────────────────────────────────────────────────────────────────────

export async function addBuilding(ctx: AllocationCtx, input: { name?: unknown; code?: unknown; common?: unknown }): Promise<Result<{ id: string; code: string }>> {
  const { admin, tenantId } = ctx.req;
  const common = input.common === true;
  const name = common ? COMMON_BUILDING.name : typeof input.name === "string" ? input.name.trim().slice(0, 200) : "";
  const code = common ? COMMON_BUILDING.code : cleanBuildingCode(input.code);
  if (!name) return fail(422, "Give the building a name");
  if (!code) return fail(422, "A building code is 1 to 6 letters or digits");
  const have = await loadPackages(admin, tenantId, ctx.project.id);
  if (have.pending) return fail(503, "The WBS needs a database update (migration 0240)");
  if (have.treePending || have.buildingsPending) return { ok: false, ...pendingFailure() };
  const problem = buildingCodeProblem(asItems(have.packages), null, null, code);
  if (problem) return fail(409, problem);
  const work = await workingRevision(ctx);
  if (!work.ok) return work;
  const made = await createPackage(ctx, work.work, { name });
  if (!made.ok) return made;
  const { error } = await admin.from("project_work_packages").update({ building_code: code, updated_at: new Date().toISOString() }).eq("id", made.id).eq("tenant_id", tenantId).eq("project_id", ctx.project.id);
  if (error) {
    await admin.from("project_work_packages").delete().eq("id", made.id).eq("tenant_id", tenantId).eq("project_id", ctx.project.id);
    if (error.code === "23505") return fail(409, `${code} is already a building here`);
    return isMissingElementSchema(error) ? { ok: false, ...pendingFailure() } : fail(500, error.message);
  }
  await log(ctx, [{ field: `Building ${code} added`, from: null, to: name }]);
  return { ok: true, id: made.id, code };
}

/** The codes issued under a building (the lines it holds that carry an element code), for the rename rule. */
function codesUnder(items: readonly BuildingItem[], lines: readonly NeutralLine[], itemId: string): NeutralLine[] {
  return lines.filter((l) => !l.removed && !!l.element_code && buildingOfLine(items, l).kind === "one" && (buildingOfLine(items, l) as { item_id: string }).item_id === itemId);
}

export type ReissuePreview = { rows: { key: string; from: string; to: string }[]; clashes: string[] };

/**
 * Renames a building or changes its code. The name changes nothing issued. A code change is refused while element codes were issued under
 * the building ("B01 is used by 14 codes"); the one exception is `reissue`, allowed only before a baseline is approved and before anything
 * reaches the ERP, which previews old to new (`preview`) or applies as one logged change.
 */
export async function updateBuilding(ctx: AllocationCtx, itemId: string, input: { name?: unknown; code?: unknown; reissue?: unknown; preview?: unknown }): Promise<Result<{ code: string | null; reissued: number; preview?: ReissuePreview }>> {
  const { admin, tenantId } = ctx.req;
  const have = await loadPackages(admin, tenantId, ctx.project.id);
  if (have.pending) return fail(503, "The WBS needs a database update (migration 0240)");
  if (have.treePending || have.buildingsPending) return { ok: false, ...pendingFailure() };
  const current = have.packages.find((p) => p.id === itemId);
  if (!current) return fail(404, "Building not found");
  const items = asItems(have.packages);
  const work = await workingRevision(ctx);
  if (!work.ok) return work;

  if (typeof input.name === "string" && input.name.trim() && input.name.trim() !== current.name) {
    const renamed = await updatePackage(ctx, work.work, current, { name: input.name.trim().slice(0, 200) });
    if (!renamed.ok) return renamed;
  }
  let reissued = 0;
  if ("code" in input && input.code !== undefined && input.code !== null) {
    const code = cleanBuildingCode(input.code);
    if (!code) return fail(422, "A building code is 1 to 6 letters or digits");
    if (code !== (current.building_code ?? null)) {
      const problem = buildingCodeProblem(items, itemId, current.parent_id ?? null, code);
      if (problem) return fail(problem.includes("already") ? 409 : 422, problem);
      const lines = neutral(await loadLines(admin, tenantId, work.work.revision.id), lineMemberships(have.packages));
      const issued = current.building_code ? codesUnder(items, lines, itemId) : [];
      const frozenPattern = ctx.project.element_pattern ?? (await loadElementSettings()).pattern;
      if (issued.length > 0) {
        if (input.reissue !== true) return fail(409, `${current.building_code} is used by ${issued.length} code${issued.length === 1 ? "" : "s"}. Reissue them or leave the code as it is`, { used_by: issued.length });
        const revisions = await loadRevisions(admin, tenantId, ctx.project.id);
        if (revisions.rows.some((r) => r.status === "approved" || r.status === "superseded") || ctx.project.handover_sent_at || ctx.project.erp_id) {
          return fail(409, "The codes are final once the baseline is approved or the ERP has them. A wrong code is fixed by a revision line change with a reason", { locked: true });
        }
        if (work.work.revision.status !== "draft") return fail(409, "This budget is waiting for approval and cannot be changed", { locked: true });
        const parsed = validatePattern(frozenPattern, (await loadElementSettings()).code_max, (ctx.project.ref ?? "").length);
        if (!parsed.ok) return fail(422, parsed.error);
        const plan = planReissue({
          parts: parsed.parts, project: ctx.project.ref,
          lines: issued.map((l) => ({ key: l.key, element_code: l.element_code, building_code: current.building_code ?? null, element_type: l.element_type })),
          change: { building: { from: current.building_code as string, to: code } },
        });
        if (plan.clashes.length > 0) return fail(409, `${plan.clashes.slice(0, 3).join(", ")} would clash with a code that already exists`, { clashes: plan.clashes });
        if (input.preview === true) return { ok: true, code: current.building_code ?? null, reissued: 0, preview: { rows: plan.rows, clashes: [] } };
        const byKey = new Map((await loadLines(admin, tenantId, work.work.revision.id)).map((l) => [l.line_key, l]));
        const done: { id: string; from: string }[] = [];
        for (const r of plan.rows) {
          const line = byKey.get(r.key);
          if (!line) continue;
          const { error } = await admin.from("project_budget_lines").update({ element_code: r.to }).eq("id", line.id).eq("tenant_id", tenantId).eq("revision_id", work.work.revision.id);
          if (error) {
            for (const d of done) await admin.from("project_budget_lines").update({ element_code: d.from }).eq("id", d.id).eq("tenant_id", tenantId).eq("revision_id", work.work.revision.id);
            return fail(error.code === "23505" ? 409 : 500, error.code === "23505" ? `${r.to} already exists` : error.message);
          }
          done.push({ id: line.id, from: r.from });
        }
        reissued = done.length;
        await log(ctx, [
          { field: `Building ${current.building_code} reissued as ${code}`, from: `${plan.rows.length} codes`, to: `${plan.rows[0]?.from ?? ""} to ${plan.rows[0]?.to ?? ""}` },
          ...plan.rows.slice(0, 40).map((r) => ({ field: "Element code", from: r.from, to: r.to })),
        ]);
      } else if (input.preview === true) return { ok: true, code: current.building_code ?? null, reissued: 0, preview: { rows: [], clashes: [] } };
      const { error } = await admin.from("project_work_packages").update({ building_code: code, updated_at: new Date().toISOString() }).eq("id", itemId).eq("tenant_id", tenantId).eq("project_id", ctx.project.id);
      if (error) return error.code === "23505" ? fail(409, `${code} is already a building here`) : isMissingElementSchema(error) ? { ok: false, ...pendingFailure() } : fail(500, error.message);
      await log(ctx, [{ field: `Building ${current.building_code ?? current.code} code`, from: current.building_code ?? null, to: code }]);
    }
  }
  return { ok: true, code: input.code ? cleanBuildingCode(input.code) : current.building_code ?? null, reissued };
}

/** Removes a building. Never while it holds lines (it moves nothing and says how many): a building with none can go. */
export async function removeBuilding(ctx: AllocationCtx, itemId: string): Promise<Result<{ removed: true }>> {
  const { admin, tenantId } = ctx.req;
  const have = await loadPackages(admin, tenantId, ctx.project.id);
  if (have.pending) return fail(503, "The WBS needs a database update (migration 0240)");
  const current = have.packages.find((p) => p.id === itemId);
  if (!current || !current.building_code) return fail(404, "Building not found");
  const work = await workingRevision(ctx);
  if (!work.ok) return work;
  const lines = neutral(await loadLines(admin, tenantId, work.work.revision.id), lineMemberships(have.packages));
  const held = linesUnder(asItems(have.packages), lines, itemId);
  if (held > 0) return fail(409, `${current.building_code} holds ${held} line${held === 1 ? "" : "s"}. Move them out first`, { lines: held });
  const gone = await deletePackage(ctx, work.work, current);
  if (!gone.ok) return gone;
  await log(ctx, [{ field: `Building ${current.building_code} removed`, from: current.name, to: null }]);
  return { ok: true, removed: true };
}

// ── Elements ────────────────────────────────────────────────────────────────────────────────────────────────────────

type Loaded = {
  items: BuildingItem[];
  lines: BudgetLine[];
  neutral: NeutralLine[];
  memberships: ReturnType<typeof lineMemberships>;
};

async function loadForEdit(ctx: AllocationCtx, revision: RevisionRow): Promise<Result<Loaded>> {
  const have = await loadPackages(ctx.req.admin, ctx.req.tenantId, ctx.project.id);
  if (have.pending) return fail(503, "The WBS needs a database update (migration 0240)");
  if (have.treePending || have.buildingsPending || !(await elementColumnsReady(ctx))) return { ok: false, ...pendingFailure() };
  const lines = await loadLines(ctx.req.admin, ctx.req.tenantId, revision.id);
  const memberships = lineMemberships(have.packages);
  return { ok: true, items: asItems(have.packages), lines, neutral: neutral(lines, memberships), memberships };
}

const codeTaken = (lines: readonly BudgetLine[], code: string, exceptKey?: string) => lines.some((l) => l.element_code === code && l.line_key !== exceptKey);

/** One line's type, code, model quantity, "use the model" / "use the client's". Draft revisions only. */
export async function setLineElement(ctx: AllocationCtx, lineKey: string, body: unknown): Promise<Result<{ line_key: string }>> {
  const { admin, tenantId } = ctx.req;
  const draft = await draftRevision(ctx);
  if (!draft.ok) return draft;
  const revision = draft.revision;
  const loaded = await loadForEdit(ctx, revision);
  if (!loaded.ok) return loaded;
  const line = loaded.lines.find((l) => l.line_key === lineKey);
  if (!line) return fail(404, "Line not found");
  const settings = await loadElementSettings();
  const types = new Set((await loadElementTypes(admin, tenantId)).map((t) => t.code));
  const parsed = parseElementEdit(body, { codeMax: settings.code_max, types, keep: line.element_type ?? null });
  if (!parsed.ok) return fail(422, parsed.error);
  const edit: ElementEdit = parsed.edit;
  const nl = loaded.neutral.find((l) => l.key === lineKey) as NeutralLine;
  const where = buildingOfLine(loaded.items, nl);
  const problem = editProblem({ element_type: line.element_type ?? null, element_code: line.element_code ?? null, model_qty: line.model_qty ?? null, is_category: isCategoryLine(line), mixed: where.kind === "mixed", building_code: where.kind === "one" ? where.code : null }, edit);
  if (problem) return fail(422, problem);
  if (edit.element_code && codeTaken(loaded.lines, edit.element_code, lineKey)) return fail(409, `${edit.element_code} is already used on this project`);

  const patch: Record<string, unknown> = {};
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  const name = line.element_code ?? line.wbs ?? `line ${line.line_no}`;
  if ("element_type" in edit && (edit.element_type ?? null) !== (line.element_type ?? null)) { patch.element_type = edit.element_type ?? null; changes.push({ field: `Element type of ${name}`, from: line.element_type ?? null, to: edit.element_type ?? null }); }
  if ("element_code" in edit && (edit.element_code ?? null) !== (line.element_code ?? null)) { patch.element_code = edit.element_code ?? null; changes.push({ field: `Element code of line ${line.line_no}`, from: line.element_code ?? null, to: edit.element_code ?? null }); }
  let model = line.model_qty ?? null;
  if ("model_qty" in edit && (edit.model_qty ?? null) !== model) { model = edit.model_qty ?? null; patch.model_qty = model; changes.push({ field: `Model quantity of ${name}`, from: line.model_qty ?? null, to: model }); }
  if (edit.accept_model || edit.use_client) {
    const target = edit.accept_model ? model : clientQtyOf({ client_qty: line.client_qty ?? null, qty: line.qty, client_rate: line.client_rate });
    if (target === null) return fail(422, edit.accept_model ? "There is no model quantity to accept yet" : "This line has no client quantity");
    const re = repriceForQty({ qty: line.qty, unit_cost: line.unit_cost, amount: line.amount, allocated: line.allocated }, target, ctx.project.allocation_basis);
    if (re.qty !== line.qty) {
      Object.assign(patch, { qty: re.qty, amount: re.amount, unit_cost: re.unit_cost });
      changes.push({ field: `Budget quantity of ${name} (${edit.accept_model ? "model" : "client"} quantity)`, from: line.qty, to: re.qty });
    }
  }
  if (Object.keys(patch).length === 0) return { ok: true, line_key: lineKey };
  const { error } = await admin.from("project_budget_lines").update(patch).eq("id", line.id).eq("tenant_id", tenantId).eq("revision_id", revision.id).eq("project_id", ctx.project.id);
  if (error) {
    if (error.code === "23505") return fail(409, `${edit.element_code ?? "That code"} is already used on this project`);
    return isMissingSchema(error) ? { ok: false, ...pendingFailure() } : fail(500, error.message);
  }
  if ("qty" in patch) await refreshRevisionTotal(admin, tenantId, revision.id);
  await admin.from("contract_projects").update({ updated_at: new Date().toISOString() }).eq("id", ctx.project.id).eq("tenant_id", tenantId);
  await log(ctx, changes);
  return { ok: true, line_key: lineKey };
}

export type IssueResult = { plan: IssuePlan; written: number; pattern: string };

/**
 * "Issue codes": every line (or the ticked ones) that has a building and a type and no code gets its next code. Idempotent; `preview` writes
 * nothing. The project freezes its pattern when its first code is issued.
 */
export async function issueCodes(ctx: AllocationCtx, input: { keys?: unknown; preview?: unknown }): Promise<Result<IssueResult>> {
  const { admin, tenantId } = ctx.req;
  const draft = await draftRevision(ctx);
  if (!draft.ok) return draft;
  const revision = draft.revision;
  const loaded = await loadForEdit(ctx, revision);
  if (!loaded.ok) return loaded;
  const settings = await loadElementSettings();
  const pattern = ctx.project.element_pattern ?? settings.pattern;
  const check = validatePattern(pattern, settings.code_max, (ctx.project.ref ?? "").length);
  if (!check.ok) return fail(422, check.error);
  const wanted = Array.isArray(input.keys) ? new Set(input.keys.filter((k): k is string => typeof k === "string")) : null;
  const rows = loaded.neutral.filter((l) => !wanted || wanted.has(l.key));
  const plan = planIssue({
    parts: check.parts, codeMax: settings.code_max, project: ctx.project.ref, existing: loaded.lines.map((l) => l.element_code).filter((c): c is string => !!c),
    lines: rows.map((l) => {
      const where = buildingOfLine(loaded.items, l);
      return { key: l.key, line_no: l.line_no, building_code: where.kind === "one" ? where.code : null, element_type: l.element_type, element_code: l.element_code, is_category: l.is_category };
    }),
  });
  if (input.preview === true || plan.assignments.length === 0) return { ok: true, plan, written: 0, pattern };

  const byKey = new Map(loaded.lines.map((l) => [l.line_key, l]));
  let written = 0;
  for (const batch of chunks(plan.assignments, 25)) {
    const results = await Promise.all(batch.map((a) => {
      const line = byKey.get(a.key) as BudgetLine;
      return admin.from("project_budget_lines").update({ element_code: a.code }).eq("id", line.id).eq("tenant_id", tenantId).eq("revision_id", revision.id).eq("project_id", ctx.project.id).is("element_code", null);
    }));
    const bad = results.find((r) => r.error);
    written += results.filter((r) => !r.error).length;
    if (bad?.error) {
      if (written > 0) await log(ctx, [{ field: "Element codes issued", from: null, to: `${written} codes (stopped: another change took a code)` }]);
      return bad.error.code === "23505" ? fail(409, "Another change took one of those codes. Nothing more was issued. Try again") : isMissingSchema(bad.error) ? { ok: false, ...pendingFailure() } : fail(500, bad.error.message);
    }
  }
  if (!ctx.project.element_pattern) await admin.from("contract_projects").update({ element_pattern: pattern }).eq("id", ctx.project.id).eq("tenant_id", tenantId);
  await admin.from("contract_projects").update({ updated_at: new Date().toISOString() }).eq("id", ctx.project.id).eq("tenant_id", tenantId);
  await log(ctx, [{ field: "Element codes issued", from: null, to: plan.summary.join("; ") }]);
  return { ok: true, plan, written, pattern };
}


/**
 * Gives a level-1 item a building code, or clears it (null). The writer the Data Workbench uses for the Building code column of project WBS items: the
 * same checks as the screen's Add and Edit, and a refusal while a building holds lines.
 */
export async function setBuildingCode(ctx: AllocationCtx, itemId: string, code: string | null): Promise<Result<{ code: string | null }>> {
  if (code !== null) {
    const out = await updateBuilding(ctx, itemId, { code });
    return out.ok ? { ok: true, code: out.code } : out;
  }
  const { admin, tenantId } = ctx.req;
  const have = await loadPackages(admin, tenantId, ctx.project.id);
  if (have.pending) return fail(503, "The WBS needs a database update (migration 0240)");
  if (have.treePending || have.buildingsPending) return { ok: false, ...pendingFailure() };
  const current = have.packages.find((p) => p.id === itemId);
  if (!current) return fail(404, "WBS item not found");
  if (!current.building_code) return { ok: true, code: null };
  const work = await workingRevision(ctx);
  if (!work.ok) return work;
  const lines = neutral(await loadLines(admin, tenantId, work.work.revision.id), lineMemberships(have.packages));
  const held = linesUnder(asItems(have.packages), lines, itemId);
  if (held > 0) return fail(409, `${current.building_code} holds ${held} line${held === 1 ? "" : "s"}, so it stays a building`);
  const { error } = await admin.from("project_work_packages").update({ building_code: null, updated_at: new Date().toISOString() }).eq("id", itemId).eq("tenant_id", tenantId).eq("project_id", ctx.project.id);
  if (error) return fail(500, error.message);
  await log(ctx, [{ field: `Building ${current.building_code} is now an ordinary WBS item`, from: current.building_code, to: null }]);
  return { ok: true, code: null };
}
