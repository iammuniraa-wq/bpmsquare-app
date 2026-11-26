import { round2, round4 } from "./budget";
import { CATEGORY_LABEL, type Bucket, type FillItem } from "./fillEstimate";
import type { Found } from "./fill";
import type { BudgetLine, DraftLine } from "./types";
import { resourceForComponent, type EstLine } from "@/lib/tender/estimates/rules";

// The split of a cost by resource (material, labour, plant, subcontract, other) for "Fill from tender costs", pure (docs/design/gcc-tender-deals.md,
// "Budget after award"). The fill used to write ONE lump per BOQ line on the default resource, so a tender priced from estimates came out of
// the project as one Material figure and the by-resource summary read "Not classified". Two readings give the split:
//   parts   the estimate cost lines of a BOQ line that is linked to an estimate, each with the resource its cost category maps to
//   shares  a BOQ line that carries an estimate as its price source but no link row (priced by a path that did not store one): its recorded
//           cost, divided in the proportions the estimate itself spends on each resource
// Nothing is guessed: a line with neither keeps the single recorded cost.

export type ResourceShare = { code: string; pct: number };
export type EstimateShares = { ref: string; shares: readonly ResourceShare[] };

const labelOf = (code: string): string => CATEGORY_LABEL[code] ?? "Other";

/** The amounts in `raw` rounded to cents so that they add up to `total` exactly: the rounding difference goes to the largest one. */
function fitTo(total: number, raw: readonly { code: string; amount: number }[]): Bucket[] {
  const rounded = raw.map((b) => ({ code: b.code, label: labelOf(b.code), amount: round2(b.amount) })).filter((b) => b.amount > 0);
  if (rounded.length === 0) return [];
  const drift = round2(total - rounded.reduce((s, b) => s + b.amount, 0));
  if (drift !== 0) {
    const biggest = rounded.reduce((m, b) => (b.amount > m.amount ? b : m), rounded[0]);
    biggest.amount = round2(biggest.amount + drift);
  }
  return rounded.filter((b) => b.amount > 0).sort((a, b) => a.code.localeCompare(b.code));
}

/** The cost lines of a bid line or a linked BOQ line, added up per resource. Lines with no known cost carry no money and are left out. */
export function bucketsFromParts(lines: readonly Pick<DraftLine, "resource_code" | "qty" | "unit_cost">[], total?: number): Bucket[] {
  const sums = new Map<string, number>();
  for (const l of lines) {
    const amount = Number(l.qty) * Number(l.unit_cost);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const code = l.resource_code || "51";
    sums.set(code, (sums.get(code) ?? 0) + amount);
  }
  const raw = [...sums].map(([code, amount]) => ({ code, amount }));
  const sum = round2(raw.reduce((s, b) => s + b.amount, 0));
  return fitTo(total !== undefined && Number.isFinite(total) ? round2(total) : sum, raw);
}

/** How an estimate spends its cost across the resources, as percentages that add up to 100. Empty when the estimate has no cost yet. */
export function resourceShares(lines: readonly Pick<EstLine, "component" | "cost_total" | "unit_cost" | "qty">[]): ResourceShare[] {
  const sums = new Map<string, number>();
  for (const l of lines) {
    const cost = l.cost_total != null ? Number(l.cost_total) : Number(l.unit_cost ?? 0) * Number(l.qty ?? 0);
    if (!Number.isFinite(cost) || cost <= 0) continue;
    const code = resourceForComponent(l.component);
    sums.set(code, (sums.get(code) ?? 0) + cost);
  }
  const total = [...sums.values()].reduce((s, v) => s + v, 0);
  if (!(total > 0)) return [];
  return [...sums].map(([code, v]) => ({ code, pct: round4((v / total) * 100) })).sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * The lines whose cost came from an estimate, as the fill items that write one budget line per resource. Each item says where the cost came
 * from; the contract line keeps its client rate and amount, its key and its WBS item.
 */
export function splitItems(plan: { fills: readonly { line_key: string }[] }, found: ReadonlyMap<string, Found>, byKey: ReadonlyMap<string, BudgetLine>): FillItem[] {
  const items: FillItem[] = [];
  for (const f of plan.fills) {
    const hit = found.get(f.line_key);
    const base = byKey.get(f.line_key);
    if (base && hit && "amount" in hit && hit.buckets && hit.buckets.length > 0) items.push({ base, buckets: hit.buckets, ref: hit.ref });
  }
  return items;
}

/** A recorded cost divided by the shares. The buckets add up to the cost exactly. */
export function splitByShares(total: number, shares: readonly ResourceShare[]): Bucket[] {
  if (!(total > 0) || shares.length === 0) return [];
  return fitTo(total, shares.map((s) => ({ code: s.code, amount: (total * s.pct) / 100 })));
}
