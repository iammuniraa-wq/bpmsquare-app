import { describe, expect, it } from "vitest";
import {
  NEW_ITEM, draftBlocker, draftFromLine, draftToParts, draftTotals, leafItems, nextShare, parentChoices, partText, partViews, previewCode, rootBars, trimPct, visibleItems, wbsCell, withPct, withQty,
  type DraftRow,
} from "./screen";
import type { TreeItem } from "./tree";

const item = (id: string, parent: string | null, code: string, sort = 10, name = `Item ${code}`): TreeItem => ({ id, code, name, parent_id: parent, sort_order: sort, code_is_manual: false, owner_employee_id: null, created_at: "2026-11-01T00:00:00Z" });
const ITEMS = [item("a", null, "1", 10, "Steel"), item("a1", "a", "1.1", 10, "Fabrication"), item("a2", "a", "1.2", 20, "Galvanising"), item("b", null, "2", 20, "Erection")];
const row = (k: string, itemId: string, pct: string, qty = ""): DraftRow => ({ key: k, item: itemId, newName: "", pct, qty });

describe("the cell a line shows", () => {
  it("none, whole, split, with the remainder of a split line", () => {
    expect(wbsCell({ wbs_item_id: null, wbs_parts: [] }, ITEMS)).toEqual({ kind: "none", label: "", title: "", remainder: 100 });
    expect(wbsCell({ wbs_item_id: "a1", wbs_parts: [] }, ITEMS)).toEqual({ kind: "whole", label: "1.1", title: "Fabrication", remainder: 0 });
    expect(wbsCell({ wbs_item_id: null, wbs_parts: [{ wbs_item_id: "a1", share_pct: 60 }, { wbs_item_id: "b", share_pct: 25 }] }, ITEMS)).toEqual({ kind: "split", label: "Split 2", title: "1.1, 2", remainder: 15 });
  });
});

describe("the parts of a split line", () => {
  it("carry their share of quantity and amount, adding back to the line", () => {
    const parts = partViews({ qty: 337.1, amount: 141582, wbs_item_id: null, wbs_parts: [{ wbs_item_id: "a1", share_pct: 60 }, { wbs_item_id: "a2", share_pct: 15 }, { wbs_item_id: "b", share_pct: 25 }] }, ITEMS);
    expect(parts.map((p) => [p.code, p.share_pct, p.qty, p.amount])).toEqual([["1.1", 60, 202.26, 84949.2], ["1.2", 15, 50.565, 21237.3], ["2", 25, 84.275, 35395.5]]);
    expect(Math.round(parts.reduce((s, p) => s + p.amount, 0) * 100) / 100).toBe(141582);
    expect(partText(parts[0], "m", (n) => n.toFixed(2))).toBe("1.1 Fabrication · 60 % · 202.26 m · 84949.20");
  });
  it("trims shares without trailing zeros", () => {
    expect([60, 33.3333, 12.5, 0.5].map(trimPct)).toEqual(["60", "33.3333", "12.5", "0.5"]);
  });
});

describe("the split panel's draft", () => {
  it("starts from the line: its parts, its one item, or two empty rows", () => {
    expect(draftFromLine({ qty: 100, wbs_item_id: null, wbs_parts: [{ wbs_item_id: "a1", share_pct: 60 }, { wbs_item_id: "b", share_pct: 40 }] }).map((r) => [r.item, r.pct, r.qty])).toEqual([["a1", "60", "60"], ["b", "40", "40"]]);
    expect(draftFromLine({ qty: 100, wbs_item_id: "a1", wbs_parts: [] })).toHaveLength(1);
    expect(draftFromLine({ qty: 100, wbs_item_id: null, wbs_parts: [] }).map((r) => r.pct)).toEqual(["100", ""]);
  });
  it("percent and quantity follow each other", () => {
    const r = row("x", "a1", "", "");
    expect(withPct(r, "25", 200)).toMatchObject({ pct: "25", qty: "50" });
    expect(withQty(r, "50", 200)).toMatchObject({ pct: "25", qty: "50" });
    expect(withPct(r, "", 200)).toMatchObject({ pct: "", qty: "" });
    expect(withQty(r, "5", 0)).toMatchObject({ qty: "5", pct: "" });
  });
  it("totals, what remains, and whether it is balanced", () => {
    expect(draftTotals([row("a", "a1", "60"), row("b", "a2", "25")])).toEqual({ total: 85, remaining: 15, balanced: false });
    expect(draftTotals([row("a", "a1", "60"), row("b", "a2", "40")]).balanced).toBe(true);
    expect(draftTotals([row("a", "a1", "33.3333"), row("b", "a2", "33.3333"), row("c", "b", "33.3334")]).balanced).toBe(true);
    expect(nextShare([row("a", "a1", "60")])).toBe("40");
    expect(nextShare([row("a", "a1", "100")])).toBe("");
  });
  it("names the reason Save waits, in plain words", () => {
    expect(draftBlocker([row("a", "a1", "60"), row("b", "a2", "40")], ITEMS)).toBeNull();
    expect(draftBlocker([row("a", "", "60"), row("b", "a2", "40")], ITEMS)).toBe("Choose a WBS item for every part");
    expect(draftBlocker([row("a", "a1", "60"), row("b", "a1", "40")], ITEMS)).toBe("An item can appear once");
    expect(draftBlocker([row("a", "a1", "60"), row("b", "a2", "30")], ITEMS)).toBe("10.00 % still to share");
    expect(draftBlocker([row("a", "a1", "70"), row("b", "a2", "40")], ITEMS)).toBe("10.00 % too much");
    expect(draftBlocker([row("a", "a1", "100"), row("b", "a2", "0")], ITEMS)).toBe("Every part needs a share above 0 %");
    expect(draftBlocker([{ ...row("a", NEW_ITEM, "50"), newName: " " }, row("b", "a2", "50")], ITEMS)).toBe("Name the new WBS item");
    expect(draftBlocker([], ITEMS)).toBe("Add a part");
    expect(draftBlocker([row("a", "ghost", "100")], ITEMS)).toBe("Choose a WBS item for every part");
  });
  it("becomes the request: existing items by id, new ones by name", () => {
    expect(draftToParts([row("a", "a1", "60"), { ...row("b", NEW_ITEM, "40"), newName: " Painting " }])).toEqual([{ wbs_item_id: "a1", share_pct: 60 }, { new: { name: "Painting" }, share_pct: 40 }]);
  });
});

describe("the tree's visibility and what it offers", () => {
  it("a folded branch hides everything below it", () => {
    expect(visibleItems(ITEMS, new Set()).map((i) => i.code)).toEqual(["1", "1.1", "1.2", "2"]);
    expect(visibleItems(ITEMS, new Set(["a"])).map((i) => i.code)).toEqual(["1", "2"]);
  });
  it("only leaves can hold lines", () => {
    expect(leafItems(ITEMS).map((i) => i.code)).toEqual(["1.1", "1.2", "2"]);
  });
  it("a new item previews the code it will get", () => {
    expect(previewCode(ITEMS, null)).toBe("3");
    expect(previewCode(ITEMS, "a")).toBe("1.3");
    expect(previewCode(ITEMS, "a2")).toBe("1.2.1");
    expect(previewCode([], null)).toBe("1");
  });
  it("parents on offer: not itself or below it, not too deep, and an item that holds lines is marked", () => {
    const fresh = parentChoices(ITEMS, null, new Set(["a1"]));
    expect(fresh.map((c) => [c.item.code, c.allowed, c.holds])).toEqual([["1", true, false], ["1.1", true, true], ["1.2", true, false], ["2", true, false]]);
    const moving = parentChoices(ITEMS, "a", new Set(["b"]));
    expect(moving.map((c) => c.item.code)).toEqual(["2"]);
    expect(moving[0].allowed).toBe(false);
    const deep = [...ITEMS, item("a11", "a1", "1.1.1")];
    expect(parentChoices(deep, null, new Set()).find((c) => c.item.code === "1.1.1")!.allowed).toBe(false);
    expect(parentChoices(deep, "b", new Set()).find((c) => c.item.code === "1.1")!.allowed).toBe(true);
    expect(parentChoices(deep, "a", new Set()).find((c) => c.item.code === "2")!.allowed).toBe(false);
  });
  it("the bars give each top-level item its share of the client amount and of the cost", () => {
    const bars = rootBars(ITEMS, { a: { client_amount: 75, cost: 60 }, b: { client_amount: 25, cost: 40 }, a1: { client_amount: 50, cost: null } });
    expect(bars.map((b) => [b.code, b.client_pct, b.cost_pct])).toEqual([["1", 75, 60], ["2", 25, 40]]);
    expect(rootBars(ITEMS, { a: { client_amount: 0, cost: null }, b: { client_amount: 0, cost: null } }).map((b) => [b.client_pct, b.cost_pct])).toEqual([[0, null], [0, null]]);
  });
});
