import { describe, expect, it } from "vitest";
import { bidVsBudget } from "./costSnapshot";
import { costCoverage, marginHiddenText, marginIsStated } from "./marginCoverage";

const bid = [{ key: "a", amount: 800 }, { key: "b", amount: 200 }, { key: "free", amount: 0 }];

describe("how much of a bid has a cost", () => {
  it("counts priced lines only, and a line without a cost is on neither side", () => {
    const c = costCoverage(bid, [{ key: "a", cost_total: 600 }, { key: "b", cost_total: 0 }, { key: "free", cost_total: 50 }]);
    expect(c).toEqual({ cost: 600, costedAmount: 800, costedLines: 1, pricedLines: 2 });
    expect(marginHiddenText(c)).toBe("Margin not shown: cost known for 1 of 2 lines");
  });

  it("a margin is stated from 80% of the priced amount", () => {
    expect(marginIsStated(1000, 800)).toBe(true);
    expect(marginIsStated(1000, 799.99)).toBe(false);
    expect(marginIsStated(0, 0)).toBe(false);
  });
});

describe("the margin at bid on the project card follows the same rule", () => {
  const args = { bidPrice: 1000, bidCost: 150, budget: 700, contractValue: 1000 };

  it("too little of the bid costed: no margin, and the reason", () => {
    const out = bidVsBudget({ ...args, coverage: { cost: 150, costedAmount: 200, costedLines: 8, pricedLines: 43 } });
    expect(out.bid_margin_pct).toBeNull();
    expect(out.bid_margin_note).toBe("Margin not shown: cost known for 8 of 43 lines");
  });

  it("enough of it costed: the margin is over the costed part", () => {
    const out = bidVsBudget({ ...args, bidCost: 675, coverage: { cost: 675, costedAmount: 900, costedLines: 9, pricedLines: 10 } });
    expect(out.bid_margin_pct).toBe(25);
    expect(out.bid_margin_note).toBeUndefined();
  });
});
