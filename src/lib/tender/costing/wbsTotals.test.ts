import { describe, expect, it } from "vitest";
import { rollupFigures, totalOf, treeOrder, type RollLine, type TreeItem } from "@/lib/wbs/tree";
import { tipTextProblems } from "@/lib/infoTip";
import { COSTING_TIPS } from "./tips";
import { marginOf, marginText, moneyText, outsideWbs, totalsRow, totalsRows } from "./wbsTotals";

// Totals by WBS on the Costing tab (docs/design/wbs.md slice 4): bid amount, cost and margin per item, parents adding their sub-items, a split
// line counted by its shares, and a margin only when it is honest.

const item = (id: string, code: string, parent: string | null, sort: number): TreeItem => ({ id, code, name: `Item ${code}`, parent_id: parent, sort_order: sort, code_is_manual: false, owner_employee_id: null });
const ITEMS = [item("root", "1", null, 10), item("fab", "1.1", "root", 10), item("gal", "1.2", "root", 20), item("ere", "2", null, 20)];
const STAIR: RollLine = { id: "stair", qty: 337.1, amount: 141582, cost: 100000, priced: true, wbs_item_id: null, parts: [{ wbs_item_id: "fab", share_pct: 60 }, { wbs_item_id: "gal", share_pct: 15 }, { wbs_item_id: "ere", share_pct: 25 }] };
const HANDRAIL: RollLine = { id: "rail", qty: 10, amount: 8000, cost: 5000, priced: true, wbs_item_id: "fab", parts: [] };

const rowsOf = (lines: RollLine[]) => {
  const rolled = rollupFigures(ITEMS, lines);
  const ordered = treeOrder(ITEMS);
  return { rolled, rows: totalsRows(ordered, Object.fromEntries(rolled)), total: totalOf(ITEMS, rolled) };
};

describe("margin per WBS item", () => {
  it("counts a split line by its shares: 60 / 15 / 25 of the stair's bid amount and of its cost", () => {
    const { rows } = rowsOf([STAIR]);
    const by = Object.fromEntries(rows.map((r) => [r.code, r]));
    expect(by["1.1"]).toMatchObject({ bid: 84949.2, cost: 60000, margin: 24949.2, margin_pct: 29 });
    expect(by["1.2"]).toMatchObject({ bid: 21237.3, cost: 15000, margin: 6237.3, margin_pct: 29 });
    expect(by["2"]).toMatchObject({ bid: 35395.5, cost: 25000, margin: 10395.5, margin_pct: 29 });
  });

  it("a parent adds its sub-items and the total adds the top-level items, so the stair is counted once", () => {
    const { rows, total } = rowsOf([STAIR, HANDRAIL]);
    const by = Object.fromEntries(rows.map((r) => [r.code, r]));
    expect(by["1"].bid).toBeCloseTo(114186.5, 2);
    expect(by["1"].cost).toBe(80000);
    expect(total.client_amount).toBe(141582 + 8000);
    expect(total.cost).toBe(105000);
    expect(totalsRow({ id: "t", code: "", name: "Total", depth: 1 }, total)).toMatchObject({ bid: 149582, cost: 105000, margin: 44582 });
  });

  it("follows the tree order and carries the depth for the indent", () => {
    const { rows } = rowsOf([STAIR]);
    expect(rows.map((r) => [r.code, r.depth])).toEqual([["1", 1], ["1.1", 2], ["1.2", 2], ["2", 1]]);
  });

  it("gives no margin while a priced row in the item has no cost, and says how many lack one", () => {
    const noCost: RollLine = { id: "gate", qty: 1, amount: 500, cost: null, priced: true, wbs_item_id: "fab", parts: [] };
    const { rows } = rowsOf([STAIR, noCost]);
    const fab = rows.find((r) => r.code === "1.1")!;
    expect(fab).toMatchObject({ bid: 85449.2, cost: 60000, margin: null, margin_pct: null, uncosted: 1 });
    expect(rows.find((r) => r.code === "1.2")!.margin).toBe(6237.3); // the other items are not held back
    expect(rows.find((r) => r.code === "1")!.margin).toBeNull(); // the branch includes 1.1
  });

  it("an unpriced row adds nothing to the bid, and an item with no cost at all has no margin", () => {
    const unpriced: RollLine = { id: "u", qty: 1, amount: 0, cost: null, priced: false, wbs_item_id: "ere", parts: [] };
    const { rows } = rowsOf([unpriced]);
    expect(rows.find((r) => r.code === "2")).toMatchObject({ bid: 0, cost: null, margin: null, uncosted: 0 });
  });

  it("a line no longer in the latest file is not counted", () => {
    const { rows } = rowsOf([{ ...STAIR, removed: true }]);
    expect(rows.every((r) => r.bid === 0)).toBe(true);
  });

  it("marginOf is null without figures and without a bid to take a percent of", () => {
    expect(marginOf(undefined)).toBeNull();
    expect(marginOf({ part_count: 1, shared_count: 0, client_amount: 0, cost: 10, priced_count: 1, costed_count: 1 })).toEqual({ margin: -10, pct: null });
  });
});

describe("the figures as text", () => {
  it("prints money with two decimals, a dash for nothing, and the percent beside a margin", () => {
    expect(moneyText(84949.2)).toBe("84,949.20");
    expect(moneyText(null)).toBe("–");
    expect(marginText({ margin: 24949.2, margin_pct: 29 })).toBe("24,949.20 (29%)");
    expect(marginText({ margin: -50, margin_pct: -2 })).toBe("-50.00 (-2%)");
    expect(marginText({ margin: null, margin_pct: null })).toBe("–");
  });

  it("what is outside the WBS is the whole line when unassigned and the remainder of a split line", () => {
    expect(outsideWbs([])).toEqual({ rows: 0, bid: 0 });
    expect(outsideWbs([{ amount: 1000, remainder_pct: 100 }, { amount: 2000, remainder_pct: 15 }])).toEqual({ rows: 2, bid: 1300 });
  });
});

describe("the tip", () => {
  it("fits behind an i", () => {
    expect(tipTextProblems(COSTING_TIPS.wbs)).toEqual([]);
    expect(tipTextProblems(COSTING_TIPS.tab)).toEqual([]);
    expect(COSTING_TIPS.tab).toContain("whole row");
  });
});
