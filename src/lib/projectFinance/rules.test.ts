import { describe, expect, it } from "vitest";
import {
  baselineMargin, behindOnBilling, budgetCells, buyoutAwards, cellKey, costForecast, costVariance, coverageOfLines, forecastMargin, marginAtRisk, marginBridge, marginOf,
  plannedMarginOf, ratioPct, scheduledToDate, splitKey, type BillingMilestone,
} from "./rules";
import { bridgeBars, bridgeExtent } from "./bridge";

// The design's definitions (docs/design/pcbs-project-dashboards.md section 4), one worked example: contract value 1,000,000 after an approved
// variation of 100,000 (cost 60,000); baseline budget 720,000; approved budget 800,000; buy-out awarded 280,000 against a 300,000 budget.

describe("margins", () => {
  it("ratioPct is null without a base, never 0", () => {
    expect(ratioPct(10, 0)).toBeNull();
    expect(ratioPct(null, 100)).toBeNull();
    expect(ratioPct(25, 200)).toBe(12.5);
  });
  it("marginOf: (CV - cost) / CV; a missing side gives nothing", () => {
    expect(marginOf(1000, 800)).toEqual({ amount: 200, pct: 20 });
    expect(marginOf(1000, null)).toBeNull();
    expect(marginOf(null, 800)).toBeNull();
    expect(marginOf(0, 800)).toBeNull();
  });
  it("baseline margin is (CV0 - B0) / CV0 where CV0 is the contract value less approved variations", () => {
    expect(baselineMargin({ contractValue: 1_000_000, approvedVariations: 100_000, baselineTotal: 720_000 })).toEqual({ amount: 180_000, pct: 20 });
    expect(baselineMargin({ contractValue: 1_000_000, approvedVariations: 100_000, baselineTotal: null })).toBeNull();
  });
  it("planned margin is (CV - B) / CV when every line is costed, and the margin of the costed lines only, saying so, when not", () => {
    const whole = coverageOfLines([{ client_amount: 600, amount: 500 }, { client_amount: 400, amount: 300 }]);
    expect(plannedMarginOf(1000, 800, whole)).toMatchObject({ amount: 200, pct: 20, complete: true });
    const partial = coverageOfLines([{ client_amount: 600, amount: 500 }, { client_amount: 400, amount: 0, allocated: false }]);
    expect(plannedMarginOf(1000, 500, partial)).toMatchObject({ amount: 100, pct: 16.7, complete: false, allocated: 1, of: 2 });
    const none = coverageOfLines([{ client_amount: 600, amount: 0, allocated: false }]);
    expect(plannedMarginOf(1000, 0, none)).toBeNull();
    expect(plannedMarginOf(1000, null, whole)).toBeNull();
  });
});

describe("buy-out", () => {
  it("counts only awarded and handed-over packages, with the saving against their budget", () => {
    const a = buyoutAwards([
      { status: "awarded", budget: 100_000, committed: 90_000 },
      { status: "handed_over", budget: 200_000, committed: 190_000 },
      { status: "ready", budget: 50_000, committed: null },
      { status: "out", budget: 70_000, committed: 1 },
    ]);
    expect(a).toEqual({ awarded: 280_000, saving: 20_000, packages: 2 });
  });
  it("is a real zero with nothing awarded", () => {
    expect(buyoutAwards([])).toEqual({ awarded: 0, saving: 0, packages: 0 });
  });
});

describe("cost cells", () => {
  const pkgs = [
    { id: "w1", code: "1.1", line_keys: ["a"], line_parts: [] },
    { id: "w2", code: "1.2", line_keys: [], line_parts: [{ line_key: "b", share_pct: 25 }] },
    { id: "w3", code: "1.3", line_keys: [], line_parts: [{ line_key: "b", share_pct: 50 }] },
  ];
  it("lays the approved budget out per WBS item and resource type, splits by percent and keeps the rest in the cell with no WBS", () => {
    const cells = budgetCells([
      { line_key: "a", resource_code: "11", amount: 1000 },
      { line_key: "b", resource_code: "41", amount: 400 },
      { line_key: "c", resource_code: "11", amount: 50 },
      { line_key: "d", resource_code: "11", amount: 999, allocated: false },
    ], pkgs);
    const by = Object.fromEntries(cells.map((c) => [c.key, c.budget]));
    expect(by[cellKey("1.1", "11")]).toBe(1000);
    expect(by[cellKey("1.2", "41")]).toBe(100);
    expect(by[cellKey("1.3", "41")]).toBe(200);
    expect(by[cellKey("", "41")]).toBe(100);
    expect(by[cellKey("", "11")]).toBe(50);
    expect(cells.reduce((s, c) => s + c.budget, 0)).toBe(1450);
  });
  it("a project without a WBS has one cell per resource type", () => {
    const cells = budgetCells([{ line_key: "a", resource_code: "11", amount: 10 }, { line_key: "b", resource_code: "11", amount: 5 }, { line_key: "c", resource_code: null, amount: 1 }], []);
    expect(cells.map((c) => [c.wbs_code, c.resource_code, c.budget])).toEqual([["", "", 1], ["", "11", 15]]);
  });
  it("splitKey is the inverse of cellKey", () => {
    expect(splitKey(cellKey("1.1", "11"))).toEqual({ wbs_code: "1.1", resource_code: "11" });
    expect(splitKey(cellKey("", ""))).toEqual({ wbs_code: "", resource_code: "" });
  });
});

describe("the forecast: EAC = actual + committed + estimate to go", () => {
  const cells = [{ key: cellKey("1.1", "11"), wbs_code: "1.1", resource_code: "11", budget: 500 }, { key: cellKey("1.1", "41"), wbs_code: "1.1", resource_code: "41", budget: 300 }];
  const A = new Map([[cellKey("1.1", "11"), 200], [cellKey("1.1", "41"), 100]]);
  const O = new Map([[cellKey("1.1", "11"), 150], [cellKey("1.1", "41"), 250]]);

  it("a typed estimate wins; else max(budget - actual - committed, 0), which assumes the budget holds", () => {
    const f = costForecast({ cells, actual: A, committed: O, typed: new Map([[cellKey("1.1", "11"), 90]]) });
    const m = Object.fromEntries(f.cells.map((c) => [c.resource_code, c]));
    expect(m["11"]).toMatchObject({ etg: 90, etgSource: "typed" });
    expect(m["41"]).toMatchObject({ etg: 0, etgSource: "default", overBudget: true });
    expect(f.actual).toBe(300);
    expect(f.committed).toBe(400);
    expect(f.etg).toBe(90);
    expect(f.eac).toBe(790);
    expect(f.costToComplete).toBe(490);
    expect(f.firmPct).toBe(88.6);
    expect(f.estimatePct).toBe(11.4);
    expect(f.assumedEtg).toBe(0);
  });
  it("the default estimate is what is left of the budget", () => {
    const f = costForecast({ cells, actual: new Map([[cells[0].key, 100]]), committed: new Map([[cells[0].key, 50]]), typed: new Map() });
    expect(f.cells[0]).toMatchObject({ etg: 350, etgSource: "default", overBudget: false });
    expect(f.cells[1]).toMatchObject({ actual: 0, committed: 0, etg: 300 });
    expect(f.eac).toBe(800);
    expect(f.assumedEtg).toBe(650);
  });
  it("Not connected is never a zero: no actual means no forecast, no cost to complete, and typed estimates are only kept", () => {
    const f = costForecast({ cells, actual: null, committed: O, typed: new Map([[cells[0].key, 70]]) });
    expect(f.actual).toBeNull();
    expect(f.eac).toBeNull();
    expect(f.costToComplete).toBeNull();
    expect(f.etg).toBeNull();
    expect(f.firmPct).toBeNull();
    expect(f.typedEtg).toBe(70);
    expect(f.cells[0]).toMatchObject({ actual: null, typed: 70, etg: 70, etgSource: "typed" });
    expect(f.cells[1]).toMatchObject({ etg: null, etgSource: "none" });
    const none = costForecast({ cells, actual: null, committed: null, typed: new Map() });
    expect(none.eac).toBeNull();
    expect(none.committed).toBeNull();
  });
  it("cost posted to a cell the budget does not have is an Unmapped row, shown and counted, never dropped", () => {
    const f = costForecast({ cells, actual: new Map([[cellKey("9.9", "51"), 40]]), committed: new Map(), typed: new Map() });
    const u = f.cells.find((c) => c.unmapped);
    expect(u).toMatchObject({ wbs_code: "9.9", resource_code: "51", budget: 0, actual: 40 });
    expect(f.actual).toBe(40);
  });
  it("a linked project with no cells and nothing posted has a real zero estimate", () => {
    const f = costForecast({ cells: [], actual: new Map(), committed: new Map(), typed: new Map() });
    expect(f).toMatchObject({ actual: 0, committed: 0, etg: 0, eac: 0, costToComplete: 0 });
  });
});

describe("variance, forecast margin and margin at risk", () => {
  it("cost variance is B - EAC (negative = over) and a percent of B", () => {
    expect(costVariance(800, 850)).toEqual({ amount: -50, pct: -6.2 });
    expect(costVariance(800, 700)).toEqual({ amount: 100, pct: 12.5 });
    expect(costVariance(800, null)).toBeNull();
    expect(costVariance(null, 700)).toBeNull();
  });
  it("forecast margin is (CV - EAC) / CV", () => {
    expect(forecastMargin(1000, 850)).toEqual({ amount: 150, pct: 15 });
    expect(forecastMargin(1000, null)).toBeNull();
  });
  it("margin at risk is max(0, EAC - B)", () => {
    expect(marginAtRisk(800, 850)).toBe(50);
    expect(marginAtRisk(800, 790)).toBe(0);
    expect(marginAtRisk(800, null)).toBeNull();
    expect(marginAtRisk(null, 700)).toBeNull();
  });
});

describe("margin bridge", () => {
  const args = { contractValue: 1_000_000, approvedVariations: 100_000, approvedVariationCost: 60_000, baselineTotal: 720_000, budget: 800_000, buyoutSaving: 20_000 };
  it("walks from the baseline to the forecast margin and adds up", () => {
    const steps = marginBridge({ ...args, eac: 810_000 });
    const by = Object.fromEntries(steps.map((s) => [s.id, s.amount]));
    expect(by).toEqual({
      baseline: 180_000, variation_revenue: 100_000, variation_cost: -60_000, other_revisions: -20_000, buyout_saving: 20_000, after_buyout: 220_000, execution: -30_000, forecast: 190_000,
    });
    expect(by.baseline! + by.variation_revenue! + by.variation_cost! + by.other_revisions! + by.buyout_saving!).toBe(by.after_buyout);
    expect(by.after_buyout! + by.execution!).toBe(by.forecast);
    expect(by.forecast).toBe(forecastMargin(1_000_000, 810_000)!.amount);
  });
  it("the steps up to Buy-out are real without the ERP; execution and the forecast are not known", () => {
    const steps = marginBridge({ ...args, eac: null });
    expect(steps.filter((s) => !s.needsErp).every((s) => s.amount !== null)).toBe(true);
    expect(steps.filter((s) => s.needsErp).map((s) => [s.id, s.amount])).toEqual([["execution", null], ["forecast", null]]);
  });
  it("draws a hatched step at the running level for an unknown amount, and a waterfall that starts and ends on the totals", () => {
    const bars = bridgeBars(marginBridge({ ...args, eac: null }));
    const exec = bars.find((b) => b.id === "execution")!;
    expect(exec).toMatchObject({ hatched: true, needsErp: true, from: 220_000, to: 220_000 });
    const full = bridgeBars(marginBridge({ ...args, eac: 810_000 }));
    expect(full[0]).toMatchObject({ from: 0, to: 180_000 });
    expect(full[full.length - 1]).toMatchObject({ from: 0, to: 190_000 });
    expect(bridgeExtent(full)).toEqual({ min: 0, max: 280_000 });
  });
});

describe("client billing", () => {
  const ms = (over: Partial<BillingMilestone> & { title: string; due_date: string | null }): BillingMilestone => ({ basis: "percent", percent: 10, fixed_amount: null, status: "planned", invoice_id: null, ...over });
  const now = new Date("2026-11-24T10:00:00Z");
  const list = [
    ms({ title: "Advance", due_date: "2026-10-01", percent: 20, status: "invoiced", invoice_id: "i1", invoice_status: "sent" }),
    ms({ title: "Foundations", due_date: "2026-10-25", percent: 30 }),
    ms({ title: "Draft only", due_date: "2026-11-10", basis: "fixed", percent: null, fixed_amount: 50_000, status: "invoiced", invoice_id: "i2", invoice_status: "draft" }),
    ms({ title: "Later", due_date: "2027-01-01", percent: 40 }),
    ms({ title: "No date", due_date: null, percent: 5 }),
  ];
  it("scheduled to date adds the milestones due on or before today, from the plan alone", () => {
    expect(scheduledToDate(list, 1_000_000, now)).toBe(200_000 + 300_000 + 50_000);
  });
  it("behind on billing is the due milestones without an issued invoice (a draft is not billed), oldest first", () => {
    const b = behindOnBilling(list, 1_000_000, now, true)!;
    expect(b.count).toBe(2);
    expect(b.amount).toBe(350_000);
    expect(b.oldestDays).toBe(30);
    expect(b.milestones.map((m) => m.title)).toEqual(["Foundations", "Draft only"]);
  });
  it("is not known, rather than zero, when nothing says whether anything was invoiced", () => {
    expect(behindOnBilling(list, 1_000_000, now, false)).toBeNull();
  });
  it("is a real zero when every due milestone is invoiced", () => {
    expect(behindOnBilling([list[0]], 1_000_000, now, true)).toMatchObject({ count: 0, amount: 0, oldestDays: 0 });
  });
});
