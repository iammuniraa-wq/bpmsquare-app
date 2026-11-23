import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { allocationView } from "./allocation";
import { applyEstimateFill, estimateGroups, fillRef, isFilled, planEstimateFill, type EstimateLineIn } from "./fillEstimate";
import { isCategoryLine, type BudgetLine } from "./types";
import { LinesTable } from "@/components/contractProjects/AllocationTable";
import { PROJECT_TIPS } from "./tips";
import { tipTextProblems } from "@/lib/infoTip";

// "Fill from estimate costs": the pure rules (matching by name, the split by category, what counts as a line a person changed) and how the
// Budget table shows a split line. The routes are covered in quoteSource.routes.test.ts.

const el = (over: Partial<EstimateLineIn>): EstimateLineIn => ({ description: "Item", uom: "m3", qty: 1, waste_pct: 0, group_key: "g", custom_data: { group: "Walls" }, component: "materials", cost_total: 100, ...over });
const line = (over: Partial<BudgetLine> = {}): BudgetLine => ({
  id: "i1", line_key: "k1", line_no: 1, resource_code: "11", cost_code: null, wbs: "1", description: "Walls", qty: 2, unit: "lot", unit_cost: 0, amount: 0, cost_known: true, source_ref: null, reserve: false,
  committed: null, actual: null, allocated: false, client_rate: 500, client_amount: 1000, source_line_id: "q1", ...over,
});
const names = new Map<string, string>();

describe("the estimate's quote lines", () => {
  it("by group: one entry per group key, named as the quote names it, cost by category with transport, overhead and other together", () => {
    const g = estimateGroups([el({ cost_total: 100 }), el({ component: "labour", cost_total: 40 }), el({ component: "transport", cost_total: 5 }), el({ component: "overhead", cost_total: 7 }), el({ group_key: "h", custom_data: { group: "Roof" }, cost_total: 9 })], names, "group");
    expect(g.map((x) => x.description)).toEqual(["Walls", "Roof"]);
    expect(g[0].buckets).toEqual([{ code: "11", label: "Materials", amount: 100 }, { code: "31", label: "Labour", amount: 40 }, { code: "51", label: "Transport and other", amount: 12 }]);
    expect(g[0].total).toBe(152);
  });

  it("by line: named 'description (quantity unit)' like the quote prints it, waste included", () => {
    const g = estimateGroups([el({ description: "Panel", qty: 10, waste_pct: 10, uom: "m2" })], names, "line");
    expect(g[0].description).toBe("Panel (11 m2)");
  });

  it("counts a line with no cost as unpriced, and ignores lines of no quantity", () => {
    const g = estimateGroups([el({ cost_total: null }), el({ qty: 0, cost_total: 50 })], names, "group");
    expect(g[0]).toMatchObject({ unpriced: 1, total: 0, buckets: [] });
  });
});

describe("what is matched, and what is listed", () => {
  const groups = estimateGroups([el({}), el({ component: "labour", cost_total: 30 })], names, "group");
  const plan = (lines: BudgetLine[], option: string[] = []) => planEstimateFill({ lines, groups, optionLineIds: new Set(option) });

  it("matches on the name, and lists everything else with its reason", () => {
    const p = plan([line(), line({ line_key: "k2", description: "Unknown", source_line_id: "q2", wbs: "2" })]);
    expect(p.fills.map((f) => f.base.line_key)).toEqual(["k1"]);
    expect(p.skipped).toEqual([{ item: "2", reason: "matches nothing in the estimate" }]);
  });

  it("an option of an alternative quote is never matched, and a name used twice is not guessed", () => {
    expect(plan([line()], ["q1"]).skipped).toEqual([{ item: "1", reason: "is an option of an alternative quote" }]);
    const twice = plan([line(), line({ line_key: "k2", source_line_id: "q2" })]);
    expect(twice.fills).toHaveLength(0);
    expect(twice.skipped).toHaveLength(2);
  });

  it("a group with a line that has no cost yet is not filled with a part of its cost", () => {
    const g = estimateGroups([el({}), el({ cost_total: null })], names, "group");
    expect(planEstimateFill({ lines: [line()], groups: g, optionLineIds: new Set() }).skipped).toEqual([{ item: "1", reason: "1 estimate line has no cost yet" }]);
  });
});

describe("the split", () => {
  const groups = estimateGroups([el({ cost_total: 100.5 }), el({ component: "labour", cost_total: 30 }), el({ component: "erection", cost_total: 20 })], names, "group");
  let n = 0;
  const key = () => `new${++n}`;
  const run = (lines: BudgetLine[]) => {
    const p = planEstimateFill({ lines, groups, optionLineIds: new Set() });
    return applyEstimateFill(lines, p.fills, "EST-1", key);
  };

  it("keeps the contract line (its key, client rate and amount, item) and adds a cost-only line per further category right after it", () => {
    const out = run([line(), line({ line_key: "k9", description: "Other", source_line_id: "q9", wbs: "9" })]);
    expect(out.lines.map((l) => l.line_key)).toEqual(["k1", "new1", "new2", "k9"]);
    expect(out.lines[0]).toMatchObject({ resource_code: "11", amount: 100.5, allocated: true, client_rate: 500, client_amount: 1000, wbs: "1", source_line_id: "q1" });
    expect(out.lines[1]).toMatchObject({ resource_code: "31", amount: 30, client_rate: null, client_amount: 0, wbs: "1", source_line_id: "q1", description: "Walls · Labour" });
    expect(out.lines.reduce((s, l) => s + (l.client_amount ?? 0), 0)).toBe(2000); // the two contract lines, as before
    expect(out.lines.reduce((s, l) => s + (l.allocated ? Number(l.amount) : 0), 0)).toBe(150.5);
    expect(out.made.map((m) => m.of)).toEqual(["k1", "k1"]);
  });

  it("a second run reuses the keys of the lines it wrote and drops none", () => {
    const first = run([line()]).lines.map((d, i) => line({ ...d, id: `i${i}`, line_key: d.line_key as string, line_no: i + 1, amount: d.amount ?? 0, allocated: d.allocated !== false, client_rate: d.client_rate ?? null, client_amount: d.client_amount ?? null, source_ref: d.source_ref, resource_code: d.resource_code }));
    const second = run(first);
    expect(second.lines.map((l) => l.line_key)).toEqual(first.map((l) => l.line_key));
    expect(second.made).toEqual([]);
    expect(second.dropped).toEqual([]);
  });

  it("only a line the fill wrote, untouched, counts as its own", () => {
    const ref = fillRef("EST-1", "Labour", 30);
    expect(isFilled({ source_ref: ref, amount: 30, allocated: true })).toBe(true);
    expect(isFilled({ source_ref: ref, amount: 31, allocated: true })).toBe(false);
    expect(isFilled({ source_ref: "Cost from RFQ-1", amount: 30, allocated: true })).toBe(false);
    expect(isCategoryLine({ source_line_id: "q1", client_rate: null, client_amount: 0 })).toBe(true);
    expect(isCategoryLine({ source_line_id: null, client_rate: null, client_amount: null })).toBe(false);
  });
});

describe("the Budget table shows a split line once", () => {
  const base = line({ allocated: true, amount: 100, unit_cost: 50 });
  const extra = line({ id: "i2", line_key: "k2", line_no: 2, description: "Walls · Labour", resource_code: "31", allocated: true, amount: 30, client_rate: null, client_amount: 0 });
  const view = allocationView({ allocation_basis: "line", contract_value: 1000 }, [base, extra], [], null);

  it("the view ties the category line to its contract line and counts both in what is left", () => {
    expect(view.lineRows[1].extra_of).toBe("k1");
    expect(view.lineRows[0].extra_of).toBeNull();
    expect(view.lineRows[0].left).toBe(870);
    expect(view.lineRows[1].left).toBeNull();
  });

  it("collapsed by default: one row with the group's cost and 'Cost by category', no sub-row, the explanation behind the i", () => {
    const html = renderToString(createElement(LinesTable, { rows: view.lineRows, typed: { k1: "100", k2: "30" }, onType: () => {}, editable: true, currency: "SAR", onOpen: () => {}, resourceNames: { "11": "Materials", "31": "Labour" } })).replace(/<!-- -->/g, "");
    expect(html).toContain("Cost by category (2)");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("cp.alloc.category_row");
    expect(html).toContain("130.00");
    expect(html).not.toContain(PROJECT_TIPS.costByCategory);
  });
});

describe("the explanations", () => {
  it.each([["fillEstimate", PROJECT_TIPS.fillEstimate], ["costByCategory", PROJECT_TIPS.costByCategory]])("%s fits behind an i", (_k, text) => {
    expect(tipTextProblems(text)).toEqual([]);
  });
});
