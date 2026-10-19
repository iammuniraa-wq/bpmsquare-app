import type { BomLine, CostSource, RollUp } from "@/lib/products/bom";

// What the Components tab draws: one row per BOM line, the line's own fields
// joined with what the roll-up worked out for it. Pure, so the page and tests
// share it.

export type BomRowView = {
  lineId: string;
  componentId: string;
  name: string;
  sku: string | null;
  itemType: string | null;
  itemTypeLabel: string | null;
  qty: number;
  uom: string | null;
  scrapPct: number;
  lineKind: "consumed" | "used";
  note: string | null;
  unitCost: number | null;
  lineCost: number | null;
  source: CostSource;
  /** The nested kit's own rolled-up total, when the component is a kit with lines. */
  subTotal: number | null;
};

export function buildBomRows(
  lines: BomLine[],
  rollup: RollUp,
  typeLabel: (key: string | null | undefined) => string | null
): BomRowView[] {
  const byLine = new Map(rollup.lines.map((l) => [l.lineId, l]));
  return [...lines]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .flatMap((l) => {
      const r = byLine.get(l.id);
      if (!r) return [];
      return [{
        lineId: l.id,
        componentId: l.component_product_id,
        name: r.name,
        sku: r.sku,
        itemType: r.itemType,
        itemTypeLabel: typeLabel(r.itemType),
        qty: l.qty,
        uom: l.uom ?? null,
        scrapPct: l.scrap_pct,
        lineKind: l.line_kind,
        note: l.note ?? null,
        unitCost: r.unitCost,
        lineCost: r.lineCost,
        source: r.source,
        subTotal: r.sub ? r.sub.total : null,
      }];
    });
}
