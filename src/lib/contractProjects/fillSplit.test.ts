import { describe, expect, it } from "vitest";
import { budgetTotals, isSplitSource, unclassifiedAmount } from "./budget";
import { costsFromBoq, costsFromSnapshot, planFill } from "./fill";
import { applyEstimateFill } from "./fillEstimate";
import { bucketsFromParts, resourceShares, splitByShares, splitItems } from "./fillSplit";
import { isCategoryLine, type BudgetLine } from "./types";
import type { CostSnapshot } from "@/lib/tender/bids/costSnapshot";
import type { EstimateBudgetInput } from "./fromTender";
import type { EstLine } from "@/lib/tender/estimates/rules";

const K = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const line = (n: number, over: Partial<BudgetLine> = {}): BudgetLine => ({
  id: `i${n}`, line_key: K(n), line_no: n, resource_code: "11", cost_code: "03", wbs: `${n}.1`, description: `Line ${n}`, qty: 10, unit: "m", unit_cost: 0, amount: 0, cost_known: true,
  source_ref: null, reserve: false, committed: null, actual: null, allocated: false, client_rate: 100, client_amount: 1000, source_line_id: `d${n}`, ...over,
});
const est = (id: string, component: string, cost_total: number, qty = 1): EstLine => ({
  id, code: null, description: `${component} item`, uom: "m", qty, waste_pct: 0, unit_cost: cost_total / qty, cost_total, component, wbs_code: null, product_id: null, custom_data: null, updated_at: null,
});
const ESTIMATE = { ref: "EST-0004", lines: [est("a", "materials", 600), est("b", "labour", 300), est("c", "transport", 100)] };
const linked = (): EstimateBudgetInput => new Map([["d1", { links: [{ link: { output: "total", basis: "total" as const, share_pct: 100, estimate_ref: "EST-0004", changed_since: false }, estimate: ESTIMATE }] }]]);
const NOT_ESTIMATE = { line_id: "d1", unit_cost: 100, price_source: "estimate", price_source_ref: "EST-0004" };

describe("a cost split by resource", () => {
  it("adds the cost lines per resource and fits the cents to the total", () => {
    const b = bucketsFromParts([
      { resource_code: "11", qty: 3, unit_cost: 33.333 }, { resource_code: "31", qty: 1, unit_cost: 50.005 }, { resource_code: "11", qty: 1, unit_cost: 0.5 },
      { resource_code: "41", qty: 2, unit_cost: 0 },
    ], 150.5);
    expect(b.map((x) => [x.code, x.label])).toEqual([["11", "Materials"], ["31", "Labour"]]);
    expect(b.reduce((s, x) => Math.round((s + x.amount) * 100) / 100, 0)).toBe(150.5);
  });

  it("shares an estimate's cost by how it spends it, and divides a recorded cost by those shares to the cent", () => {
    const shares = resourceShares(ESTIMATE.lines);
    expect(shares).toEqual([{ code: "11", pct: 60 }, { code: "31", pct: 30 }, { code: "51", pct: 10 }]);
    const parts = splitByShares(1234.57, shares);
    expect(parts.map((p) => p.amount)).toEqual([740.74, 370.37, 123.46]);
    expect(Math.round(parts.reduce((s, p) => s + p.amount, 0) * 100)).toBe(123457);
  });

  it("an estimate with no cost yet has no shares, so nothing is split", () => {
    expect(resourceShares([est("a", "materials", 0), { ...est("b", "labour", 0), cost_total: null, unit_cost: null }])).toEqual([]);
    expect(splitByShares(100, [])).toEqual([]);
    expect(splitByShares(0, [{ code: "11", pct: 100 }])).toEqual([]);
  });
});

describe("Fill from tender costs, when the tender has no bid snapshot", () => {
  it("a BOQ line linked to an estimate is filled as one cost per resource, from the estimate's own lines", () => {
    const found = costsFromBoq([line(1)], [NOT_ESTIMATE], linked());
    const f = found.get(K(1));
    expect(f && "amount" in f && f.amount).toBe(1000);
    expect(f && "amount" in f && f.buckets?.map((b) => [b.code, b.label, b.amount])).toEqual([["11", "Materials", 600], ["31", "Labour", 300], ["51", "Transport and other", 100]]);
    expect(f && "amount" in f && f.ref).toBe("Cost from estimate EST-0004");
  });

  it("a line priced from an estimate through a path that stored no link is split by that estimate's shares", () => {
    const shares = new Map([["d1", { ref: "EST-0004", shares: resourceShares(ESTIMATE.lines) }]]);
    const f = costsFromBoq([line(1)], [NOT_ESTIMATE], undefined, shares).get(K(1));
    expect(f && "amount" in f && f.amount).toBe(1000);
    expect(f && "amount" in f && f.buckets?.map((b) => b.amount)).toEqual([600, 300, 100]);
  });

  it("only a price that came from an estimate is split by shares; a supplier cost stays one figure", () => {
    const shares = new Map([["d1", { ref: "EST-0004", shares: resourceShares(ESTIMATE.lines) }]]);
    const f = costsFromBoq([line(1)], [{ line_id: "d1", unit_cost: 100, price_source: "supplier", price_source_ref: "RFQ-0004" }], undefined, shares).get(K(1));
    expect(f).toEqual({ amount: 1000, ref: "Cost from RFQ-0004" });
  });

  it("without links or shares the one recorded cost is kept, as before", () => {
    expect(costsFromBoq([line(1)], [NOT_ESTIMATE]).get(K(1))).toEqual({ amount: 1000, ref: "Cost from EST-0004" });
    expect(costsFromBoq([line(2)], [NOT_ESTIMATE]).get(K(2))).toEqual({ skip: "no recorded cost on the tender" });
  });
});

describe("Fill from tender costs, from the winning bid's snapshot", () => {
  const snapshot = (over: Partial<CostSnapshot["lines"][number]>): CostSnapshot => ({
    v: 1, warnings: [],
    lines: [{ key: "no:0", item_no: "1.1", unit_cost: null, markup_pct: null, cost_code: null, estimated: false, from_estimate: false, cost_total: 0, lines: [], ...over }],
  });
  const part = (code: string, qty: number, unit_cost: number) => ({ line_key: null, resource_code: code, cost_code: null, wbs: "1.1", description: "x", qty, unit: "m", unit_cost, cost_known: true, source_ref: "Estimate EST-0004", reserve: false });

  it("a bid line priced from an estimate keeps its split by resource", () => {
    const lines = [part("11", 10, 60), part("31", 10, 30), part("51", 10, 10)];
    const f = costsFromSnapshot([line(1)], snapshot({ from_estimate: true, cost_total: 1000, lines }), 2).get(K(1));
    expect(f && "amount" in f && f.amount).toBe(1000);
    expect(f && "amount" in f && f.buckets?.map((b) => b.code)).toEqual(["11", "31", "51"]);
  });

  it("a bid line priced any other way stays one figure", () => {
    const f = costsFromSnapshot([line(1)], snapshot({ cost_total: 700, lines: [part("11", 10, 70)] }), 2).get(K(1));
    expect(f).toMatchObject({ amount: 700 });
    expect(f && "buckets" in f).toBe(false);
  });
});

describe("the project after the fill", () => {
  const base = [line(1, { description: "HDPE pipe laid" }), line(2, { description: "Valve", source_line_id: "d2", wbs: "2.1" })];
  const found = costsFromBoq(base, [NOT_ESTIMATE, { line_id: "d2", unit_cost: 50, price_source: "supplier", price_source_ref: "RFQ-0004" }], linked());
  const byKey = new Map(base.map((l) => [l.line_key, l]));
  const plan = planFill(base, found, false);
  const split = splitItems(plan, found, byKey);
  const keys = ["k-a", "k-b"];
  const applied = applyEstimateFill(base, split, "tender", () => keys.shift() as string);

  it("only the line with an estimate is split; the supplier-priced line is left for the single recorded cost", () => {
    expect(plan.fills.map((f) => f.line_key)).toEqual([K(1), K(2)]);
    expect(split.map((s) => s.base.line_key)).toEqual([K(1)]);
  });

  it("the contract line keeps its client rate and amount and takes the first resource; the others are cost-only lines on the same item", () => {
    const [first, ...rest] = applied.lines.filter((l) => l.source_line_id === "d1");
    expect(first).toMatchObject({ line_key: K(1), resource_code: "11", amount: 600, allocated: true, client_rate: 100, client_amount: 1000, wbs: "1.1" });
    expect(rest.map((r) => [r.resource_code, r.amount, r.client_amount])).toEqual([["31", 300, 0], ["51", 100, 0]]);
    expect(rest.every((r) => r.wbs === "1.1" && r.client_rate === null)).toBe(true);
    expect(applied.made.map((m) => m.of)).toEqual([K(1), K(1)]);
  });

  it("the budget now totals the estimate's cost and its by-resource summary has three resources, not one lump", () => {
    const after = applied.lines.map((l, i) => ({ ...line(i + 1), ...l, line_key: l.line_key ?? `k${i}`, source_ref: l.source_ref ?? null } as BudgetLine));
    const totals = budgetTotals(after.filter((l) => l.source_line_id === "d1"));
    expect(totals.total).toBe(1000);
    expect(totals.byResource.map((r) => [r.code, r.amount])).toEqual([["11", 600], ["31", 300], ["51", 100]]);
  });

  it("the split lines are classified: they are never counted as Not classified", () => {
    const cost = applied.lines.filter((l) => l.source_line_id === "d1");
    expect(cost.every((l) => isSplitSource(l.source_ref))).toBe(true);
    const all = [...cost, { ...line(2), amount: 500, allocated: true, source_ref: "Cost from RFQ-0004" }];
    expect(unclassifiedAmount(all as BudgetLine[])).toBe(500);
    expect(unclassifiedAmount(cost as BudgetLine[])).toBe(0);
  });

  it("cost-only lines are never matched to the tender themselves, so a second fill does not see the item number twice", () => {
    const after = applied.lines.map((l, i) => ({ ...line(i + 1), ...l, line_key: l.line_key ?? `k${i}` } as BudgetLine));
    const contract = after.filter((l) => !isCategoryLine(l));
    expect(contract.map((l) => l.wbs)).toEqual(["1.1", "2.1"]);
    const again = planFill(contract, costsFromBoq(contract, [NOT_ESTIMATE], linked()), false);
    expect(again.skipped.map((s) => s.reason)).toContain("already allocated");
    expect(again.fills.map((f) => f.line_key)).not.toContain(K(1));
  });
});
