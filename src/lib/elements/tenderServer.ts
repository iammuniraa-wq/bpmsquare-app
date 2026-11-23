import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllPages } from "@/lib/pagedRead";
import { loadOpportunityLines } from "@/lib/sales/opportunityServer";
import { loadProjectBySource } from "@/lib/contractProjects/server";
import { createItem, deleteItem, updateItem, wbsCtx } from "@/lib/tender/wbs/server";
import { loadItems, loadMembers } from "@/lib/tender/wbs/read";
import type { BoqRequest } from "@/lib/tender/boq/server";
import type { WbsItemRow } from "@/lib/tender/wbs/types";
import { buildingCodeProblem, buildingOfLine, type BuildingItem } from "./buildings";
import { editProblem, parseElementEdit } from "./edit";
import { cleanBuildingCode, planIssue, planReissue, validatePattern, type IssuePlan } from "./pattern";
import { buildPayload, linesUnder, type BuildingsPayload, type NeutralLine } from "./rows";
import { buildingsOn, chunks, fail, isMissingElementSchema, loadElementSettings, loadElementTypes, type ElementTypeChoice, type Failure, type Result } from "./server";
import { COMMON_BUILDING, ELEMENTS_BUNDLE, ELEMENTS_PENDING, type ElementsSettings } from "./types";
import type { ReissuePreview } from "./projectServer";

// Buildings and element codes on a TENDER (docs/design/pcbs-buildings-elements.md, "It can run on a tender (optional)"). Same rules as the project,
// on tender_wbs_items and tender_boq_lines (0253). The codes issued here travel to the project with the lines when it is made, and the project
// then owns its copy. There is no revision on a tender, so nothing is locked; once the tender has become a project the codes are the project's.
// Every query is tenant-scoped on the service-role client and names the deal.

const pendingFailure = (): Failure => ({ status: 503, error: ELEMENTS_PENDING, extra: { needsDatabaseUpdate: true, bundle: ELEMENTS_BUNDLE } });

const LINE_COLS_BASE = "id, line_id, row_no, item_no, file_description, file_uom, file_qty, unit_cost, removed_in_revision";
const LINE_COLS = `${LINE_COLS_BASE}, element_type, element_code, model_qty`;

type Row = { id: string; line_id: string | null; row_no: number; item_no: string | null; file_description: string; file_uom: string | null; file_qty: number | string; unit_cost: number | string | null; removed_in_revision: boolean; element_type?: string | null; element_code?: string | null; model_qty?: number | string | null };

async function readRows(admin: SupabaseClient, tenantId: string, oppId: string): Promise<{ rows: Row[]; elementsPending: boolean } | { error: string }> {
  const read = (cols: string) => readAllPages((lo, hi) => admin.from("tender_boq_lines").select(cols).eq("tenant_id", tenantId).eq("opportunity_id", oppId).order("row_no", { ascending: true }).order("id", { ascending: true }).range(lo, hi));
  let res = await read(LINE_COLS);
  let elementsPending = false;
  if (res.error && isMissingElementSchema(res.error)) { res = await read(LINE_COLS_BASE); elementsPending = !res.error; }
  if (res.error) return { error: res.error.message };
  return { rows: (res.data ?? []) as unknown as Row[], elementsPending };
}

const asItems = (items: readonly WbsItemRow[]): BuildingItem[] => items.map((i) => ({
  id: i.id, code: i.code, name: i.name, parent_id: i.parent_id, sort_order: i.sort_order, code_is_manual: i.code_is_manual, owner_employee_id: i.owner_employee_id, created_at: i.created_at, building_code: i.building_code ?? null,
}));

export type TenderBuildingsData = BuildingsPayload & {
  enabled: true;
  scope: "tender";
  pending: boolean;
  settings: Pick<ElementsSettings, "pattern" | "code_max" | "qty_tolerance_pct" | "level_names">;
  pattern: string;
  pattern_frozen: false;
  types: ElementTypeChoice[];
  revision: null;
  lock: string | null;
  can_reissue: boolean;
  allocation_basis: "line";
  currency: string | null;
  /** The tender already became a project: its codes were copied, and the project owns them now. */
  has_project: boolean;
};

/** Buildings are an add-on of Contract projects (`contract_buildings`); a workspace without both sees nothing (the panel renders nothing for `enabled: false`). */
export async function tenderEnabled(req: BoqRequest): Promise<boolean> {
  return buildingsOn(req.supabase, req.tenantId);
}

export async function tenderBuildings(req: BoqRequest): Promise<Result<{ data: TenderBuildingsData }>> {
  const { admin, tenantId, opp } = req;
  const [it, mem, read, settings] = await Promise.all([loadItems(admin, tenantId, opp.id), loadMembers(admin, tenantId, opp.id), readRows(admin, tenantId, opp.id), loadElementSettings()]);
  if (it.pending || mem.pending) return fail(503, "WBS needs a database update (migration 0243)");
  if ("error" in read) return fail(500, read.error);
  const deal = new Map((await loadOpportunityLines(admin, tenantId, opp.id)).map((l) => [l.id, l]));
  const lines: NeutralLine[] = read.rows.map((r) => {
    const d = r.line_id ? deal.get(r.line_id) : undefined;
    return {
      key: r.id, line_no: r.row_no, ref: r.item_no, description: r.file_description, unit: r.file_uom, qty: Number(r.file_qty), client_qty: Number(r.file_qty), model_qty: r.model_qty == null ? null : Number(r.model_qty),
      client_rate: d ? Number(d.rate) : null, client_amount: d ? Number(d.amount) : 0, cost: r.unit_cost == null ? null : Math.round(Number(r.unit_cost) * Number(r.file_qty) * 100) / 100,
      element_type: r.element_type ?? null, element_code: r.element_code ?? null, wbs_item_id: mem.members.item.get(r.id) ?? null, parts: mem.members.parts.get(r.id) ?? [], removed: r.removed_in_revision,
    };
  });
  const items = asItems(it.items);
  const payload = buildPayload(items, lines, { pattern: settings.pattern, qty_tolerance_pct: settings.qty_tolerance_pct });
  const pending = it.buildingsPending === true || read.elementsPending;
  const project = await loadProjectBySource(admin, tenantId, opp.id);
  return {
    ok: true,
    data: {
      ...payload, enabled: true, scope: "tender", pending,
      settings: { pattern: settings.pattern, code_max: settings.code_max, qty_tolerance_pct: settings.qty_tolerance_pct, level_names: settings.level_names },
      pattern: settings.pattern, pattern_frozen: false, types: pending ? [] : await loadElementTypes(admin, tenantId), revision: null, lock: null,
      can_reissue: !project, allocation_basis: "line", currency: opp.currency ?? null, has_project: !!project,
    },
  };
}

async function loadAll(req: BoqRequest) {
  const { admin, tenantId, opp } = req;
  const [it, mem, read] = await Promise.all([loadItems(admin, tenantId, opp.id), loadMembers(admin, tenantId, opp.id), readRows(admin, tenantId, opp.id)]);
  if (it.pending || mem.pending) return fail(503, "WBS needs a database update (migration 0243)");
  if ("error" in read) return fail(500, read.error);
  if (it.buildingsPending || read.elementsPending) return { ok: false as const, ...pendingFailure() };
  return { ok: true as const, items: it.items, members: mem.members, rows: read.rows };
}

const toNeutral = (rows: readonly Row[], members: { item: Map<string, string | null>; parts: Map<string, { wbs_item_id: string; share_pct: number }[]> }): NeutralLine[] => rows.map((r) => ({
  key: r.id, line_no: r.row_no, ref: r.item_no, description: r.file_description, unit: r.file_uom, qty: Number(r.file_qty), client_qty: Number(r.file_qty), model_qty: r.model_qty == null ? null : Number(r.model_qty),
  client_rate: null, client_amount: 0, cost: null, element_type: r.element_type ?? null, element_code: r.element_code ?? null, wbs_item_id: members.item.get(r.id) ?? null, parts: members.parts.get(r.id) ?? [], removed: r.removed_in_revision,
}));

export async function addBuilding(req: BoqRequest, input: { name?: unknown; code?: unknown; common?: unknown }): Promise<Result<{ id: string; code: string }>> {
  const common = input.common === true;
  const name = common ? COMMON_BUILDING.name : typeof input.name === "string" ? input.name.trim().slice(0, 200) : "";
  const code = common ? COMMON_BUILDING.code : cleanBuildingCode(input.code);
  if (!name) return fail(422, "Give the building a name");
  if (!code) return fail(422, "A building code is 1 to 6 letters or digits");
  const st = await loadAll(req);
  if (!st.ok) return st;
  const problem = buildingCodeProblem(asItems(st.items), null, null, code);
  if (problem) return fail(409, problem);
  const ctx = wbsCtx(req);
  const made = await createItem(ctx, { name });
  if (!made.ok) return made;
  const { error } = await req.admin.from("tender_wbs_items").update({ building_code: code, updated_at: new Date().toISOString() }).eq("id", made.id).eq("tenant_id", req.tenantId).eq("opportunity_id", req.opp.id);
  if (error) {
    await req.admin.from("tender_wbs_items").delete().eq("id", made.id).eq("tenant_id", req.tenantId).eq("opportunity_id", req.opp.id);
    return error.code === "23505" ? fail(409, `${code} is already a building here`) : isMissingElementSchema(error) ? { ok: false, ...pendingFailure() } : fail(500, error.message);
  }
  await ctx.log([{ field: `Building ${code} added`, from: null, to: name }]);
  return { ok: true, id: made.id, code };
}

/**
 * Gives a level-1 item a building code, or clears it (null). The one writer the Data Workbench uses for the Building code column: the same checks the
 * screen's Add and Edit make (a top-level item, 1 to 6 characters, unique on the deal), with a refusal while the building holds lines.
 */
export async function setBuildingCode(req: BoqRequest, itemId: string, code: string | null): Promise<Result<{ code: string | null }>> {
  if (code === null) {
    const st = await loadAll(req);
    if (!st.ok) return st;
    const cur = st.items.find((i) => i.id === itemId);
    if (!cur) return fail(404, "WBS item not found");
    if (!cur.building_code) return { ok: true, code: null };
    const held = linesUnder(asItems(st.items), toNeutral(st.rows, st.members), itemId);
    if (held > 0) return fail(409, `${cur.building_code} holds ${held} line${held === 1 ? "" : "s"}, so it stays a building`);
    const { error } = await req.admin.from("tender_wbs_items").update({ building_code: null, updated_at: new Date().toISOString() }).eq("id", itemId).eq("tenant_id", req.tenantId).eq("opportunity_id", req.opp.id);
    return error ? fail(500, error.message) : { ok: true, code: null };
  }
  const out = await updateBuilding(req, itemId, { code });
  return out.ok ? { ok: true, code: out.code } : out;
}

export async function updateBuilding(req: BoqRequest, itemId: string, input: { name?: unknown; code?: unknown; reissue?: unknown; preview?: unknown }): Promise<Result<{ code: string | null; reissued: number; preview?: ReissuePreview }>> {
  const { admin, tenantId, opp } = req;
  const st = await loadAll(req);
  if (!st.ok) return st;
  const current = st.items.find((i) => i.id === itemId);
  if (!current) return fail(404, "Building not found");
  const items = asItems(st.items);
  const ctx = wbsCtx(req);
  if (typeof input.name === "string" && input.name.trim() && input.name.trim() !== current.name) {
    const renamed = await updateItem(ctx, itemId, { name: input.name.trim() });
    if (!renamed.ok) return renamed;
  }
  let reissued = 0;
  if (input.code !== undefined && input.code !== null) {
    const code = cleanBuildingCode(input.code);
    if (!code) return fail(422, "A building code is 1 to 6 letters or digits");
    if (code !== (current.building_code ?? null)) {
      const problem = buildingCodeProblem(items, itemId, current.parent_id, code);
      if (problem) return fail(problem.includes("already") ? 409 : 422, problem);
      const lines = toNeutral(st.rows, st.members);
      const issued = current.building_code ? lines.filter((l) => !!l.element_code && !l.removed && buildingOfLine(items, l).kind === "one" && (buildingOfLine(items, l) as { item_id: string }).item_id === itemId) : [];
      if (issued.length > 0) {
        if (input.reissue !== true) return fail(409, `${current.building_code} is used by ${issued.length} code${issued.length === 1 ? "" : "s"}. Reissue them or leave the code as it is`, { used_by: issued.length });
        if (await loadProjectBySource(admin, tenantId, opp.id)) return fail(409, "This tender already became a project. Its codes are final: change them there, in a revision", { locked: true });
        const settings = await loadElementSettings();
        const check = validatePattern(settings.pattern, settings.code_max);
        if (!check.ok) return fail(422, check.error);
        const plan = planReissue({ parts: check.parts, project: null, lines: issued.map((l) => ({ key: l.key, element_code: l.element_code, building_code: current.building_code ?? null, element_type: l.element_type })), change: { building: { from: current.building_code as string, to: code } } });
        if (plan.clashes.length > 0) return fail(409, `${plan.clashes.slice(0, 3).join(", ")} would clash with a code that already exists`, { clashes: plan.clashes });
        if (input.preview === true) return { ok: true, code: current.building_code ?? null, reissued: 0, preview: { rows: plan.rows, clashes: [] } };
        const done: { id: string; from: string }[] = [];
        for (const r of plan.rows) {
          const { error } = await admin.from("tender_boq_lines").update({ element_code: r.to }).eq("id", r.key).eq("tenant_id", tenantId).eq("opportunity_id", opp.id);
          if (error) {
            for (const d of done) await admin.from("tender_boq_lines").update({ element_code: d.from }).eq("id", d.id).eq("tenant_id", tenantId).eq("opportunity_id", opp.id);
            return fail(error.code === "23505" ? 409 : 500, error.code === "23505" ? `${r.to} already exists` : error.message);
          }
          done.push({ id: r.key, from: r.from });
        }
        reissued = done.length;
        await ctx.log([
          { field: `Building ${current.building_code} reissued as ${code}`, from: `${plan.rows.length} codes`, to: `${plan.rows[0]?.from ?? ""} to ${plan.rows[0]?.to ?? ""}` },
          ...plan.rows.slice(0, 40).map((r) => ({ field: "Element code", from: r.from, to: r.to })),
        ]);
      } else if (input.preview === true) return { ok: true, code: current.building_code ?? null, reissued: 0, preview: { rows: [], clashes: [] } };
      const { error } = await admin.from("tender_wbs_items").update({ building_code: code, updated_at: new Date().toISOString() }).eq("id", itemId).eq("tenant_id", tenantId).eq("opportunity_id", opp.id);
      if (error) return error.code === "23505" ? fail(409, `${code} is already a building here`) : isMissingElementSchema(error) ? { ok: false, ...pendingFailure() } : fail(500, error.message);
      await ctx.log([{ field: `Building ${current.building_code ?? current.code} code`, from: current.building_code ?? null, to: code }]);
    }
  }
  return { ok: true, code: input.code ? cleanBuildingCode(input.code) : current.building_code ?? null, reissued };
}

export async function removeBuilding(req: BoqRequest, itemId: string): Promise<Result<{ removed: true }>> {
  const st = await loadAll(req);
  if (!st.ok) return st;
  const current = st.items.find((i) => i.id === itemId);
  if (!current || !current.building_code) return fail(404, "Building not found");
  const held = linesUnder(asItems(st.items), toNeutral(st.rows, st.members), itemId);
  if (held > 0) return fail(409, `${current.building_code} holds ${held} line${held === 1 ? "" : "s"}. Move them out first`, { lines: held });
  const ctx = wbsCtx(req);
  const gone = await deleteItem(ctx, itemId);
  if (!gone.ok) return gone;
  await ctx.log([{ field: `Building ${current.building_code} removed`, from: current.name, to: null }]);
  return { ok: true, removed: true };
}

export async function setLineElement(req: BoqRequest, boqId: string, body: unknown): Promise<Result<{ line_key: string }>> {
  const { admin, tenantId, opp } = req;
  const st = await loadAll(req);
  if (!st.ok) return st;
  const row = st.rows.find((r) => r.id === boqId);
  if (!row) return fail(404, "Line not found");
  const settings = await loadElementSettings();
  const types = new Set((await loadElementTypes(admin, tenantId)).map((t) => t.code));
  const parsed = parseElementEdit(body, { codeMax: settings.code_max, types, keep: row.element_type ?? null });
  if (!parsed.ok) return fail(422, parsed.error);
  const edit = parsed.edit;
  if (edit.accept_model || edit.use_client) return fail(422, "The budget quantity is set on the project, not on the tender");
  const items = asItems(st.items);
  const nl = toNeutral([row], st.members)[0];
  const where = buildingOfLine(items, nl);
  const problem = editProblem({ element_type: row.element_type ?? null, element_code: row.element_code ?? null, model_qty: row.model_qty == null ? null : Number(row.model_qty), is_category: false, mixed: where.kind === "mixed", building_code: where.kind === "one" ? where.code : null }, edit);
  if (problem) return fail(422, problem);
  if (edit.element_code && st.rows.some((r) => r.element_code === edit.element_code && r.id !== boqId)) return fail(409, `${edit.element_code} is already used on this tender`);
  const patch: Record<string, unknown> = {};
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  const name = row.element_code ?? row.item_no ?? `line ${row.row_no}`;
  if ("element_type" in edit && (edit.element_type ?? null) !== (row.element_type ?? null)) { patch.element_type = edit.element_type ?? null; changes.push({ field: `Element type of ${name}`, from: row.element_type ?? null, to: edit.element_type ?? null }); }
  if ("element_code" in edit && (edit.element_code ?? null) !== (row.element_code ?? null)) { patch.element_code = edit.element_code ?? null; changes.push({ field: `Element code of line ${row.row_no}`, from: row.element_code ?? null, to: edit.element_code ?? null }); }
  if ("model_qty" in edit && (edit.model_qty ?? null) !== (row.model_qty == null ? null : Number(row.model_qty))) { patch.model_qty = edit.model_qty ?? null; changes.push({ field: `Model quantity of ${name}`, from: row.model_qty ?? null, to: edit.model_qty ?? null }); }
  if (Object.keys(patch).length === 0) return { ok: true, line_key: boqId };
  const { error } = await admin.from("tender_boq_lines").update(patch).eq("id", boqId).eq("tenant_id", tenantId).eq("opportunity_id", opp.id);
  if (error) {
    if (error.code === "23505") return fail(409, `${edit.element_code ?? "That code"} is already used on this tender`);
    return isMissingElementSchema(error) ? { ok: false, ...pendingFailure() } : fail(500, error.message);
  }
  await wbsCtx(req).log(changes);
  return { ok: true, line_key: boqId };
}

export type TenderIssueResult = { plan: IssuePlan; written: number; pattern: string };

export async function issueCodes(req: BoqRequest, input: { keys?: unknown; preview?: unknown }): Promise<Result<TenderIssueResult>> {
  const { admin, tenantId, opp } = req;
  const st = await loadAll(req);
  if (!st.ok) return st;
  const settings = await loadElementSettings();
  const check = validatePattern(settings.pattern, settings.code_max);
  if (!check.ok) return fail(422, check.error);
  const items = asItems(st.items);
  const wanted = Array.isArray(input.keys) ? new Set(input.keys.filter((k): k is string => typeof k === "string")) : null;
  const rows = toNeutral(st.rows, st.members).filter((l) => !l.removed && (!wanted || wanted.has(l.key)));
  const plan = planIssue({
    parts: check.parts, codeMax: settings.code_max, project: null, existing: st.rows.map((r) => r.element_code).filter((c): c is string => !!c),
    lines: rows.map((l) => { const where = buildingOfLine(items, l); return { key: l.key, line_no: l.line_no, building_code: where.kind === "one" ? where.code : null, element_type: l.element_type, element_code: l.element_code }; }),
  });
  if (input.preview === true || plan.assignments.length === 0) return { ok: true, plan, written: 0, pattern: settings.pattern };
  let written = 0;
  for (const batch of chunks(plan.assignments, 25)) {
    const results = await Promise.all(batch.map((a) => admin.from("tender_boq_lines").update({ element_code: a.code }).eq("id", a.key).eq("tenant_id", tenantId).eq("opportunity_id", opp.id).is("element_code", null)));
    const bad = results.find((r) => r.error);
    written += results.filter((r) => !r.error).length;
    if (bad?.error) {
      if (written > 0) await wbsCtx(req).log([{ field: "Element codes issued", from: null, to: `${written} codes (stopped: another change took a code)` }]);
      return bad.error.code === "23505" ? fail(409, "Another change took one of those codes. Nothing more was issued. Try again") : isMissingElementSchema(bad.error) ? { ok: false, ...pendingFailure() } : fail(500, bad.error.message);
    }
  }
  await wbsCtx(req).log([{ field: "Element codes issued", from: null, to: plan.summary.join("; ") }]);
  return { ok: true, plan, written, pattern: settings.pattern };
}
