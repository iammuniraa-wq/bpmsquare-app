import { NextResponse, type NextRequest } from "next/server";
import { readImportBody } from "@/lib/import/server";
import { summariseUpdate } from "@/lib/import/updateServer";
import { allocationFor, projectDwGate } from "@/lib/import/projectElementsServer";
import { PROJECT_WBS_UPDATE_KEYS } from "@/lib/import/projectElementsSchema";
import { updatePackage, workingRevision } from "@/lib/contractProjects/allocationServer";
import { loadPackage, loadPackages } from "@/lib/contractProjects/workPackagesServer";
import { setBuildingCode } from "@/lib/elements/projectServer";
import { cleanBuildingCode } from "@/lib/elements/pattern";
import { cleanText, WBS_LIMITS } from "@/lib/wbs/tree";
import type { RowOutcome } from "@/lib/import/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const may = (key: (typeof PROJECT_WBS_UPDATE_KEYS)[number]) => PROJECT_WBS_UPDATE_KEYS.includes(key);

/**
 * Bulk-edits WBS items already on a contract project, matched by their own Record ID (the export's "id" column), never by code: a code can be retyped and
 * renumbering moves auto codes. Name, code, parent (by its code), building code and note change, through updatePackage and setBuildingCode, the writers the
 * WBS tab uses: the three-level limit, the unique code, the unique building code and the change log are the screen's own. A value that says what the item
 * already has is "No change", so an export can be edited and loaded back. An item of another workspace matches nothing.
 */
export async function POST(request: NextRequest) {
  const gate = await projectDwGate("project_wbs_items", true);
  if (!gate.ok) return gate.response;
  const { req } = gate;
  const rows = readImportBody(await request.json().catch(() => null));
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const outcomes: RowOutcome[] = [];
  for (const { rowNum, values } of rows) {
    const id = values.id?.trim();
    if (!id) { outcomes.push({ rowNum, status: "failed", reason: "Record ID is required to update a row" }); continue; }
    const row = UUID.test(id) ? await req.admin.from("project_work_packages").select("id, project_id").eq("id", id).eq("tenant_id", req.tenantId).maybeSingle() : null;
    const projectId = (row?.data as { project_id: string } | null)?.project_id;
    if (!projectId) { outcomes.push({ rowNum, status: "failed", reason: `No record with id "${id}" found in this workspace` }); continue; }
    if (!PROJECT_WBS_UPDATE_KEYS.some((k) => k in values)) { outcomes.push({ rowNum, status: "skipped", reason: "No mapped columns to update" }); continue; }
    const ctx = await allocationFor(req, projectId);
    const current = ctx ? await loadPackage(req.admin, req.tenantId, projectId, id) : null;
    if (!ctx || !current) { outcomes.push({ rowNum, status: "failed", reason: "WBS item not found" }); continue; }
    const work = await workingRevision(ctx);
    if (!work.ok) { outcomes.push({ rowNum, status: "failed", reason: work.error }); continue; }
    const all = (await loadPackages(req.admin, req.tenantId, projectId)).packages;

    const input: Record<string, unknown> = {};
    let bad: string | null = null;
    if (may("name") && "name" in values) {
      const name = cleanText(values.name, WBS_LIMITS.nameMax);
      if (!name) bad = "Give the WBS item a name"; else if (name !== current.name) input.name = name;
    }
    if (!bad && may("code") && values.code?.trim()) {
      const code = cleanText(values.code, WBS_LIMITS.codeMax);
      if (code && code !== current.code) input.code = code;
    }
    if (!bad && may("parent_code") && "parent_code" in values) {
      const pc = values.parent_code?.trim() ?? "";
      const parent = pc ? all.find((p) => p.code.toLowerCase() === pc.toLowerCase()) : null;
      if (pc && !parent) bad = `Parent WBS ${pc} does not exist on this project`;
      else if ((parent?.id ?? null) !== (current.parent_id ?? null)) input.parent_id = parent?.id ?? null;
    }
    if (!bad && may("note") && "note" in values) {
      const note = cleanText(values.note, WBS_LIMITS.noteMax);
      if (note !== (current.note ?? null)) input.note = note;
    }
    let building: { code: string | null } | null = null;
    if (!bad && may("building_code") && "building_code" in values) {
      const raw = values.building_code?.trim() ?? "";
      const want = raw ? cleanBuildingCode(raw) : null;
      if (raw && !want) bad = "A building code is 1 to 6 letters or digits";
      else if (want !== (current.building_code ?? null)) building = { code: want };
    }
    if (bad) { outcomes.push({ rowNum, status: "failed", reason: bad }); continue; }
    if (Object.keys(input).length === 0 && !building) { outcomes.push({ rowNum, status: "skipped", reason: "No change" }); continue; }
    if (Object.keys(input).length > 0) {
      const res = await updatePackage(ctx, work.work, current, input);
      if (!res.ok) { outcomes.push({ rowNum, status: "failed", reason: res.error }); continue; }
    }
    if (building) {
      const marked = await setBuildingCode(ctx, id, building.code);
      if (!marked.ok) { outcomes.push({ rowNum, status: "failed", reason: marked.error }); continue; }
    }
    outcomes.push({ rowNum, status: "updated" });
  }
  return NextResponse.json(summariseUpdate(outcomes));
}
