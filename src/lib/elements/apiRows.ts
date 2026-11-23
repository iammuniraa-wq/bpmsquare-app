import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueryableField } from "@/lib/api/query";
import { lineMemberships } from "@/lib/contractProjects/allocation";
import { currentRevision, loadLines, loadRevisions } from "@/lib/contractProjects/server";
import { loadPackages } from "@/lib/contractProjects/workPackagesServer";
import { isCategoryLine } from "@/lib/contractProjects/types";
import { buildingOfLine, type BuildingItem } from "./buildings";
import { budgetUses } from "./quantity";

// The elements of a contract project as a machine or a file sees them (the v1 API, the MCP tool, Talk to data, the Data Workbench export): one row per
// budget line of the project's current revision (the open draft, else the approved one) that is an element or sits in a building.
//
// DELIBERATELY NOT SELECTED, anywhere on these surfaces: unit_cost, amount (the allocated cost), cost_code, resource_code, source_ref, committed, actual,
// reserve and every margin figure. One loader feeds every surface so a cost cannot get in by a second route (elementsApi.test.ts holds this file to it).

export const PROJECT_ELEMENT_FIELDS: QueryableField[] = [
  { path: "id", type: "string" },
  { path: "project_id", type: "string" },
  { path: "project_ref", type: "string", searchable: true },
  { path: "revision", type: "number" },
  { path: "line_key", type: "string" },
  { path: "line_no", type: "number" },
  { path: "item_no", type: "string", searchable: true },
  { path: "description", type: "string", searchable: true },
  { path: "unit", type: "string" },
  { path: "building_code", type: "string", searchable: true },
  { path: "element_type", type: "string", searchable: true },
  { path: "element_code", type: "string", searchable: true },
  { path: "client_qty", type: "number" },
  { path: "model_qty", type: "number" },
  { path: "quantity", type: "number" },
  { path: "budget_uses", type: "string" },
];

export type ProjectElementRow = {
  id: string;
  project_id: string;
  project_ref: string | null;
  revision: number;
  line_key: string;
  line_no: number;
  item_no: string | null;
  description: string;
  unit: string | null;
  building_code: string | null;
  element_type: string | null;
  element_code: string | null;
  client_qty: number | null;
  model_qty: number | null;
  quantity: number;
  budget_uses: "client" | "model";
};

/** The element rows of one project of this workspace. Category (cost-only) lines are left out: they carry no element of their own. */
export async function loadProjectElementRows(admin: SupabaseClient, tenantId: string, projectId: string, ref: string | null): Promise<ProjectElementRow[]> {
  const revisions = await loadRevisions(admin, tenantId, projectId);
  const revision = currentRevision(revisions.rows);
  if (!revision) return [];
  const have = await loadPackages(admin, tenantId, projectId);
  if (have.pending) return [];
  const items: BuildingItem[] = have.packages.map((p) => ({ id: p.id, code: p.code, name: p.name, parent_id: p.parent_id ?? null, sort_order: p.sort_order, code_is_manual: p.code_is_manual === true, owner_employee_id: p.owner_employee_id, building_code: p.building_code ?? null }));
  const memberships = lineMemberships(have.packages);
  const out: ProjectElementRow[] = [];
  for (const l of await loadLines(admin, tenantId, revision.id)) {
    if (isCategoryLine(l)) continue;
    const where = buildingOfLine(items, memberships.get(l.line_key) ?? { wbs_item_id: null, parts: [] });
    const building = where.kind === "one" ? where.code : null;
    if (!building && !l.element_type && !l.element_code) continue;
    out.push({
      id: l.id, project_id: projectId, project_ref: ref, revision: revision.rev_no, line_key: l.line_key, line_no: l.line_no, item_no: l.wbs, description: l.description, unit: l.unit,
      building_code: building, element_type: l.element_type ?? null, element_code: l.element_code ?? null, client_qty: l.client_qty ?? null, model_qty: l.model_qty ?? null, quantity: l.qty,
      budget_uses: budgetUses({ qty: l.qty, client_qty: l.client_qty ?? null, model_qty: l.model_qty ?? null, client_rate: l.client_rate }),
    });
  }
  return out;
}
