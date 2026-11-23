import { NextResponse, type NextRequest } from "next/server";
import { readImportBody } from "@/lib/import/server";
import { allocationFor, projectDwGate, projectsByRef } from "@/lib/import/projectElementsServer";
import { createPackage, workingRevision } from "@/lib/contractProjects/allocationServer";
import { loadPackages } from "@/lib/contractProjects/workPackagesServer";
import { setBuildingCode } from "@/lib/elements/projectServer";
import { cleanBuildingCode } from "@/lib/elements/pattern";
import { nameKey } from "@/lib/import/server";
import type { ImportResponse, RowOutcome } from "@/lib/import/types";

type Row = { rowNum: number; values: Record<string, string> };

/**
 * Adds WBS items (buildings, activities) to an existing contract project from a flat file, found by the project's reference (CPR-0001). Import only ADDS:
 * an item whose code is already on the project is left alone and said so, so loading the same file twice adds nothing; a row with no code is always a
 * new, auto-numbered item. A parent is named by its code and may be an earlier row of the same file in any order. Items are made by createPackage, the
 * writer the WBS tab uses, so the three-level limit, the 500-item limit, the unique code and the change history are the screen's own. A Building code
 * makes a top-level item a building (unique on the project). Every write is on the workspace; a project of another workspace is "not found".
 */
export async function POST(request: NextRequest) {
  const gate = await projectDwGate("project_wbs_items", true);
  if (!gate.ok) return gate.response;
  const { req } = gate;
  const rows = readImportBody(await request.json().catch(() => null)) as Row[] | null;
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const outcomes: RowOutcome[] = [];
  const projects = await projectsByRef(req.admin, req.tenantId);
  const perProject = new Map<string, Row[]>();
  for (const r of rows) {
    const ref = (r.values.project_ref ?? "").trim();
    if (!ref) { outcomes.push({ rowNum: r.rowNum, status: "failed", reason: "Project is required (its reference, CPR-0001)" }); continue; }
    const id = projects.byRef.get(nameKey(ref));
    if (!id) { outcomes.push({ rowNum: r.rowNum, status: "failed", reason: `Project "${ref}" was not found` }); continue; }
    (perProject.get(id) ?? perProject.set(id, []).get(id)!).push(r);
  }

  for (const [projectId, group] of perProject) {
    const failAll = (reason: string) => { for (const r of group) outcomes.push({ rowNum: r.rowNum, status: "failed", reason }); };
    const ctx = await allocationFor(req, projectId);
    if (!ctx) { failAll("This project could not be opened"); continue; }
    const work = await workingRevision(ctx);
    if (!work.ok) { failAll(work.error); continue; }
    const have = await loadPackages(req.admin, req.tenantId, projectId);
    if (have.pending) { failAll("The WBS needs a database update (migration 0240)"); continue; }
    const items = have.packages.map((p) => ({ id: p.id, code: p.code, building_code: p.building_code ?? null }));
    const byCode = (c: string) => items.find((i) => i.code.toLowerCase() === c.toLowerCase());

    let waiting = group.filter((r) => {
      if (r.values.name?.trim()) return true;
      outcomes.push({ rowNum: r.rowNum, status: "failed", reason: "Name is required" });
      return false;
    });
    const inFile = new Set(waiting.map((r) => r.values.code?.trim().toLowerCase()).filter((c): c is string => !!c));
    for (let pass = 0; pass < 5 && waiting.length > 0; pass++) {
      const next: Row[] = [];
      let progressed = false;
      for (const r of waiting) {
        const code = r.values.code?.trim() ?? "";
        if (code && byCode(code)) { outcomes.push({ rowNum: r.rowNum, status: "skipped", reason: `WBS ${code} is already on the project` }); progressed = true; continue; }
        const parentCode = r.values.parent_code?.trim() ?? "";
        let parentId: string | null = null;
        if (parentCode) {
          const parent = byCode(parentCode);
          if (!parent) {
            if (inFile.has(parentCode.toLowerCase())) { next.push(r); continue; }
            outcomes.push({ rowNum: r.rowNum, status: "failed", reason: `Parent WBS ${parentCode} does not exist on this project` }); progressed = true; continue;
          }
          parentId = parent.id;
        }
        const rawBuilding = r.values.building_code?.trim() ?? "";
        const building = rawBuilding ? cleanBuildingCode(rawBuilding) : null;
        if (rawBuilding && !building) { outcomes.push({ rowNum: r.rowNum, status: "failed", reason: "A building code is 1 to 6 letters or digits" }); progressed = true; continue; }
        if (building && parentId) { outcomes.push({ rowNum: r.rowNum, status: "failed", reason: "A building is a top-level item" }); progressed = true; continue; }
        if (building && items.some((i) => i.building_code === building)) { outcomes.push({ rowNum: r.rowNum, status: "failed", reason: `${building} is already a building on this project` }); progressed = true; continue; }
        const res = await createPackage(ctx, work.work, { code: code || undefined, name: r.values.name.trim(), parent_id: parentId, note: r.values.note?.trim() || null });
        progressed = true;
        if (!res.ok) { outcomes.push({ rowNum: r.rowNum, status: "failed", reason: res.error }); continue; }
        const marked = building ? await setBuildingCode(ctx, res.id, building) : null;
        outcomes.push(marked && !marked.ok ? { rowNum: r.rowNum, status: "failed", reason: `The item was added, but not as a building: ${marked.error}` } : { rowNum: r.rowNum, status: "inserted" });
        items.push({ id: res.id, code: res.code, building_code: marked && marked.ok ? building : null });
      }
      waiting = next;
      if (!progressed) break;
    }
    for (const r of waiting) outcomes.push({ rowNum: r.rowNum, status: "failed", reason: `Parent WBS ${r.values.parent_code?.trim()} could not be created first` });
  }

  outcomes.sort((a, b) => a.rowNum - b.rowNum);
  return NextResponse.json({
    inserted: outcomes.filter((o) => o.status === "inserted").length,
    skipped: outcomes.filter((o) => o.status === "skipped").length,
    failed: outcomes.filter((o) => o.status === "failed").length,
    outcomes,
  } satisfies ImportResponse);
}
