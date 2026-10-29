import { describe, expect, it } from "vitest";
import { buildStrip, customerStrip, wholeShares } from "./visualStrip";
import { tipTextProblems } from "@/lib/infoTip";
import { VISUAL_TIPS } from "./visualTips";

const totals = {
  by_group: [
    { key: "pipes", name: "Pipes", cost: 500 },
    { key: "trench", name: "Trench", cost: 300 },
    { key: "test", name: "Testing", cost: 200 },
  ],
  by_component: { materials: 500, labour: 300, overhead: 200 },
  unpriced: ["valves"],
};

describe("the composition strip", () => {
  it("makes one bar per group, widths as shares of the cost, in the template's order", () => {
    const s = buildStrip(totals)!;
    expect(s.groups.map((g) => g.label)).toEqual(["Pipes", "Trench", "Testing"]);
    expect(s.groups.map((g) => g.pct)).toEqual([50, 30, 20]);
    expect(s.groups[0].frac).toBeCloseTo(0.5, 9);
    expect(s.total).toBe(1000);
  });

  it("shares add up to exactly 100, however awkward the split", () => {
    for (const costs of [[1, 1, 1], [333.33, 333.33, 333.34], [1, 2, 4, 8, 16, 32], [0.01, 99.99], [5], [1, 1, 1, 1, 1, 1, 1]]) {
      const s = buildStrip({ by_group: costs.map((c, i) => ({ key: `g${i}`, name: `G${i}`, cost: c })), by_component: { materials: costs[0], labour: costs[costs.length - 1] } })!;
      expect(s.groups.reduce((a, g) => a + g.pct, 0)).toBe(100);
      expect(s.components.reduce((a, g) => a + g.pct, 0)).toBe(100);
    }
    expect(wholeShares([1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(wholeShares([0, 0])).toEqual([0, 0]);
  });

  it("stacks the components, in the standard order, leaving out the empty ones", () => {
    const s = buildStrip(totals)!;
    expect(s.components.map((c) => c.key)).toEqual(["materials", "labour", "overhead"]);
    expect(s.components.map((c) => c.label)).toEqual(["Materials", "Production labour", "Factory and yard overhead"]);
  });

  it("makes a pill per unpriced line, named by its description", () => {
    const s = buildStrip(totals, [{ code: "valves", description: "Isolation valves" }, { code: "pipe", description: "Pipe" }])!;
    expect(s.unpriced).toEqual([{ code: "valves", label: "Isolation valves" }]);
    expect(buildStrip({ ...totals, unpriced: ["x", "y"] })!.unpriced.map((p) => p.label)).toEqual(["x", "y"]);
    expect(buildStrip({ ...totals, unpriced: [] })!.unpriced).toEqual([]);
  });

  it("is nothing while there is nothing to show", () => {
    expect(buildStrip(null)).toBeNull();
    expect(buildStrip({ by_group: [], by_component: {} })).toBeNull();
    expect(buildStrip({ by_group: [{ key: "a", name: "A", cost: 0 }], by_component: {} })).toBeNull();
  });

  it("ignores a negative or broken group instead of drawing it", () => {
    const s = buildStrip({ by_group: [{ key: "a", name: "A", cost: 100 }, { key: "b", name: "B", cost: -50 }, { key: "c", name: "C", cost: Number.NaN }], by_component: {} })!;
    expect(s.groups.map((g) => g.key)).toEqual(["a"]);
  });

  it("moves with the numbers: a new compute gives new shares", () => {
    const a = buildStrip(totals)!;
    const b = buildStrip({ ...totals, by_group: [{ key: "pipes", name: "Pipes", cost: 100 }, { key: "trench", name: "Trench", cost: 300 }] })!;
    expect(b.groups[0].pct).toBe(25);
    expect(a.groups[0].pct).not.toBe(b.groups[0].pct);
  });
});

describe("the customer strip", () => {
  it("keeps the groups and their share and nothing else: no amount, no component, no unpriced line", () => {
    const c = customerStrip(buildStrip(totals))!;
    expect(c.groups).toEqual([
      { key: "pipes", label: "Pipes", frac: 0.5, pct: 50 }, { key: "trench", label: "Trench", frac: 0.3, pct: 30 }, { key: "test", label: "Testing", frac: 0.2, pct: 20 },
    ]);
    const text = JSON.stringify(c);
    expect(text).not.toMatch(/amount|cost|unpriced|components|\b500\b|1000/);
    expect(customerStrip(null)).toBeNull();
  });
});

describe("the strip's explanations", () => {
  it("fit the InfoTip limit", () => {
    for (const [k, t] of Object.entries(VISUAL_TIPS)) expect(tipTextProblems(t), k).toEqual([]);
  });
});
