import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import {
  addProblem, autoCodes, childrenOf, codeChanges, depthOf, divideByShares, dropItem, heightOf, holdersOf, isDescendant, isLeaf, moveHeld, moveProblem, ownFigures,
  partsOf, qtyOfShare, remainderOf, renumberAll, rollupFigures, setSplit, shareOfQty, totalOf, treeOrder, unassignedOf,
  type Membership, type RollLine, type TreeItem,
} from "./tree";
import { WBS_TIPS } from "./tips";

const item = (id: string, parent: string | null, over: Partial<TreeItem> = {}): TreeItem => ({
  id, code: id, name: `Item ${id}`, parent_id: parent, sort_order: 10, code_is_manual: false, owner_employee_id: null, created_at: "2026-11-01T00:00:00Z", ...over,
});
const line = (id: string, over: Partial<RollLine> = {}): RollLine => ({ id, qty: 10, amount: 1000, cost: 800, priced: true, wbs_item_id: null, parts: [], ...over });

describe("tips", () => {
  it("every WBS tip fits the InfoTip limit", () => {
    for (const [k, text] of Object.entries(WBS_TIPS)) expect(tipTextProblems(text), k).toEqual([]);
  });
});

describe("depth, cycles and the three-level limit", () => {
  const items = [item("a", null), item("b", "a"), item("c", "b"), item("d", null)];
  it("counts levels from 1", () => {
    expect(depthOf(items, "a")).toBe(1);
    expect(depthOf(items, "c")).toBe(3);
    expect(depthOf(items, "zzz")).toBe(0);
    expect(heightOf(items, "a")).toBe(3);
    expect(heightOf(items, "d")).toBe(1);
  });
  it("refuses a fourth level", () => {
    expect(addProblem(items, "c")).toBe("A WBS goes three levels deep");
    expect(addProblem(items, "b")).toBeNull();
    expect(addProblem(items, null)).toBeNull();
  });
  it("refuses a move that would put an item under itself or its own sub-item", () => {
    expect(moveProblem(items, "a", "a")).toBe("An item cannot be moved under itself");
    expect(moveProblem(items, "a", "c")).toBe("An item cannot be moved under itself");
    expect(moveProblem(items, "c", "a")).toBeNull();
  });
  it("refuses a move that makes the moved subtree too deep", () => {
    expect(moveProblem(items, "a", "d")).toBe("A WBS goes three levels deep");
    expect(moveProblem([item("a", null), item("b", "a"), item("d", null)], "a", "d")).toBeNull();
    expect(moveProblem(items, "d", "c")).toBe("A WBS goes three levels deep");
  });
  it("refuses a move under an item that holds lines", () => {
    const two = [item("1", null, { code: "1.2" }), item("2", null)];
    expect(moveProblem(two, "2", "1", new Set(["1"]))).toBe("1.2 holds lines. Add a sub-item for them first.");
    expect(moveProblem(two, "2", "1", new Set())).toBeNull();
  });
  it("knows descendants and leaves", () => {
    expect(isDescendant(items, "a", "c")).toBe(true);
    expect(isDescendant(items, "c", "a")).toBe(false);
    expect(isDescendant(items, "a", "a")).toBe(false);
    expect(isLeaf(items, "c")).toBe(true);
    expect(isLeaf(items, "a")).toBe(false);
  });
});

describe("codes", () => {
  it("numbers 1, 1.1, 1.1.1 and the next sibling", () => {
    const items = [item("a", null, { sort_order: 10 }), item("b", "a", { sort_order: 10 }), item("c", "b"), item("d", null, { sort_order: 20 }), item("e", "a", { sort_order: 20 })];
    const codes = autoCodes(items);
    expect([...["a", "b", "c", "d", "e"]].map((id) => codes.get(id))).toEqual(["1", "1.1", "1.1.1", "2", "1.2"]);
  });
  it("recodes after an insert, a move and a delete", () => {
    const base = [item("a", null, { code: "1", sort_order: 10 }), item("b", null, { code: "2", sort_order: 20 }), item("c", null, { code: "3", sort_order: 30 })];
    // insert between a and b
    const inserted = [...base, item("n", null, { code: "?", sort_order: 15 })];
    expect(autoCodes(inserted).get("n")).toBe("2");
    expect(autoCodes(inserted).get("b")).toBe("3");
    // move c under a
    const moved = base.map((i) => (i.id === "c" ? { ...i, parent_id: "a" } : i));
    expect(autoCodes(moved).get("c")).toBe("1.1");
    // delete a: b and c close up
    const deleted = base.filter((i) => i.id !== "a");
    expect(autoCodes(deleted).get("b")).toBe("1");
    expect(codeChanges(deleted).map((c) => `${c.from}>${c.to}`)).toEqual(["2>1", "3>2"]);
  });
  it("a typed code is kept and keeps its position", () => {
    const items = [item("a", null, { code: "1", sort_order: 10 }), item("b", null, { code: "C-200", code_is_manual: true, sort_order: 20 }), item("c", null, { code: "?", sort_order: 30 })];
    const codes = autoCodes(items);
    expect(codes.get("b")).toBe("C-200");
    expect(codes.get("c")).toBe("3");
  });
  it("a child of a typed code is numbered under it", () => {
    const items = [item("a", null, { code: "C-100", code_is_manual: true }), item("b", "a", { code: "?" })];
    expect(autoCodes(items).get("b")).toBe("C-100.1");
  });
  it("never computes a code another item already holds", () => {
    const items = [item("a", null, { code: "2", code_is_manual: true, sort_order: 10 }), item("b", null, { code: "?", sort_order: 20 })];
    expect(autoCodes(items).get("b")).toBe("2-2");
  });
  it("Renumber clears the typed codes only when it is the renumber-all action", () => {
    const items = [item("a", null, { code: "1", sort_order: 10 }), item("b", null, { code: "C-200", code_is_manual: true, sort_order: 20 })];
    expect(codeChanges(items)).toEqual([]);
    expect(renumberAll(items)).toEqual([{ id: "b", from: "C-200", to: "2", manual_cleared: true }]);
  });
  it("orders siblings by sort order, then creation", () => {
    const items = [item("a", null, { sort_order: 10, created_at: "2026-11-02T00:00:00Z" }), item("b", null, { sort_order: 10, created_at: "2026-11-01T00:00:00Z" })];
    expect(childrenOf(items, null).map((i) => i.id)).toEqual(["b", "a"]);
    expect(treeOrder(items).map((i) => i.depth)).toEqual([1, 1]);
  });
});

describe("lines sit on leaves", () => {
  it("holders are the items that hold a whole line or a part", () => {
    const ms: Membership[] = [{ wbs_item_id: "x", parts: [] }, { wbs_item_id: null, parts: [{ wbs_item_id: "y", share_pct: 60 }, { wbs_item_id: "z", share_pct: 40 }] }, { wbs_item_id: null, parts: [] }];
    expect([...holdersOf(ms)].sort()).toEqual(["x", "y", "z"]);
  });
  it("adding a sub-item moves whole lines and parts into it", () => {
    const ms = new Map<string, Membership>([
      ["l1", { wbs_item_id: "p", parts: [] }],
      ["l2", { wbs_item_id: null, parts: [{ wbs_item_id: "p", share_pct: 60 }, { wbs_item_id: "q", share_pct: 40 }] }],
      ["l3", { wbs_item_id: "q", parts: [] }],
    ]);
    const next = moveHeld(ms, "p", "p1");
    expect(next.get("l1")).toEqual({ wbs_item_id: "p1", parts: [] });
    expect(next.get("l2")?.parts).toEqual([{ wbs_item_id: "p1", share_pct: 60 }, { wbs_item_id: "q", share_pct: 40 }]);
    expect(next.get("l3")).toEqual({ wbs_item_id: "q", parts: [] });
  });
});

describe("splitting a line", () => {
  const items = [item("1", null, { code: "1" }), item("21", "1", { code: "1.1" }), item("22", "1", { code: "1.2" }), item("23", "1", { code: "1.3" })];
  it("accepts shares that add up to 100", () => {
    const r = setSplit(items, [{ wbs_item_id: "21", share_pct: 60 }, { wbs_item_id: "22", share_pct: 15 }, { wbs_item_id: "23", share_pct: 25 }]);
    expect(r).toEqual({ ok: true, kind: "parts", parts: [{ wbs_item_id: "21", share_pct: 60 }, { wbs_item_id: "22", share_pct: 15 }, { wbs_item_id: "23", share_pct: 25 }] });
  });
  it("refuses shares that do not add up, with the total in the message", () => {
    expect(setSplit(items, [{ wbs_item_id: "21", share_pct: 60 }, { wbs_item_id: "22", share_pct: 30 }])).toEqual({ ok: false, error: "Shares add up to 90.00 %, not 100 %" });
  });
  it("refuses an item twice, a non-leaf and a stranger", () => {
    expect(setSplit(items, [{ wbs_item_id: "21", share_pct: 50 }, { wbs_item_id: "21", share_pct: 50 }])).toEqual({ ok: false, error: "1.1 appears twice" });
    expect(setSplit(items, [{ wbs_item_id: "1", share_pct: 50 }, { wbs_item_id: "21", share_pct: 50 }])).toEqual({ ok: false, error: "1 has sub-items" });
    expect(setSplit(items, [{ wbs_item_id: "nope", share_pct: 100 }])).toMatchObject({ ok: false });
  });
  it("refuses a zero or negative share and an empty set", () => {
    expect(setSplit(items, [{ wbs_item_id: "21", share_pct: 100 }, { wbs_item_id: "22", share_pct: 0 }])).toMatchObject({ ok: false });
    expect(setSplit(items, [])).toMatchObject({ ok: false });
  });
  it("one part at 100 % is not a split: the line sits whole in that item", () => {
    expect(setSplit(items, [{ wbs_item_id: "22", share_pct: 100 }])).toEqual({ ok: true, kind: "whole", wbs_item_id: "22" });
  });
  it("rounding slack goes on the largest part so the stored shares add up to exactly 100", () => {
    const r = setSplit(items, [{ wbs_item_id: "21", share_pct: 33.3333 }, { wbs_item_id: "22", share_pct: 33.3333 }, { wbs_item_id: "23", share_pct: 33.3333 }]);
    expect(r.ok && r.kind === "parts" && r.parts.reduce((s, p) => s + p.share_pct, 0)).toBeCloseTo(100, 6);
  });
  it("a removed item leaves an unassigned remainder, never a silent re-spread", () => {
    const m = new Map<string, Membership>([["l", { wbs_item_id: null, parts: [{ wbs_item_id: "21", share_pct: 60 }, { wbs_item_id: "22", share_pct: 15 }, { wbs_item_id: "23", share_pct: 25 }] }]]);
    const after = dropItem(m, "22").get("l") as Membership;
    expect(after.parts.map((p) => p.share_pct)).toEqual([60, 25]);
    expect(remainderOf(after)).toBe(15);
    expect(remainderOf({ wbs_item_id: "21", parts: [] })).toBe(0);
    expect(remainderOf({ wbs_item_id: null, parts: [] })).toBe(100);
    // a whole line in a removed item is plainly unassigned
    expect(dropItem(new Map([["w", { wbs_item_id: "21", parts: [] as never[] }]]), "21").get("w")).toEqual({ wbs_item_id: null, parts: [] });
  });
  it("percent and quantity convert both ways", () => {
    expect(qtyOfShare(337.1, 60)).toBe(202.26);
    expect(shareOfQty(337.1, 202.26)).toBeCloseTo(60, 2);
    expect(shareOfQty(0, 5)).toBe(0);
  });
  it("partsOf reads a whole line as one share at 100 %", () => {
    expect(partsOf({ wbs_item_id: "a", parts: [] })).toEqual([{ wbs_item_id: "a", share_pct: 100 }]);
    expect(partsOf({ wbs_item_id: null, parts: [] })).toEqual([]);
  });
});

describe("dividing by shares", () => {
  it("60/15/25 of the stair adds back to the whole line to the cent", () => {
    const parts = divideByShares(141582, [60, 15, 25]);
    expect(parts).toEqual([84949.2, 21237.3, 35395.5]);
    expect(parts.reduce((s, v) => s + v, 0)).toBeCloseTo(141582, 2);
  });
  it("an odd split still adds up: the last part takes the rounding", () => {
    const parts = divideByShares(100, [33.3333, 33.3333, 33.3334]);
    expect(Math.round(parts.reduce((s, v) => s + v, 0) * 100) / 100).toBe(100);
  });
  it("with a remainder the parts are plain shares", () => {
    expect(divideByShares(1000, [60, 25])).toEqual([600, 250]);
  });
});

describe("roll-up", () => {
  const items = [item("r1", null, { sort_order: 10 }), item("r11", "r1", { sort_order: 10 }), item("r12", "r1", { sort_order: 20 }), item("r2", null, { sort_order: 20 })];
  it("a parent's figures are its own lines plus every descendant, and the total is the roots", () => {
    const lines = [line("a", { wbs_item_id: "r11", amount: 1000, cost: 700 }), line("b", { wbs_item_id: "r12", amount: 500, cost: null, priced: true }), line("c", { wbs_item_id: "r2", amount: 250, cost: 200 })];
    const rolled = rollupFigures(items, lines);
    expect(rolled.get("r11")).toMatchObject({ part_count: 1, client_amount: 1000, cost: 700 });
    expect(rolled.get("r12")).toMatchObject({ client_amount: 500, cost: null });
    expect(rolled.get("r1")).toMatchObject({ part_count: 2, client_amount: 1500, cost: 700, priced_count: 2 });
    expect(totalOf(items, rolled)).toMatchObject({ part_count: 3, client_amount: 1750, cost: 900 });
  });
  it("a split line adds up across 60/15/25 and is never counted twice", () => {
    const stair = line("stair", { qty: 337.1, amount: 141582, cost: 100000, wbs_item_id: null, parts: [{ wbs_item_id: "r11", share_pct: 60 }, { wbs_item_id: "r12", share_pct: 15 }, { wbs_item_id: "r2", share_pct: 25 }] });
    const rolled = rollupFigures(items, [stair]);
    expect(rolled.get("r11")?.client_amount).toBe(84949.2);
    expect(rolled.get("r12")?.client_amount).toBe(21237.3);
    expect(rolled.get("r1")?.client_amount).toBe(106186.5);
    expect(rolled.get("r1")?.shared_count).toBe(2);
    const total = totalOf(items, rolled);
    expect(total.client_amount).toBe(141582);
    expect(total.cost).toBe(100000);
    expect(total.part_count).toBe(3);
  });
  it("equals the sum of the assigned lines exactly, whole and split together", () => {
    const lines = [
      line("w1", { wbs_item_id: "r11", amount: 333.33 }),
      line("w2", { wbs_item_id: "r2", amount: 100.01 }),
      line("s", { amount: 999.99, parts: [{ wbs_item_id: "r11", share_pct: 33.3333 }, { wbs_item_id: "r12", share_pct: 33.3333 }, { wbs_item_id: "r2", share_pct: 33.3334 }] }),
      line("u", { amount: 5000 }),
    ];
    const total = totalOf(items, rollupFigures(items, lines));
    expect(total.client_amount).toBe(1433.33);
  });
  it("an unassigned remainder is left out of the roll-up and listed as unassigned", () => {
    const partial = line("p", { amount: 1000, parts: [{ wbs_item_id: "r11", share_pct: 60 }, { wbs_item_id: "r12", share_pct: 25 }] });
    const rolled = rollupFigures(items, [partial]);
    expect(totalOf(items, rolled).client_amount).toBe(850);
    expect(unassignedOf([partial, line("whole", { wbs_item_id: "r2" }), line("none")]).map((u) => [u.line.id, u.remainder, u.split])).toEqual([["p", 15, true], ["none", 100, false]]);
  });
  it("a line removed from the latest file is not counted", () => {
    expect(ownFigures([line("x", { wbs_item_id: "r11", removed: true })]).size).toBe(0);
    expect(unassignedOf([line("gone", { removed: true })])).toEqual([]);
  });
});
