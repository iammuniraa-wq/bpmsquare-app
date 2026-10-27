import type { DraftLine } from "@/lib/contractProjects/types";
import { cleanShare, componentLabel, linesOfOutput, outputKey, parseOutput, resourceForComponent, round2, round4, type Basis, type EstLine } from "./rules";

// The contract project budget from the estimates that priced the BOQ (slice 3c-1, docs/design/gcc-tender-deals.md section 18, "Budget
// after award"). PURE. A BOQ line with estimate links does not get one guessed budget line; it gets the estimate's own cost lines,
// each with the resource type its cost category maps to (rules.ts RESOURCE_FOR_COMPONENT), the BOQ line's cost code and the
// estimate's real cost, so the project starts from known costs. A BOQ line with no link is not handled here: the caller keeps the
// existing "selling rate less the default margin" rule for it.
//
// Scaling. A "total" link spreads the output's cost times its share over the BOQ line: every estimate line inside keeps its unit cost
// and its quantity is multiplied by the share, so the lines add up to cost x share. A "per_unit" link is the output's cost per unit
// times the BOQ quantity: one budget line of the BOQ quantity at that cost per unit.

export type BudgetLink = { output: string; basis: Basis; share_pct: number; estimate_ref: string; changed_since: boolean };
export type BudgetEstimate = { ref: string; lines: readonly EstLine[] };
export type BudgetPartInput = {
  boqQty: number;
  links: readonly { link: BudgetLink; estimate: BudgetEstimate | null }[];
  /** The BOQ row's wording, item number and the workspace cost code it maps to (already checked against the workspace list). */
  boq: { item_no: string | null; description: string; unit: string | null; cost_code: string | null };
};
export type BudgetParts = { lines: DraftLine[]; warnings: string[]; amount: number };

/** The cost of one estimate line as the budget wants it: cost per quantity unit including waste, so quantity x cost is the line's cost. */
function effectiveUnitCost(l: EstLine): number {
  if (l.cost_total != null && Number(l.qty) > 0) return round4(Number(l.cost_total) / Number(l.qty));
  return l.unit_cost != null ? round4(Number(l.unit_cost)) : 0;
}
const known = (l: EstLine): boolean => (l.cost_total != null && Number(l.cost_total) > 0) || (l.unit_cost != null && Number(l.unit_cost) > 0);

export function budgetPartsForBoqLine(input: BudgetPartInput): BudgetParts {
  const lines: DraftLine[] = [];
  const warnings: string[] = [];
  const wbs = input.boq.item_no;
  const head = input.boq.item_no ? `${input.boq.item_no} · ` : "";

  for (const { link, estimate } of input.links) {
    const out = parseOutput(link.output);
    const share = cleanShare(link.share_pct);
    if (!estimate || !out || share === null) { warnings.push(`${link.estimate_ref}: the link could not be read`); continue; }
    const inside = linesOfOutput(out, estimate.lines).filter((l) => Number(l.qty) > 0);
    if (inside.length === 0) { warnings.push(`${link.estimate_ref}: ${outputKey(out)} is no longer in the estimate`); continue; }
    const changed = link.changed_since ? " · estimate changed since it priced the BOQ" : "";

    if (link.basis === "per_unit") {
      const one = inside[0];
      if (out.kind !== "line" || !(Number(one.qty) > 0) || !(input.boqQty > 0)) { warnings.push(`${link.estimate_ref}: a cost per unit needs one estimate line and a BOQ quantity`); continue; }
      lines.push({
        line_key: null, resource_code: resourceForComponent(one.component), cost_code: input.boq.cost_code, wbs,
        description: `${head}${one.description}`.trim().slice(0, 500) || "Line",
        qty: Math.round(input.boqQty * 1000) / 1000, unit: input.boq.unit ?? one.uom ?? null,
        unit_cost: round4((effectiveUnitCost(one) * share) / 100), cost_known: known(one),
        source_ref: `Estimate ${link.estimate_ref} · ${componentLabel(one.component)}${changed}`.slice(0, 300), reserve: false,
      });
      continue;
    }

    for (const l of inside) {
      lines.push({
        line_key: null, resource_code: resourceForComponent(l.component), cost_code: input.boq.cost_code, wbs,
        description: `${head}${l.description}`.trim().slice(0, 500) || "Line",
        qty: Math.round((Number(l.qty) * share / 100) * 1000) / 1000, unit: l.uom ?? null,
        unit_cost: effectiveUnitCost(l), cost_known: known(l),
        source_ref: `Estimate ${link.estimate_ref} · ${componentLabel(l.component)}${known(l) ? "" : " · no cost in the estimate yet"}${changed}`.slice(0, 300), reserve: false,
      });
    }
  }
  // A line with a quantity that rounds to nothing carries no money and no meaning.
  const kept = lines.filter((l) => l.qty > 0);
  return { lines: kept, warnings, amount: round2(kept.reduce((s, l) => s + l.qty * l.unit_cost, 0)) };
}
