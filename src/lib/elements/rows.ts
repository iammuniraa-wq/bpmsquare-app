import { partsOf, type Membership } from "@/lib/wbs/tree";
import { buildingOfLine, buildingsView, isBuilding, type BuildingItem, type BuildingsView, type ViewLine } from "./buildings";
import { insidePattern, parsePattern, type PatternPart } from "./pattern";
import { budgetUses, clientQtyOf, toleranceBand, varianceOf, type BudgetUses, type QtyBand } from "./quantity";
import type { ElementsSettings } from "./types";

// One shape for the lines of a tender and of a project, so the Buildings view, the element table and the tests do not care where the rows are
// stored. Pure. The two servers map their rows into NeutralLine; everything below is shared.

/** A line of a tender BOQ or of a project budget, in the words this feature needs. */
export type NeutralLine = Membership & {
  /** The BOQ row id (tender) or the line_key (project): what a request names the line by. */
  key: string;
  line_no: number;
  /** The client's item number, when there is one. */
  ref: string | null;
  description: string;
  unit: string | null;
  /** The budget quantity on a project; the file quantity on a tender. */
  qty: number;
  client_qty: number | null;
  model_qty: number | null;
  client_rate: number | null;
  client_amount: number;
  cost: number | null;
  element_type: string | null;
  element_code: string | null;
  is_category?: boolean;
  removed?: boolean;
};

/** What the element table and the element panel show per line. No cost, no margin: nothing here is internal. */
export type ElementLineRow = {
  key: string;
  line_no: number;
  ref: string | null;
  description: string;
  unit: string | null;
  qty: number;
  client_qty: number | null;
  model_qty: number | null;
  element_type: string | null;
  element_code: string | null;
  building_code: string | null;
  building_name: string | null;
  /** A cost-only category line: it has no code of its own and inherits through its contract line. */
  is_category: boolean;
  uses: BudgetUses;
  variance_qty: number | null;
  variance_pct: number | null;
  band: QtyBand;
  /** A code the client typed or imported that the workspace pattern could not have made: an amber chip, not an error. */
  outside_pattern: boolean;
  /** The line is split across buildings (it cannot carry an element code until it is whole). */
  mixed: boolean;
};

export function toViewLines(lines: readonly NeutralLine[]): ViewLine[] {
  return lines.map((l) => ({
    wbs_item_id: l.wbs_item_id, parts: l.parts, key: l.key, qty: l.qty, client_amount: l.client_amount, cost: l.cost, client_rate: l.client_rate,
    element_type: l.element_type, element_code: l.element_code, client_qty: l.client_qty, model_qty: l.model_qty, is_category: l.is_category, removed: l.removed,
  }));
}

export function buildElementRows(items: readonly BuildingItem[], lines: readonly NeutralLine[], settings: Pick<ElementsSettings, "pattern" | "qty_tolerance_pct">, project: string | null = null): ElementLineRow[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const parsed = parsePattern(settings.pattern);
  const parts: PatternPart[] | null = parsed.ok ? parsed.parts : null;
  return lines.filter((l) => !l.removed).map((l) => {
    const where = buildingOfLine(items, l);
    const b = where.kind === "one" ? byId.get(where.item_id) ?? null : null;
    const client = clientQtyOf({ client_qty: l.client_qty, qty: l.qty, client_rate: l.client_rate });
    const v = client !== null && l.model_qty !== null ? varianceOf(client, l.model_qty, l.client_rate ?? 0) : null;
    return {
      key: l.key, line_no: l.line_no, ref: l.ref, description: l.description, unit: l.unit, qty: l.qty, client_qty: client, model_qty: l.model_qty,
      element_type: l.element_type, element_code: l.element_code, building_code: b && isBuilding(b) ? b.building_code : null, building_name: b?.name ?? null,
      is_category: l.is_category === true, uses: budgetUses({ qty: l.qty, client_qty: l.client_qty, model_qty: l.model_qty, client_rate: l.client_rate }),
      variance_qty: v?.qty ?? null, variance_pct: v?.pct ?? null, band: v ? toleranceBand(v.pct, settings.qty_tolerance_pct) : "none",
      outside_pattern: !!l.element_code && !!parts && !insidePattern(parts, l.element_code, project),
      mixed: where.kind === "mixed",
    };
  });
}

export type BuildingsPayload = {
  view: BuildingsView;
  rows: ElementLineRow[];
  /** How many lines have a building and a type but no code yet: what "Issue codes" would do. */
  issuable: number;
  /** How many lines are in a building but have no element type (so no code can be issued for them). */
  untyped: number;
};

export function buildPayload(items: readonly BuildingItem[], lines: readonly NeutralLine[], settings: Pick<ElementsSettings, "pattern" | "qty_tolerance_pct">, project: string | null = null): BuildingsPayload {
  const view = buildingsView(items, toViewLines(lines), settings.qty_tolerance_pct);
  const rows = buildElementRows(items, lines, settings, project);
  const real = rows.filter((r) => !r.is_category);
  return {
    view, rows,
    issuable: real.filter((r) => !r.element_code && r.element_type && r.building_code).length,
    untyped: real.filter((r) => r.building_code && !r.element_type && !r.element_code).length,
  };
}

/** Lines held by an item or anything below it: a building with any may not be removed. */
export function linesUnder(items: readonly BuildingItem[], lines: readonly Pick<NeutralLine, "wbs_item_id" | "parts" | "removed">[], itemId: string): number {
  const ids = new Set<string>([itemId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const i of items) if (i.parent_id && ids.has(i.parent_id) && !ids.has(i.id)) { ids.add(i.id); grew = true; }
  }
  return lines.filter((l) => !l.removed && partsOf(l).some((p) => ids.has(p.wbs_item_id))).length;
}
