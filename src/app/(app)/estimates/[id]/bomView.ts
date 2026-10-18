import type { EstimateLine } from "@/lib/types";
import { groupNameOf, skuOf, templateGroupNames } from "@/lib/estimator/lines";
import { readOverride } from "@/lib/estimator/overrides";

/** A line as the BOM tab draws it: slim, serialisable, group name resolved. */
export type BomLineView = {
  id: string;
  code: string | null;
  group_key: string;
  group: string;
  description: string;
  uom: string | null;
  qty: number;
  waste_pct: number;
  unit_cost: number | null;
  cost_total: number | null;
  source: "rule" | "schedule" | "manual";
  element_ref: string | null;
  sku: string | null;
  overridden: boolean;
  /** A product line with no cost yet: blocks the quote. */
  unpriced: boolean;
};

export type BomGroupView = { key: string; name: string; cost: number; lines: BomLineView[] };

export function toBomGroups(lines: readonly EstimateLine[], templateRules: readonly { group: string }[]): BomGroupView[] {
  const names = templateGroupNames(templateRules);
  const order: string[] = [];
  const map = new Map<string, BomGroupView>();
  for (const l of lines) {
    const key = l.group_key ?? "other";
    let g = map.get(key);
    if (!g) {
      g = { key, name: groupNameOf(l, names), cost: 0, lines: [] };
      map.set(key, g);
      order.push(key);
    }
    g.cost += l.cost_total ?? 0;
    g.lines.push({
      id: l.id, code: l.code, group_key: key, group: g.name, description: l.description, uom: l.uom,
      qty: l.qty, waste_pct: l.waste_pct, unit_cost: l.unit_cost, cost_total: l.cost_total,
      source: l.source, element_ref: l.element_ref, sku: skuOf(l), overridden: readOverride(l.custom_data) !== null,
      unpriced: l.qty > 0 && l.cost_total === null,
    });
  }
  return order.map((k) => map.get(k)!);
}
