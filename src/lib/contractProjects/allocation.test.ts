import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { allocationView, parseLineAllocation, parsePackageAllocation, parseWorkPackage, spreadPackageCost, unassignedLines } from "./allocation";
import { costsFromBoq, costsFromSnapshot, planFill } from "./fill";
import { PROJECT_TIPS } from "./tips";
import type { CostSnapshot } from "@/lib/tender/bids/costSnapshot";
import type { BudgetLine, WorkPackageRow } from "./types";

const K = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const line = (n: number, over: Partial<BudgetLine> = {}): BudgetLine => ({
  id: `i${n}`, line_key: K(n), line_no: n, resource_code: "11", cost_code: "03", wbs: `${n}.1`, description: `Line ${n}`, qty: 10, unit: "m", unit_cost: 0, amount: 0, cost_known: true,
  source_ref: null, reserve: false, committed: null, actual: null, allocated: false, client_rate: 100, client_amount: 1000, source_line_id: `d${n}`, ...over,
});
const pkg = (id: string, code: string, keys: string[], over: Partial<WorkPackageRow> = {}): WorkPackageRow => ({
  id, code, name: `Package ${code}`, owner_employee_id: null, owner_name: null, allocated_cost: null, sort_order: 10, note: null, line_keys: keys, ...over,
});

describe("spreading a package's cost over its lines", () => {
  it("is in proportion to what the client pays for each line, to the cent, the last line taking the remainder", () => {
    const out = spreadPackageCost(100, [{ line_key: "a", client_amount: 100, qty: 10 }, { line_key: "b", client_amount: 200, qty: 2 }, { line_key: "c", client_amount: 300, qty: 0 }]);
    expect(out.map((o) => o.amount)).toEqual([16.67, 33.33, 50]);
    expect(out.reduce((s, o) => s + o.amount, 0)).toBeCloseTo(100, 10);
    expect(out[0].unit_cost).toBe(1.667); // 16.67 / 10
    expect(out[2].unit_cost).toBe(50); // no quantity: the amount stands for the whole line
  });

  it("shares equally when none of the lines knows a client amount, and the shares always add up exactly", () => {
    const out = spreadPackageCost(100, [1, 2, 3].map((i) => ({ line_key: String(i), client_amount: null, qty: 1 })));
    expect(out.map((o) => o.amount)).toEqual([33.33, 33.33, 33.34]);
    for (const cost of [0, 0.01, 1, 99.99, 12345.67]) {
      const s = spreadPackageCost(cost, [7, 11, 13, 17, 19].map((w, i) => ({ line_key: String(i), client_amount: w, qty: 1 })));
      expect(Math.round(s.reduce((t, o) => t + o.amount, 0) * 100), String(cost)).toBe(Math.round(cost * 100));
      expect(s.every((o) => o.amount >= 0)).toBe(true);
    }
  });

  it("a package with no lines spreads to nothing", () => {
    expect(spreadPackageCost(500, [])).toEqual([]);
  });
});

describe("lines in no package", () => {
  it("are listed, and a line sits in one package", () => {
    const lines = [line(1), line(2), line(3)];
    expect(unassignedLines(lines, [pkg("p1", "WP-1", [K(1)])]).map((l) => l.line_key)).toEqual([K(2), K(3)]);
    expect(unassignedLines(lines, [])).toHaveLength(3);
    expect(unassignedLines(lines, [pkg("p1", "WP-1", [K(1), K(2), K(3)])])).toEqual([]);
  });
});

describe("the allocation as the screen shows it", () => {
  const lines = [line(1, { allocated: true, amount: 600, unit_cost: 60 }), line(2), line(3, { client_amount: null, client_rate: null })];

  it("by BOQ line: the client amount, the allocated cost and what is left, per row and in totals", () => {
    const v = allocationView({ allocation_basis: "line", contract_value: 5000 }, lines, [], 10);
    expect(v.lineRows.map((r) => [r.item, r.client_amount, r.amount, r.allocated, r.left])).toEqual([["1.1", 1000, 600, true, 400], ["2.1", 1000, 0, false, 1000], ["3.1", null, 0, false, null]]);
    expect(v.totals).toMatchObject({ total: 600, allocatedCount: 1, unallocatedCount: 2, clientTotal: 2000 });
    expect(v.margin).toMatchObject({ amount: 4400, pct: 88, state: "ok" });
    expect(v.warnings).toEqual([]);
  });

  it("nothing allocated reads as 'none', over-allocated as red", () => {
    expect(allocationView({ allocation_basis: "line", contract_value: 5000 }, [line(1), line(2)], [], 10).margin.state).toBe("none");
    expect(allocationView({ allocation_basis: "line", contract_value: 500 }, lines, [], 10).margin.state).toBe("over");
  });

  it("by work package: one row per package with the client amount of its lines, and the unassigned lines warned", () => {
    const v = allocationView(
      { allocation_basis: "package", contract_value: 5000 }, lines,
      [pkg("p1", "WP-1", [K(1), K(2)], { allocated_cost: 600, owner_employee_id: "e1", owner_name: "Sara" })], 10,
    );
    expect(v.packageRows).toEqual([{ id: "p1", code: "WP-1", name: "Package WP-1", owner_employee_id: "e1", owner_name: "Sara", line_count: 2, items: ["1.1", "2.1"], client_amount: 2000, allocated_cost: 600, allocated: true, left: 1400 }]);
    expect(v.unassigned.map((u) => u.item)).toEqual(["3.1"]);
    expect(v.warnings).toEqual(["1 line is not in a work package"]);
  });
});

describe("a work package from a request", () => {
  const valid = new Set([K(1), K(2)]);

  it("a create needs a code and a name; trims them; takes lines of this budget only, once each", () => {
    const ok = parseWorkPackage({ code: "  WP-1 ", name: " Earthworks ", owner_employee_id: K(9), line_keys: [K(1), K(2)], note: " x " }, valid, "create");
    expect(ok).toEqual({ ok: true, value: { code: "WP-1", name: "Earthworks", owner_employee_id: K(9), line_keys: [K(1), K(2)], note: "x" } });
    expect(parseWorkPackage({ name: "x" }, valid, "create").ok).toBe(false);
    expect(parseWorkPackage({ code: "A" }, valid, "create").ok).toBe(false);
    expect(parseWorkPackage({ code: "A".repeat(30), name: "x" }, valid, "create")).toMatchObject({ ok: true, value: { code: "A".repeat(20) } });
    expect(parseWorkPackage({ code: "A", name: "x", line_keys: [K(1), K(1)] }, valid, "create")).toMatchObject({ ok: false });
    expect(parseWorkPackage({ code: "A", name: "x", line_keys: [K(5)] }, valid, "create")).toMatchObject({ ok: false });
    expect(parseWorkPackage({ code: "A", name: "x", owner_employee_id: "nope" }, valid, "create")).toMatchObject({ ok: false });
  });

  it("an edit takes any subset, and null clears the owner", () => {
    expect(parseWorkPackage({ owner_employee_id: null }, valid, "update")).toEqual({ ok: true, value: { owner_employee_id: null } });
    expect(parseWorkPackage({ name: "New" }, valid, "update")).toEqual({ ok: true, value: { name: "New" } });
    expect(parseWorkPackage({ name: "" }, valid, "update").ok).toBe(false);
    expect(parseWorkPackage({}, valid, "update")).toEqual({ ok: true, value: {} });
  });
});

describe("the allocation from a request", () => {
  it("a line cost is a number from 0 up, null or empty clears it, a line may appear once", () => {
    expect(parseLineAllocation([{ line_key: K(1), amount: "12.345" }, { line_key: K(2), amount: null }, { line_key: K(3), amount: "" }])).toEqual({
      ok: true, rows: [{ line_key: K(1), amount: 12.35 }, { line_key: K(2), amount: null }, { line_key: K(3), amount: null }],
    });
    for (const bad of ["x", [{ line_key: "nope", amount: 1 }], [{ line_key: K(1), amount: -1 }], [{ line_key: K(1), amount: "abc" }], [{ line_key: K(1), amount: 1 }, { line_key: K(1), amount: 2 }], [{ line_key: K(1), amount: 1e15 }]]) {
      expect(parseLineAllocation(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("a package cost works the same", () => {
    expect(parsePackageAllocation([{ id: K(1), allocated_cost: 5 }, { id: K(2), allocated_cost: null }])).toEqual({ ok: true, rows: [{ id: K(1), allocated_cost: 5 }, { id: K(2), allocated_cost: null }] });
    expect(parsePackageAllocation([{ id: "x", allocated_cost: 5 }]).ok).toBe(false);
    expect(parsePackageAllocation([{ id: K(1), allocated_cost: -5 }]).ok).toBe(false);
    expect(parsePackageAllocation("x").ok).toBe(false);
  });
});

describe("Fill from tender costs", () => {
  const snapshot = (lines: Partial<CostSnapshot["lines"][number]>[]): CostSnapshot => ({
    v: 1, warnings: [],
    lines: lines.map((l, i) => ({ key: `no:${i}`, item_no: null, unit_cost: null, markup_pct: null, cost_code: null, estimated: false, from_estimate: false, cost_total: 0, lines: [], ...l })),
  });
  const priced = (item: string, total: number, ref = "Cost from RFQ-0004") => ({ item_no: item, unit_cost: total / 10, cost_total: total, lines: [{ line_key: null, resource_code: "11", cost_code: null, wbs: item, description: "x", qty: 10, unit: "m", unit_cost: total / 10, cost_known: true, source_ref: ref, reserve: false }] });

  it("from the winning bid's recorded cost, matched on the item number; a line with none is listed with the reason", () => {
    const lines = [line(1), line(2), line(3)];
    const found = costsFromSnapshot(lines, snapshot([priced("1.1", 600), { item_no: "2.1", estimated: true }]), 2);
    expect(found.get(K(1))).toEqual({ amount: 600, ref: "Cost from bid v2 (RFQ-0004)" });
    expect(found.get(K(2))).toEqual({ skip: "no recorded cost in bid v2" });
    expect(found.get(K(3))).toEqual({ skip: "no recorded cost in bid v2" });
    const plan = planFill(lines, found, false);
    expect(plan.fills).toEqual([{ line_key: K(1), amount: 600, ref: "Cost from bid v2 (RFQ-0004)" }]);
    expect(plan.skipped).toEqual([{ item: "2.1", reason: "no recorded cost in bid v2" }, { item: "3.1", reason: "no recorded cost in bid v2" }]);
  });

  it("a cost from an estimate counts, and says so", () => {
    const found = costsFromSnapshot([line(1)], snapshot([{ ...priced("1.1", 750), from_estimate: true }]), 1);
    expect(found.get(K(1))).toEqual({ amount: 750, ref: "Cost from bid v1 (estimate)" });
  });

  it("an item number that is not unique is skipped, not guessed", () => {
    const two = costsFromSnapshot([line(1)], snapshot([priced("1.1", 600), priced("1.1", 700)]), 1);
    expect(two.get(K(1))).toEqual({ skip: "item number not unique" });
    const twice = costsFromSnapshot([line(1), line(1, { line_key: K(9) })], snapshot([priced("1.1", 600)]), 1);
    expect(twice.get(K(1))).toEqual({ skip: "item number not unique" });
  });

  it("without a bid snapshot the tender's BOQ rows count, but only a cost above zero, matched on the line the budget line came from", () => {
    const found = costsFromBoq([line(1), line(2), line(3)], [
      { line_id: "d1", unit_cost: 120, price_source: "supplier", price_source_ref: "RFQ-0004" }, { line_id: "d2", unit_cost: 0, price_source: null, price_source_ref: null }, { line_id: "d3", unit_cost: null, price_source: null, price_source_ref: null },
    ]);
    expect(found.get(K(1))).toEqual({ amount: 1200, ref: "Cost from RFQ-0004" });
    expect(found.get(K(2))).toEqual({ skip: "no recorded cost on the tender" });
    expect(found.get(K(3))).toEqual({ skip: "no recorded cost on the tender" });
  });

  it("what is already allocated is kept unless the person confirms a replace", () => {
    const lines = [line(1, { allocated: true, amount: 500 })];
    const found = costsFromBoq(lines, [{ line_id: "d1", unit_cost: 120, price_source: null, price_source_ref: null }]);
    expect(planFill(lines, found, false)).toEqual({ fills: [], skipped: [{ item: "1.1", reason: "already allocated" }] });
    expect(planFill(lines, found, true).fills).toHaveLength(1);
  });
});

describe("the tips of this slice fit the InfoTip limit", () => {
  it("every text is two sentences and 160 characters at most", () => {
    for (const key of ["allocateBy", "fill", "workBreakdown", "allocated", "left", "packageOwner", "unitCost", "fromTender", "attention", "plannedMargin"] as const) {
      expect(tipTextProblems(PROJECT_TIPS[key]), key).toEqual([]);
    }
  });
});
