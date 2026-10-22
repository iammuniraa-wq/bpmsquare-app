import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }), useSearchParams: () => new URLSearchParams() }));

import { tipTextProblems } from "@/lib/infoTip";
import { DEFAULT_ITEM_TYPES, resolveItemTypes, type ResolvedItemType } from "@/lib/products/itemTypes";
import type { ProductCategoryNode } from "@/lib/picklists";
import {
  addCategory, addItemType, addSub, BLANK_ITEM_TYPE, canRemoveItemType, flagsText, planProductSave, removeSub, renameCategory, toItemTypePayload,
} from "./productsLogic";
import { PRODUCT_TIPS } from "./tips";
import CategoriesTab from "./CategoriesTab";
import TypesTab from "./TypesTab";

const html = (el: React.ReactElement) => renderToString(el).replace(/<!-- -->/g, "");
const tree: ProductCategoryNode[] = [
  { code: "LIFTS", name: "Lifts", subs: [{ code: "PASSENGER", name: "Passenger" }] },
  { code: "PUMPS", name: "Pumps", subs: [] },
];
const types = resolveItemTypes({});

describe("categories", () => {
  it("derives the code from the name and refuses a duplicate or an empty name", () => {
    const ok = addCategory(tree, "Hoists");
    expect("tree" in ok && ok.code).toBe("HOISTS");
    expect(addCategory(tree, "lifts")).toMatchObject({ error: expect.stringMatching(/already exists/) });
    expect(addCategory(tree, "  ")).toMatchObject({ error: expect.stringMatching(/name/) });
  });
  it("takes an explicit code when the ERP uses a different one", () => {
    const res = addCategory(tree, "Hoists", "vk-02");
    expect("tree" in res && res.code).toBe("VK_02");
  });
  it("adds, renames and removes sub-categories without touching the parent's code", () => {
    const added = addSub(tree, "PUMPS", "Submersible");
    expect("tree" in added && added.tree[1].subs).toEqual([{ code: "SUBMERSIBLE", name: "Submersible" }]);
    expect(renameCategory(tree, "LIFTS", "Elevators")[0]).toMatchObject({ code: "LIFTS", name: "Elevators" });
    expect(removeSub(tree, "LIFTS", "PASSENGER")[0].subs).toEqual([]);
    expect(addSub(tree, "LIFTS", "passenger")).toMatchObject({ error: expect.stringMatching(/already exists/) });
  });
});

describe("item types", () => {
  it("adds a custom type with a stable key and refuses a name that is taken", () => {
    const res = addItemType(types, { ...BLANK_ITEM_TYPE, label: "Packaging", sellable: true });
    expect("rows" in res && res.rows.at(-1)).toMatchObject({ key: "packaging", isDefault: false, sellable: true, can_have_components: false });
    expect(addItemType(types, { ...BLANK_ITEM_TYPE, label: "service" })).toMatchObject({ error: expect.stringMatching(/exists/) });
    expect(addItemType(types, BLANK_ITEM_TYPE)).toMatchObject({ error: expect.stringMatching(/name/) });
  });
  it("lets a built-in be hidden but never removed, and a custom one go only when no product has it", () => {
    const custom = { ...types[0], key: "packaging", isDefault: false } as ResolvedItemType;
    expect(canRemoveItemType(types[0], {})).toBe(false);
    expect(canRemoveItemType(custom, { packaging: 2 })).toBe(false);
    expect(canRemoveItemType(custom, {})).toBe(true);
  });
  it("only a kit has components", () => {
    expect(flagsText(DEFAULT_ITEM_TYPES.find((t) => t.key === "bom_kit")!)).toContain("Has components");
    expect(flagsText({ stocked: false, sellable: false, purchasable: false, can_have_components: false })).toBe("None");
  });
});

describe("Save", () => {
  it("is empty until something changes and sends only the group that changed, to its own route", () => {
    const base = { tree, types };
    expect(planProductSave(base, base)).toEqual([]);
    const cat = planProductSave(base, { tree: renameCategory(tree, "PUMPS", "Pump sets"), types });
    expect(cat).toEqual([{ id: "categories", url: "/api/settings/sales-config", body: { product_categories: expect.any(Array) } }]);
    const hidden = types.map((t) => (t.key === "service" ? { ...t, hidden: true } : t));
    const ty = planProductSave(base, { tree, types: hidden });
    expect(ty).toEqual([{ id: "types", url: "/api/settings/item-types", body: { item_types: toItemTypePayload(hidden) } }]);
    expect(toItemTypePayload(hidden).hidden).toEqual(["service"]);
  });
});

describe("the screens", () => {
  it("lists categories as a table with one row each, and the new-category panel is closed", () => {
    const out = html(createElement(CategoriesTab, { tree, onChange: () => {} }));
    expect(out.match(/<tr/g)).toHaveLength(3);
    expect(out).toContain("Lifts");
    expect(out).toContain("Passenger");
    expect(out).toContain("+ New category");
    expect(out).not.toContain('role="dialog"');
  });
  it("lists item types as a table, hidden ones dimmed with a Hidden mark, no per-type cards", () => {
    const rows = types.map((t) => (t.key === "service" ? { ...t, hidden: true } : t));
    const out = html(createElement(TypesTab, { rows, usage: { service: 3 }, accent: "#378ADD", onChange: () => {} }));
    expect(out.match(/<tr/g)).toHaveLength(rows.length + 1);
    expect(out).toContain("Hidden");
    expect(out).toContain("+ New item type");
  });
  it("keeps every explanation behind an i and inside the limit", () => {
    const out = html(createElement(TypesTab, { rows: types, usage: {}, accent: "#378ADD", onChange: () => {} })) + html(createElement(CategoriesTab, { tree, onChange: () => {} }));
    for (const [key, text] of Object.entries(PRODUCT_TIPS)) {
      expect(tipTextProblems(text), key).toEqual([]);
      expect(out, key).not.toContain(text);
    }
  });
});
