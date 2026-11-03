import { describe, expect, it } from "vitest";
import { mapTenderWbs, wbsCopyText, type TenderWbsItem } from "./fromTender";
import { wbsSummary } from "./wbsSummary";

// The tender's WBS copied to the project at creation (docs/design/wbs.md section 2.5): the pure mapping.

const item = (id: string, parent: string | null, code: string, sort = 10, over: Partial<TenderWbsItem> = {}): TenderWbsItem => ({
  id, code, name: `Item ${code}`, parent_id: parent, sort_order: sort, code_is_manual: false, owner_employee_id: null, created_at: "2026-11-01T00:00:00Z", ...over,
});
let n = 0;
const newId = () => `new-${++n}`;
const ITEMS = [item("t11", "t1", "1.1", 10, { owner_employee_id: "e1" }), item("t2", null, "C-200", 20, { code_is_manual: true }), item("t1", null, "1", 10), item("t12", "t1", "1.2", 20)];
const lines = [
  { line_key: "k-stair", source_line_id: "d1" }, { line_key: "k-rail", source_line_id: "d2" }, { line_key: "k-free", source_line_id: "d3" }, { line_key: "k-manual", source_line_id: null },
];

describe("mapTenderWbs", () => {
  n = 0;
  const plan = mapTenderWbs({
    items: ITEMS, newId,
    boq: [
      { line_id: "d1", wbs_item_id: null, parts: [{ wbs_item_id: "t11", share_pct: 60 }, { wbs_item_id: "t12", share_pct: 15 }, { wbs_item_id: "t2", share_pct: 25 }] },
      { line_id: "d2", wbs_item_id: "t11", parts: [] },
      { line_id: "d3", wbs_item_id: null, parts: [] },
    ],
    budgetLines: lines,
  });

  it("lists parents before children, keeping codes, names, owners and the typed-code flag, and links back to the tender item", () => {
    expect(plan.items.map((i) => i.code)).toEqual(["1", "1.1", "1.2", "C-200"]);
    const byCode = new Map(plan.items.map((i) => [i.code, i]));
    expect(byCode.get("1")!.parent).toBeNull();
    expect(byCode.get("1.1")!.parent).toBe(byCode.get("1")!.new_id);
    expect(byCode.get("1.1")).toMatchObject({ source_id: "t11", owner_employee_id: "e1", name: "Item 1.1" });
    expect(byCode.get("C-200")).toMatchObject({ code_is_manual: true, source_id: "t2" });
    expect(new Set(plan.items.map((i) => i.new_id)).size).toBe(4);
    expect(plan.items.some((i) => ["t1", "t11", "t12", "t2"].includes(i.new_id))).toBe(false);
  });

  it("a whole line goes to its item and each share of a split line to its item, with the same percentages", () => {
    const id = (code: string) => plan.items.find((i) => i.code === code)!.new_id;
    expect(plan.whole).toEqual([{ package: id("1.1"), line_key: "k-rail", sort_order: 0 }]);
    expect(plan.parts.map((p) => [p.line_key, p.package, p.share_pct])).toEqual([["k-stair", id("1.1"), 60], ["k-stair", id("1.2"), 15], ["k-stair", id("C-200"), 25]]);
  });

  it("a line whose BOQ row is unassigned, and a budget line made by hand, stay unassigned", () => {
    expect(plan.whole.some((w) => ["k-free", "k-manual"].includes(w.line_key))).toBe(false);
    expect(plan.summary).toEqual({ items: 4, lines: 2, split: 1, unassigned: 2 });
    expect(wbsCopyText(plan.summary)).toBe("4 items · 2 lines (1 split) · 2 unassigned");
  });

  it("the unassigned remainder of a split line stays so", () => {
    const p = mapTenderWbs({
      items: ITEMS, newId, budgetLines: [lines[0]],
      boq: [{ line_id: "d1", wbs_item_id: null, parts: [{ wbs_item_id: "t11", share_pct: 60 }] }],
    });
    expect(p.parts).toHaveLength(1);
    expect(p.summary).toMatchObject({ lines: 1, split: 1, unassigned: 1 });
  });

  it("a share pointing at an item that is not in the tree is dropped, not guessed", () => {
    const p = mapTenderWbs({
      items: ITEMS, newId, budgetLines: [lines[0]],
      boq: [{ line_id: "d1", wbs_item_id: null, parts: [{ wbs_item_id: "gone", share_pct: 40 }, { wbs_item_id: "t11", share_pct: 60 }] }],
    });
    expect(p.parts.map((x) => x.share_pct)).toEqual([60]);
    expect(p.summary.unassigned).toBe(1);
  });

  it("an empty tender WBS copies nothing", () => {
    const p = mapTenderWbs({ items: [], newId, boq: [], budgetLines: lines });
    expect(p).toMatchObject({ items: [], whole: [], parts: [], summary: { items: 0, lines: 0, split: 0, unassigned: 4 } });
  });
});

describe("wbsSummary", () => {
  it("says what the project's WBS holds", () => {
    expect(wbsSummary({ packages: [1, 2, 3], allocation: { lineRows: [{ wbs: [{}] }, { wbs: [{}, {}] }, { wbs: [] }], unassigned: [{}] } })).toBe("3 items · 2 lines (1 split) · 1 unassigned");
    expect(wbsCopyText({ items: 1, lines: 1, split: 0, unassigned: 0 })).toBe("1 item · 1 line · 0 unassigned");
  });
});
