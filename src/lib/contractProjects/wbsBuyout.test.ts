import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { WBS_TIPS } from "@/lib/wbs/tips";
import type { BudgetLine, WorkPackageRow } from "./types";
import { wbsBuyoutPrefill } from "./wbsBuyout";

// "Make buy-out package" on a WBS item (docs/design/wbs.md section 4): which approved budget lines the panel ticks, which it shows as taken,
// and how a split line is offered.

const K = (n: number) => `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, "0")}`;
const line = (n: number, over: Partial<BudgetLine> = {}): BudgetLine => ({
  id: `rev-${n}`, line_key: K(n), line_no: n, resource_code: "11", cost_code: "03", wbs: `2.${n}`, description: `Line ${n}`, qty: 10, unit: "m", unit_cost: 100, amount: 1000, cost_known: true,
  source_ref: null, reserve: false, committed: null, actual: null, allocated: true, client_rate: 120, client_amount: 1200, source_line_id: null, ...over,
});
const item = (id: string, code: string, parent: string | null, over: Partial<WorkPackageRow> = {}): WorkPackageRow => ({
  id, code, name: `Name ${code}`, owner_employee_id: null, owner_name: null, allocated_cost: null, sort_order: Number(code.replace(/\D/g, "")) * 10, note: null, line_keys: [], parent_id: parent, line_parts: [], ...over,
});

const LINES = [line(1), line(2), line(3), line(4), line(5)];
const ITEMS = [
  item("steel", "1", null),
  item("fab", "1.1", "steel", { line_keys: [K(2)], line_parts: [{ line_key: K(1), share_pct: 60 }] }),
  item("gal", "1.2", "steel", { line_keys: [K(3)], line_parts: [{ line_key: K(1), share_pct: 40 }] }),
  item("civil", "2", null, { line_keys: [K(4)] }),
];
const free = (...ns: number[]) => ns.map((n) => ({ id: `ap-${n}`, line_key: K(n) }));

describe("the prefill for a buy-out package", () => {
  it("takes the item's name and the approved ids of its lines, in budget order", () => {
    const p = wbsBuyoutPrefill(ITEMS[1], ITEMS, LINES, { unassigned_lines: free(1, 2, 3, 4) });
    expect(p.name).toBe("Name 1.1");
    expect(p.budget_line_ids).toEqual(["ap-1", "ap-2"]);
  });

  it("a split line goes in whole, with the share the item holds beside it", () => {
    const p = wbsBuyoutPrefill(ITEMS[1], ITEMS, LINES, { unassigned_lines: free(1, 2) });
    expect(p.budget_line_ids).toContain("ap-1");
    expect(p.shares).toEqual({ "ap-1": 60 });
  });

  it("a parent brings everything below it, and a split line fully inside it is not marked as shared", () => {
    const p = wbsBuyoutPrefill(ITEMS[0], ITEMS, LINES, { unassigned_lines: free(1, 2, 3, 4) });
    expect(p.budget_line_ids).toEqual(["ap-1", "ap-2", "ap-3"]); // the stair once (60 + 40), the two whole lines, not line 4 of the other branch
    expect(p.shares).toEqual({});
  });

  it("lines already in a package are listed as taken, not ticked", () => {
    const p = wbsBuyoutPrefill(ITEMS[1], ITEMS, LINES, { unassigned_lines: free(1), packaged_lines: { [K(2)]: { ref: "PKG-0003", name: "Handrails" } } });
    expect(p.budget_line_ids).toEqual(["ap-1"]);
    expect(p.taken).toEqual([{ line_key: K(2), label: "2.2 Line 2", package_ref: "PKG-0003", package_name: "Handrails" }]);
    expect(p.skipped).toBe(0);
  });

  it("a line that is neither free nor in a package (not in the approved budget, or reserve) is counted as skipped", () => {
    const p = wbsBuyoutPrefill(ITEMS[1], ITEMS, LINES, { unassigned_lines: free(1) });
    expect(p.skipped).toBe(1);
    expect(p.taken).toEqual([]);
  });

  it("an item with nothing in it gives a name and nothing to tick", () => {
    const p = wbsBuyoutPrefill(item("empty", "9", null), [...ITEMS, item("empty", "9", null)], LINES, { unassigned_lines: free(1, 2, 3) });
    expect(p).toMatchObject({ name: "Name 9", budget_line_ids: [], taken: [], skipped: 0 });
  });

  it("the tip fits behind an i", () => {
    expect(tipTextProblems(WBS_TIPS.buyout)).toEqual([]);
  });
});
