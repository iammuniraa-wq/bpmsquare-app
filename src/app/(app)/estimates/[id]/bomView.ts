import type { EstimateLine } from "@/lib/types";
import { groupNameOf, skuOf, templateGroupNames } from "@/lib/estimator/lines";
import { readOverride } from "@/lib/estimator/overrides";
import { lineFlags, type LineFlag, type LineProductView } from "@/lib/estimator/productItems";

/** A line as the bill of materials draws it: slim, serialisable, group name resolved. */
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
  /** The catalogue product or kit behind the line; null for a free-text or rate line. */
  product: LineProductView | null;
  /** What is wrong with the line (a product that matches nothing, no cost, a kit with a hole in it). Empty = fine. */
  flags: LineFlag[];
};

export type BomGroupView = { key: string; name: string; cost: number; lines: BomLineView[] };

export function toBomGroups(
  lines: readonly EstimateLine[], templateRules: readonly { group: string }[],
  products: Readonly<Record<string, LineProductView>> = {}
): BomGroupView[] {
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
      product: l.product_id ? (products[l.product_id] ?? null) : null,
      flags: lineFlags({ source: l.source, qty: l.qty, cost_total: l.cost_total, product_id: l.product_id, custom_data: l.custom_data }),
    });
  }
  return order.map((k) => map.get(k)!);
}
