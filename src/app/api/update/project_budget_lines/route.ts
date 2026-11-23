import { NextResponse, type NextRequest } from "next/server";
import { readImportBody } from "@/lib/import/server";
import { summariseUpdate } from "@/lib/import/updateServer";
import { allocationFor, lineOfId, projectDwGate, putLineInBuilding } from "@/lib/import/projectElementsServer";
import { PROJECT_BUDGET_UPDATE_KEYS } from "@/lib/import/projectElementsSchema";
import { currentRevision, loadLines, loadRevisions } from "@/lib/contractProjects/server";
import { buildingOfLine } from "@/lib/elements/buildings";
import { lineMemberships } from "@/lib/contractProjects/allocation";
import { loadPackages } from "@/lib/contractProjects/workPackagesServer";
import { setLineElement } from "@/lib/elements/projectServer";
import type { RowOutcome } from "@/lib/import/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const may = (key: (typeof PROJECT_BUDGET_UPDATE_KEYS)[number]) => PROJECT_BUDGET_UPDATE_KEYS.includes(key);

/**
 * Bulk-edits the element fields of project budget lines, matched by their own Record ID (the export's "id" column), never by item number or code: a code
 * can be retyped. Only element type, element code, model quantity and building change, through setLineElement, the writer the element panel uses (the type
 * list, the unique code, the one-building rule and the change log are the screen's own). Only the OPEN budget of a project: a line of an approved or older
 * revision is refused with "Start a revision first". A value that says what the line already has is "No change", so an export can be edited and loaded back.
 * An id of another workspace matches nothing.
 */
export async function POST(request: NextRequest) {
  const gate = await projectDwGate("project_budget_lines", true);
  if (!gate.ok) return gate.response;
  const { req } = gate;
  const rows = readImportBody(await request.json().catch(() => null));
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const outcomes: RowOutcome[] = [];
  const ctxs = new Map<string, Awaited<ReturnType<typeof allocationFor>>>();
  const state = new Map<string, { current: string | null; rev: Awaited<ReturnType<typeof currentRevision>>; lines: Awaited<ReturnType<typeof loadLines>>; building: Map<string, string | null> }>();

  for (const { rowNum, values } of rows) {
    const id = values.id?.trim();
    if (!id) { outcomes.push({ rowNum, status: "failed", reason: "Record ID is required to update a row" }); continue; }
    if (!UUID.test(id)) { outcomes.push({ rowNum, status: "failed", reason: `No record with id "${id}" found in this workspace` }); continue; }
    if (!PROJECT_BUDGET_UPDATE_KEYS.some((k) => k in values)) { outcomes.push({ rowNum, status: "skipped", reason: "No mapped columns to update" }); continue; }
    const line = await lineOfId(req.admin, req.tenantId, id);
    if (!line) { outcomes.push({ rowNum, status: "failed", reason: `No record with id "${id}" found in this workspace` }); continue; }

    if (!ctxs.has(line.project_id)) ctxs.set(line.project_id, await allocationFor(req, line.project_id));
    const ctx = ctxs.get(line.project_id);
    if (!ctx) { outcomes.push({ rowNum, status: "failed", reason: "The project could not be opened" }); continue; }
    if (!state.has(line.project_id)) {
      const rev = currentRevision((await loadRevisions(req.admin, req.tenantId, line.project_id)).rows);
      const have = await loadPackages(req.admin, req.tenantId, line.project_id);
      const items = have.packages.map((p) => ({ id: p.id, code: p.code, name: p.name, parent_id: p.parent_id ?? null, sort_order: p.sort_order, code_is_manual: p.code_is_manual === true, owner_employee_id: p.owner_employee_id, building_code: p.building_code ?? null }));
      const memberships = lineMemberships(have.packages);
      const lines = rev ? await loadLines(req.admin, req.tenantId, rev.id) : [];
      const building = new Map(lines.map((l) => {
        const where = buildingOfLine(items, memberships.get(l.line_key) ?? { wbs_item_id: null, parts: [] });
        return [l.line_key, where.kind === "one" ? where.code : null] as const;
      }));
      state.set(line.project_id, { current: rev?.id ?? null, rev, lines, building });
    }
    const st = state.get(line.project_id)!;
    if (!st.rev || st.current !== line.revision_id) { outcomes.push({ rowNum, status: "failed", reason: "Only the open budget can be changed. Start a revision first" }); continue; }
    if (st.rev.status !== "draft") { outcomes.push({ rowNum, status: "failed", reason: st.rev.status === "pending" ? "This budget is waiting for approval and cannot be changed" : "An approved budget is locked. Start a revision first" }); continue; }
    const have = st.lines.find((l) => l.line_key === line.line_key);
    if (!have) { outcomes.push({ rowNum, status: "failed", reason: "Line not found" }); continue; }

    // Only what differs from the line is sent.
    const delta: Record<string, unknown> = {};
    if (may("element_type") && "element_type" in values && (values.element_type ?? "").trim().toUpperCase() !== (have.element_type ?? "")) delta.element_type = values.element_type?.trim() || null;
    if (may("element_code") && "element_code" in values && (values.element_code ?? "").trim().toUpperCase() !== (have.element_code ?? "")) delta.element_code = values.element_code?.trim() || null;
    if (may("model_qty") && "model_qty" in values) {
      const cell = (values.model_qty ?? "").trim();
      const was = have.model_qty == null ? "" : String(have.model_qty);
      if (cell === "" ? was !== "" : Number(cell.replace(/,/g, "")) !== Number(was || Number.NaN)) delta.model_qty = cell === "" ? null : cell.replace(/,/g, "");
    }
    const wantBuilding = may("building_code") && "building_code" in values ? (values.building_code ?? "").trim().toUpperCase() : null;
    const movesBuilding = wantBuilding !== null && wantBuilding !== "" && wantBuilding !== (st.building.get(line.line_key) ?? "");
    if (Object.keys(delta).length === 0 && !movesBuilding) { outcomes.push({ rowNum, status: "skipped", reason: "No change" }); continue; }

    if (Object.keys(delta).length > 0) {
      const done = await setLineElement(ctx, line.line_key, delta);
      if (!done.ok) { outcomes.push({ rowNum, status: "failed", reason: done.error }); continue; }
    }
    if (movesBuilding) {
      const put = await putLineInBuilding(ctx, line.line_key, wantBuilding as string);
      if (!put.ok) { outcomes.push({ rowNum, status: "failed", reason: `${put.error}${Object.keys(delta).length > 0 ? " (the other columns of this row were updated)" : ""}` }); continue; }
    }
    outcomes.push({ rowNum, status: "updated" });
  }

  return NextResponse.json(summariseUpdate(outcomes));
}
