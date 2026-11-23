import { lineMemberships } from "@/lib/contractProjects/allocation";
import { isCategoryLine, type BudgetLine, type WorkPackageRow } from "@/lib/contractProjects/types";
import { buildingOfLine, buildingsView, type BuildingItem, type ViewLine } from "./buildings";
import { budgetUses, clientQtyOf } from "./quantity";

// The buildings and element columns of the handover workbook (docs/design/pcbs-buildings-elements.md section 2.6), pure. The handover Excel is INTERNAL
// (it carries cost); these columns add nothing a person without the project could not see. They are added only when the workspace has the Buildings
// add-on, so every other workspace's workbook is exactly what it was.
//
// The F&O push (a later, separate design) takes the same fields by name: per budget line building_code, element_type, element_code, client_qty, model_qty
// and qty; per WBS item building_code. A revision goes as a revision; a reissued or struck code is sent as a change with the old code, never silently.

export const HANDOVER_ELEMENT_HEADERS = ["Building code", "Building", "Element type", "Element code", "Client qty", "Model qty", "Budget uses"] as const;
export const HANDOVER_BUILDINGS_HEADERS = ["Building code", "Building", "Lines", "Elements", "Client amount", "Budget", "Variance at client rate", "Outside tolerance"] as const;

const asItems = (packages: readonly WorkPackageRow[]): BuildingItem[] => packages.map((p) => ({
  id: p.id, code: p.code, name: p.name, parent_id: p.parent_id ?? null, sort_order: p.sort_order, code_is_manual: p.code_is_manual === true,
  owner_employee_id: p.owner_employee_id, building_code: p.building_code ?? null,
}));

export type HandoverElements = {
  /** Cells of the seven element columns, by line_key, in HANDOVER_ELEMENT_HEADERS order. */
  byKey: Map<string, (string | number)[]>;
  /** One row per building (HANDOVER_BUILDINGS_HEADERS) and a last row for the lines in no building. */
  buildings: (string | number)[][];
};

export function handoverElements(lines: readonly BudgetLine[], packages: readonly WorkPackageRow[], tolerancePct: number): HandoverElements {
  const items = asItems(packages);
  const memberships = lineMemberships(packages);
  const byId = new Map(items.map((i) => [i.id, i]));
  const byKey = new Map<string, (string | number)[]>();
  const view: ViewLine[] = [];
  for (const l of lines) {
    const m = memberships.get(l.line_key) ?? { wbs_item_id: null, parts: [] };
    const where = buildingOfLine(items, m);
    const b = where.kind === "one" ? byId.get(where.item_id) : undefined;
    const client = clientQtyOf({ client_qty: l.client_qty ?? null, qty: l.qty, client_rate: l.client_rate });
    byKey.set(l.line_key, [
      where.kind === "one" ? where.code : "", b?.name ?? "", l.element_type ?? "", l.element_code ?? "", client ?? "", l.model_qty ?? "",
      l.model_qty == null ? "" : budgetUses({ qty: l.qty, client_qty: l.client_qty ?? null, model_qty: l.model_qty, client_rate: l.client_rate }) === "model" ? "Model" : "Client",
    ]);
    view.push({
      ...m, key: l.line_key, qty: l.qty, client_amount: l.client_amount ?? 0, cost: l.allocated ? l.amount : null, client_rate: l.client_rate, element_type: l.element_type ?? null,
      element_code: l.element_code ?? null, client_qty: l.client_qty ?? null, model_qty: l.model_qty ?? null, is_category: isCategoryLine(l),
    });
  }
  const out = buildingsView(items, view, tolerancePct);
  const buildings: (string | number)[][] = out.buildings.map((r) => [r.code, r.name, r.line_count, r.element_count, r.client_amount, r.cost ?? "", r.variance_amount, r.outside_tolerance]);
  if (out.no_building.line_count > 0) buildings.push(["", "No building", out.no_building.line_count, 0, out.no_building.client_amount, "", "", ""]);
  return { byKey, buildings };
}
