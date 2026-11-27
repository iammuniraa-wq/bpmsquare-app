// When a bid's margin may be stated. A line without a recorded cost is NOT a line that cost nothing, so a margin is worked out only over
// the lines with a known cost, and only when they carry enough of the priced amount to speak for the tender. PURE.

export const MARGIN_MIN_COVERAGE = 0.8;

export type CostCoverage = {
  /** The cost of the priced lines that have one. */
  cost: number;
  /** The priced amount of those same lines: what the margin is taken over. */
  costedAmount: number;
  costedLines: number;
  pricedLines: number;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Matches the cost lines to the bid lines by key. A line with no price counts on neither side. */
export function costCoverage(bidLines: readonly { key: string; amount: number }[], costLines: readonly { key: string; cost_total: number }[]): CostCoverage {
  const costOf = new Map(costLines.map((l) => [l.key, l.cost_total]));
  const priced = bidLines.filter((l) => l.amount > 0);
  const costed = priced.filter((l) => (costOf.get(l.key) ?? 0) > 0);
  return {
    cost: round2(costed.reduce((s, l) => s + (costOf.get(l.key) ?? 0), 0)),
    costedAmount: round2(costed.reduce((s, l) => s + l.amount, 0)),
    costedLines: costed.length,
    pricedLines: priced.length,
  };
}

export const marginIsStated = (price: number, costedAmount: number): boolean => price > 0 && costedAmount > 0 && costedAmount / price >= MARGIN_MIN_COVERAGE - 1e-9;

export const marginHiddenText = (c: Pick<CostCoverage, "costedLines" | "pricedLines">): string => `Margin not shown: cost known for ${c.costedLines} of ${c.pricedLines} lines`;
