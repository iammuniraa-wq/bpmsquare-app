import { DEFAULT_RESOURCE_CODE, type DraftLine } from "@/lib/contractProjects/types";
import type { BoqInfo, DealLine, EstimateBudgetInput } from "@/lib/contractProjects/fromTender";
import { budgetPartsForBoqLine } from "@/lib/tender/estimates/budgetParts";

// The cost lines behind a tender's bid, pure (docs/design/gcc-tender-deals.md section 23). For each deal line: the cost the estimates that
// priced it give (by resource, real costs), else the cost recorded on its BOQ row, else NOTHING. The cost is never guessed (KAMCO feedback,
// 2026-10-29): a line with no recorded cost has no cost lines and is counted in `estimated` ("no cost recorded"). The bid version's cost
// snapshot freezes these at submit; "Fill from tender costs" on a contract project reads them back.

export type CostMapping = {
  lines: DraftLine[];
  /** Deal lines with no recorded cost at all (the field keeps its old name: older snapshots stored it). */
  estimated: number;
  /** Cost codes the BOQ carried that the workspace's list does not hold. */
  unmappedCodes: string[];
  skipped: number;
  /** Deal lines whose cost came from the estimate that priced them. */
  fromEstimate: number;
  /** Things worth saying about those lines (an estimate output that is gone, a cost the estimate does not have yet). */
  estimateWarnings: string[];
};

export function mapTenderToCostLines(args: {
  lines: readonly DealLine[];
  boq: ReadonlyMap<string, BoqInfo>;
  costCodes: ReadonlySet<string>;
  estimates?: EstimateBudgetInput;
}): CostMapping {
  const byLower = new Map([...args.costCodes].map((c) => [c.trim().toLowerCase(), c]));
  const out: DraftLine[] = [];
  const unmapped = new Set<string>();
  let estimated = 0, skipped = 0, fromEstimate = 0;
  const estimateWarnings: string[] = [];
  for (const l of args.lines) {
    if (l.is_selected === false || l.break_of) { skipped++; continue; }
    const info = args.boq.get(l.id);
    const qty = Number(l.qty) || 0;
    const given = info?.cost_code?.trim() || null;
    const code = given ? byLower.get(given.toLowerCase()) ?? null : null;
    if (given && !code) unmapped.add(given);

    const linked = args.estimates?.get(l.id);
    if (linked && linked.links.length > 0) {
      const parts = budgetPartsForBoqLine({
        boqQty: qty, links: linked.links,
        boq: { item_no: info?.item_no ?? l.sl_no, description: (l.description || "").trim(), unit: l.uom?.trim() ? l.uom.trim().slice(0, 30) : null, cost_code: code },
      });
      estimateWarnings.push(...parts.warnings);
      if (parts.lines.length > 0) {
        out.push(...parts.lines);
        fromEstimate++;
        continue;
      }
    }
    const recorded = info?.unit_cost != null && Number(info.unit_cost) > 0 ? Number(info.unit_cost) : null;
    if (recorded === null) { estimated++; continue; }
    out.push({
      line_key: null,
      resource_code: DEFAULT_RESOURCE_CODE,
      cost_code: code,
      wbs: info?.item_no ?? l.sl_no ?? null,
      description: (l.description || "").trim().slice(0, 500) || "Line",
      qty: Math.round(qty * 1000) / 1000,
      unit: l.uom?.trim() ? l.uom.trim().slice(0, 30) : null,
      unit_cost: recorded,
      cost_known: true,
      source_ref: `Cost from ${info?.price_source_ref || info?.price_source || "the tender price"}`.slice(0, 300),
      reserve: false,
    });
  }
  return { lines: out, estimated, unmappedCodes: [...unmapped].sort(), skipped, fromEstimate, estimateWarnings };
}
