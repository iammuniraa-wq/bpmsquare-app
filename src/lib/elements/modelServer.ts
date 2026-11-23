import "server-only";
import { randomUUID } from "node:crypto";
import { readAllPages } from "@/lib/pagedRead";
import { logChange } from "@/lib/changeLog";
import { getAuthUser } from "@/lib/supabase-server";
import { lineMemberships } from "@/lib/contractProjects/allocation";
import { type AllocationCtx } from "@/lib/contractProjects/allocationServer";
import { startDraftRevision } from "@/lib/contractProjects/revisionStart";
import { currentRevision, existingCodes, insertLines, isMissingSchema, lineRows, loadLines, loadRevisions, refreshRevisionTotal } from "@/lib/contractProjects/server";
import { loadPackages } from "@/lib/contractProjects/workPackagesServer";
import { JUSTIFICATION_NEEDS_NOTE, isCategoryLine, type BudgetLine, type DraftLine, type RevisionRow } from "@/lib/contractProjects/types";
import { buildingOfLine, type BuildingItem } from "./buildings";
import { matchRows, missingFromModel, parseBatch, planApply, planText, type ApplyPlan, type BatchRow, type CompareLine, type ImportSource, type MatchedRow } from "./compare";
import { repriceForQty } from "./quantity";
import { addBuilding } from "./projectServer";
import { chunks, fail, isMissingElementSchema, loadElementSettings, loadElementTypes, type Failure, type Result } from "./server";
import { ELEMENT_LIMITS, MODEL_BUNDLE, MODEL_PENDING } from "./types";

// The model comparison of a contract project (migration 0254; docs/design/pcbs-buildings-elements.md section 2.4). A model or the drawings arrive as a
// batch of rows; they are stored, matched against the budget and shown as a comparison. NOTHING is written to the budget until a person ticks rows and
// applies them, and then only to a DRAFT revision: revision 0 while no baseline is approved, otherwise the open draft revision, or a new one started
// through the same door every change to an approved budget uses (a justification is required). An approved or waiting revision is never written.

const pendingFailure = (): Failure => ({ status: 503, error: MODEL_PENDING, extra: { needsDatabaseUpdate: true, bundle: MODEL_BUNDLE } });
const DEFAULT_JUSTIFICATION = "scope_change";

export type ImportRow = { id: string; project_id: string; import_no: number; source: ImportSource; model_ref: string | null; received_at: string; status: "open" | "applied" | "dismissed"; row_count: number; applied_revision_id: string | null; applied_at: string | null };
const IMPORT_COLS = "id, project_id, import_no, source, model_ref, received_at, status, row_count, applied_revision_id, applied_at";
const ROW_COLS = "row_no, building_code, building_name, element_type, element_code, qty, unit, drawing_no, drawing_rev, kind, matched_line_key";

type StoredRow = { row_no: number; building_code: string | null; building_name: string | null; element_type: string | null; element_code: string | null; qty: number | string | null; unit: string | null; drawing_no: string | null; drawing_rev: string | null; kind: MatchedRow["kind"]; matched_line_key: string | null };

const toBatchRow = (r: StoredRow): BatchRow => ({
  building_code: r.building_code, building_name: r.building_name, element_type: r.element_type, element_code: r.element_code, qty: Number(r.qty ?? 0), unit: r.unit, drawing_no: r.drawing_no, drawing_rev: r.drawing_rev,
});

async function compareLines(ctx: AllocationCtx, revision: RevisionRow): Promise<{ lines: CompareLine[]; budget: BudgetLine[]; items: BuildingItem[]; buildings: Set<string>; packages: Awaited<ReturnType<typeof loadPackages>>["packages"] }> {
  const { admin, tenantId } = ctx.req;
  const have = await loadPackages(admin, tenantId, ctx.project.id);
  const items: BuildingItem[] = have.packages.map((p) => ({ id: p.id, code: p.code, name: p.name, parent_id: p.parent_id ?? null, sort_order: p.sort_order, code_is_manual: p.code_is_manual === true, owner_employee_id: p.owner_employee_id, building_code: p.building_code ?? null }));
  const memberships = lineMemberships(have.packages);
  const budget = await loadLines(admin, tenantId, revision.id);
  const lines: CompareLine[] = budget.map((l) => {
    const where = buildingOfLine(items, memberships.get(l.line_key) ?? { wbs_item_id: null, parts: [] });
    return { key: l.line_key, line_no: l.line_no, building_code: where.kind === "one" ? where.code : null, element_type: l.element_type ?? null, element_code: l.element_code ?? null, qty: l.qty, unit: l.unit, is_category: isCategoryLine(l) };
  });
  return { lines, budget, items, buildings: new Set(items.map((i) => i.building_code).filter((c): c is string => !!c)), packages: have.packages };
}

/** The rows of a comparison against the budget as it stands now: the file's rows matched, then what the model leaves out. */
function compare(rows: readonly BatchRow[], lines: readonly CompareLine[], buildings: ReadonlySet<string>): MatchedRow[] {
  const matched = matchRows(rows, lines, buildings);
  return [...matched, ...missingFromModel(rows, matched, lines)];
}

export async function listImports(ctx: AllocationCtx): Promise<Result<{ imports: ImportRow[] }>> {
  const { admin, tenantId } = ctx.req;
  const { data, error } = await admin.from("project_model_imports").select(IMPORT_COLS).eq("tenant_id", tenantId).eq("project_id", ctx.project.id).order("import_no", { ascending: false }).limit(100);
  if (error) return isMissingElementSchema(error) ? { ok: false, ...pendingFailure() } : fail(500, error.message);
  return { ok: true, imports: ((data ?? []) as unknown as ImportRow[]).map((r) => ({ ...r, import_no: Number(r.import_no), row_count: Number(r.row_count) })) };
}

async function loadImport(ctx: AllocationCtx, importId: string): Promise<Result<{ row: ImportRow }>> {
  const { admin, tenantId } = ctx.req;
  const { data, error } = await admin.from("project_model_imports").select(IMPORT_COLS).eq("id", importId).eq("tenant_id", tenantId).eq("project_id", ctx.project.id).maybeSingle();
  if (error) return isMissingElementSchema(error) ? { ok: false, ...pendingFailure() } : fail(500, error.message);
  if (!data) return fail(404, "Comparison not found");
  return { ok: true, row: data as unknown as ImportRow };
}

async function storedRows(ctx: AllocationCtx, importId: string): Promise<StoredRow[] | null> {
  const { admin, tenantId } = ctx.req;
  const res = await readAllPages((lo, hi) => admin.from("project_model_import_rows").select(ROW_COLS).eq("tenant_id", tenantId).eq("project_id", ctx.project.id).eq("import_id", importId).order("row_no", { ascending: true }).range(lo, hi));
  return res.error ? null : ((res.data ?? []) as unknown as StoredRow[]);
}

/** One comparison with its rows, matched against the budget as it stands now (an applied or dismissed one shows the match it had). */
export async function getImport(ctx: AllocationCtx, importId: string): Promise<Result<{ row: ImportRow; rows: MatchedRow[]; target: { rev_no: number; status: string } | null }>> {
  const found = await loadImport(ctx, importId);
  if (!found.ok) return found;
  const stored = await storedRows(ctx, importId);
  if (!stored) return fail(500, "Could not read the rows");
  const revisions = await loadRevisions(ctx.req.admin, ctx.req.tenantId, ctx.project.id);
  const revision = currentRevision(revisions.rows);
  if (found.row.status !== "open" || !revision) {
    const rows = stored.map((r) => ({ ...toBatchRow(r), row_no: r.row_no, kind: r.kind, matched_key: r.matched_line_key, current_qty: null, ambiguous: false }));
    return { ok: true, row: found.row, rows, target: revision ? { rev_no: revision.rev_no, status: revision.status } : null };
  }
  const ctxLines = await compareLines(ctx, revision);
  const fileRows = stored.filter((r) => r.kind !== "not_in_model").map(toBatchRow);
  return { ok: true, row: found.row, rows: compare(fileRows, ctxLines.lines, ctxLines.buildings), target: { rev_no: revision.rev_no, status: revision.status } };
}

/** Stores a batch (a file, or the connector's post) as a new comparison and matches it. Writes nothing to the budget. */
export async function createImport(ctx: AllocationCtx, raw: unknown): Promise<Result<{ id: string; import_no: number; rows: number }>> {
  const { admin, tenantId, userId } = ctx.req;
  const settings = await loadElementSettings();
  const parsed = parseBatch(raw, settings.code_max);
  if (!parsed.ok) return fail(422, parsed.row ? `Row ${parsed.row}: ${parsed.error}` : parsed.error, parsed.row ? { row: parsed.row } : undefined);
  const batch = parsed.batch;
  const revisions = await loadRevisions(admin, tenantId, ctx.project.id);
  const revision = currentRevision(revisions.rows);
  const ctxLines = revision ? await compareLines(ctx, revision) : { lines: [] as CompareLine[], buildings: new Set<string>() };
  const matched = compare(batch.rows, ctxLines.lines, ctxLines.buildings);

  for (let attempt = 0; attempt < 3; attempt++) {
    const last = await admin.from("project_model_imports").select("import_no").eq("tenant_id", tenantId).eq("project_id", ctx.project.id).order("import_no", { ascending: false }).limit(1);
    if (last.error) return isMissingElementSchema(last.error) ? { ok: false, ...pendingFailure() } : fail(500, last.error.message);
    const importNo = Number(((last.data ?? []) as { import_no: number }[])[0]?.import_no ?? 0) + 1;
    const id = randomUUID();
    const made = await admin.from("project_model_imports").insert({
      id, tenant_id: tenantId, project_id: ctx.project.id, import_no: importNo, source: batch.source, model_ref: batch.model_ref, received_at: batch.received_at ?? new Date().toISOString(), status: "open", row_count: matched.length, created_by: userId,
    });
    if (made.error) {
      if (made.error.code === "23505") continue;
      return isMissingElementSchema(made.error) ? { ok: false, ...pendingFailure() } : fail(500, made.error.message);
    }
    const rows = matched.map((m) => ({
      tenant_id: tenantId, project_id: ctx.project.id, import_id: id, row_no: m.row_no, building_code: m.building_code, building_name: m.building_name, element_type: m.element_type, element_code: m.element_code,
      qty: m.kind === "not_in_model" ? null : m.qty, unit: m.unit, drawing_no: m.drawing_no, drawing_rev: m.drawing_rev, kind: m.kind, matched_line_key: m.matched_key,
    }));
    for (const batchRows of chunks(rows, 500)) {
      const ins = await admin.from("project_model_import_rows").insert(batchRows);
      if (ins.error) {
        await admin.from("project_model_imports").delete().eq("id", id).eq("tenant_id", tenantId).eq("project_id", ctx.project.id);
        return fail(500, ins.error.message);
      }
    }
    const user = await getAuthUser();
    await logChange(ctx.req.supabase, {
      tenantId, objectType: "contract_projects", objectId: ctx.project.id, objectLabel: `${ctx.project.ref ?? ""} ${ctx.project.name}`.trim(), action: "update", actorId: user?.id, actorEmail: user?.email,
      changes: [{ field: `Model comparison M-${importNo}`, from: null, to: `${batch.rows.length} rows${batch.model_ref ? ` from ${batch.model_ref}` : ""}, ${matched.filter((m) => m.kind !== "same" && m.kind !== "not_in_model").length} to review` }],
    });
    return { ok: true, id, import_no: importNo, rows: matched.length };
  }
  return fail(409, "Another comparison arrived at the same time. Try again");
}

export async function dismissImport(ctx: AllocationCtx, importId: string): Promise<Result<{ status: "dismissed" }>> {
  const found = await loadImport(ctx, importId);
  if (!found.ok) return found;
  if (found.row.status !== "open") return fail(409, `This comparison is already ${found.row.status}`);
  const { error } = await ctx.req.admin.from("project_model_imports").update({ status: "dismissed" }).eq("id", importId).eq("tenant_id", ctx.req.tenantId).eq("project_id", ctx.project.id).eq("status", "open");
  if (error) return fail(500, error.message);
  const user = await getAuthUser();
  await logChange(ctx.req.supabase, {
    tenantId: ctx.req.tenantId, objectType: "contract_projects", objectId: ctx.project.id, objectLabel: `${ctx.project.ref ?? ""} ${ctx.project.name}`.trim(), action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: `Model comparison M-${found.row.import_no}`, from: "open", to: "dismissed" }],
  });
  return { ok: true, status: "dismissed" };
}

export type ApplyInput = { rows: number[]; justification_code?: string; justification_text?: string | null };
export type ApplyResult = { revision_rev_no: number; started_revision: boolean; text: string; plan: ApplyPlan; notes: string[] };

/**
 * "Apply selected". Nothing but this writes a model's numbers into the budget, and it writes a draft only: revision 0 while no baseline is approved,
 * the open draft revision after one, or a new draft revision started with a justification. The plan is worked out before anything starts, so an
 * empty selection never opens a revision.
 */
export async function applyImport(ctx: AllocationCtx, importId: string, input: ApplyInput): Promise<Result<ApplyResult>> {
  const { admin, tenantId, userId } = ctx.req;
  if (ctx.project.status === "closed") return fail(409, "This project is closed", { locked: true });
  const found = await loadImport(ctx, importId);
  if (!found.ok) return found;
  if (found.row.status !== "open") return fail(409, `This comparison is already ${found.row.status}`);
  const stored = await storedRows(ctx, importId);
  if (!stored) return fail(500, "Could not read the rows");

  const revisions = await loadRevisions(admin, tenantId, ctx.project.id);
  const current = currentRevision(revisions.rows);
  if (!current) return fail(404, "There is no budget to apply this to");
  const hasBaseline = revisions.rows.some((r) => r.status === "approved");
  if (!hasBaseline && current.status !== "draft") return fail(409, "This budget is waiting for approval and cannot be changed", { locked: true });
  if (hasBaseline && current.status === "pending") return fail(409, "A revision is waiting for approval. Finish or withdraw it first", { locked: true });

  // Plan against the revision the numbers would land on (the open draft, or the approved baseline a new draft copies: the same line keys).
  const before = await compareLines(ctx, current);
  const fileRows = stored.filter((r) => r.kind !== "not_in_model").map(toBatchRow);
  const matched = compare(fileRows, before.lines, before.buildings);
  const plan = planApply(matched, new Set(input.rows));
  const total = plan.quantities.length + plan.newElements.length;
  if (total === 0) return fail(422, plan.skipped[0]?.reason ?? "Tick at least one row to apply");

  let target = current;
  let started = false;
  if (current.status !== "draft") {
    const code = input.justification_code || DEFAULT_JUSTIFICATION;
    const known = await existingCodes(admin, tenantId, "justification", [code]);
    if (!known.has(code)) return fail(422, "Choose a reason from the list for this revision");
    const note = (input.justification_text ?? "").trim() || `Model import M-${found.row.import_no}`;
    if (code === JUSTIFICATION_NEEDS_NOTE && note.length < 3) return fail(422, "The reason Other needs a short note");
    const begun = await startDraftRevision(admin, { tenantId, userId, projectId: ctx.project.id, justificationCode: code, justificationText: note.slice(0, 1000) });
    if (!begun.ok) return fail(begun.status, begun.error, { reason: begun.reason });
    const loaded = (await loadRevisions(admin, tenantId, ctx.project.id)).rows.find((r) => r.id === begun.id);
    if (!loaded) return fail(500, "The revision could not be read back");
    target = loaded;
    started = true;
  }
  if (target.status !== "draft") return fail(409, "Only a draft can be changed", { locked: true });

  const notes: string[] = [];
  const typeSet = new Set((await loadElementTypes(admin, tenantId)).map((t) => t.code));

  // 1. New buildings first, so the new elements have somewhere to sit.
  for (const b of plan.newBuildings) {
    const made = await addBuilding(ctx, { name: b.name, code: b.code });
    if (!made.ok) notes.push(`Building ${b.code} was not added: ${made.error}`);
  }

  // 2. Quantities: the model quantity and the budget quantity take the model's number; the contract side never moves.
  const lines = await loadLines(admin, tenantId, target.id);
  const byKey = new Map(lines.map((l) => [l.line_key, l]));
  let changed = 0;
  for (const q of plan.quantities) {
    const line = byKey.get(q.line_key);
    if (!line) { notes.push(`Row ${q.row_no}: the line is no longer in the budget`); continue; }
    const re = repriceForQty({ qty: line.qty, unit_cost: line.unit_cost, amount: line.amount, allocated: line.allocated }, q.to, ctx.project.allocation_basis);
    const { error } = await admin.from("project_budget_lines").update({ model_qty: q.to, qty: re.qty, amount: re.amount, unit_cost: re.unit_cost }).eq("id", line.id).eq("tenant_id", tenantId).eq("revision_id", target.id).eq("project_id", ctx.project.id);
    if (error) return isMissingSchema(error) ? { ok: false, ...pendingFailure() } : fail(500, error.message);
    changed++;
  }

  // 3. New elements: a line with the element's type and code, in its building when that building is a leaf (the person moves it into an activity otherwise).
  const have = await loadPackages(admin, tenantId, ctx.project.id);
  const buildingItem = new Map(have.packages.filter((p) => p.building_code).map((p) => [p.building_code as string, p]));
  const taken = new Set(lines.map((l) => l.element_code).filter((c): c is string => !!c));
  const fresh: { draft: DraftLine; building: string | null }[] = [];
  for (const n of plan.newElements) {
    if (n.element_code && taken.has(n.element_code)) { notes.push(`Row ${n.row_no}: ${n.element_code} already exists`); continue; }
    if (n.element_type && !typeSet.has(n.element_type)) notes.push(`Row ${n.row_no}: ${n.element_type} is not in your Element types list (the line was added anyway)`);
    if (n.element_code) taken.add(n.element_code);
    fresh.push({
      building: n.building_code,
      draft: {
        line_key: randomUUID(), resource_code: null, cost_code: null, wbs: null, description: `${n.element_type ?? "Element"}${n.element_code ? ` ${n.element_code}` : ""}`.slice(0, 500), qty: n.qty, unit: n.unit, unit_cost: 0, cost_known: true,
        source_ref: `Model import M-${found.row.import_no}`, reserve: false, amount: 0, allocated: false, client_rate: null, client_amount: null, source_line_id: null,
        element_type: n.element_type, element_code: n.element_code, client_qty: null, model_qty: n.qty,
      },
    });
  }
  if (fresh.length > 0) {
    const start = lines.reduce((m, l) => Math.max(m, l.line_no), 0);
    const rows = lineRows(tenantId, ctx.project.id, target.id, fresh.map((f) => f.draft)).map((r, i) => ({ ...r, line_no: start + i + 1 }));
    const failedInsert = await insertLines(admin, rows);
    if (failedInsert) return fail(500, failedInsert.message);
    const links: Record<string, unknown>[] = [];
    fresh.forEach((f, i) => {
      const home = f.building ? buildingItem.get(f.building) : undefined;
      if (!home) return;
      const isLeaf = !have.packages.some((p) => p.parent_id === home.id);
      if (isLeaf) links.push({ tenant_id: tenantId, project_id: ctx.project.id, package_id: home.id, line_key: f.draft.line_key, sort_order: 1000 + i });
      else notes.push(`${f.draft.element_code ?? f.draft.description} is in no activity yet: put it in one of ${home.building_code}'s activities with Group into WBS`);
    });
    if (links.length > 0) await admin.from("project_work_package_lines").insert(links);
  }

  await refreshRevisionTotal(admin, tenantId, target.id);
  await admin.from("contract_projects").update({ updated_at: new Date().toISOString() }).eq("id", ctx.project.id).eq("tenant_id", tenantId);
  await admin.from("project_model_imports").update({ status: "applied", applied_revision_id: target.id, applied_at: new Date().toISOString(), applied_by: userId }).eq("id", importId).eq("tenant_id", tenantId).eq("project_id", ctx.project.id);
  const text = planText({ ...plan, quantities: plan.quantities.slice(0, changed), newElements: plan.newElements.slice(0, fresh.length) });
  const user = await getAuthUser();
  await logChange(ctx.req.supabase, {
    tenantId, objectType: "contract_projects", objectId: ctx.project.id, objectLabel: `${ctx.project.ref ?? ""} ${ctx.project.name}`.trim(), action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [
      { field: `Model comparison M-${found.row.import_no} applied to revision ${target.rev_no}`, from: null, to: text },
      ...plan.quantities.slice(0, 40).map((q) => ({ field: `Quantity of line ${byKey.get(q.line_key)?.element_code ?? byKey.get(q.line_key)?.line_no ?? ""}`, from: q.from, to: q.to })),
    ],
  });
  return { ok: true, revision_rev_no: target.rev_no, started_revision: started, text, plan, notes };
}

export { ELEMENT_LIMITS };
