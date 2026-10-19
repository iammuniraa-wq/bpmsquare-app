import { describe, expect, it } from "vitest";
import {
  DEFAULT_ITEM_TYPES, canHaveComponents, itemTypeLabel, matchItemType, resolveItemTypes,
  itemTypeFromCell, sanitizeItemTypeConfig, selectableItemTypes, validateItemType,
} from "./itemTypes";

describe("default item types", () => {
  it("lists the ten owner-approved types", () => {
    expect(DEFAULT_ITEM_TYPES.map((d) => d.key)).toEqual([
      "finished_product", "semi_finished", "raw_material", "bought_out_component", "consumable",
      "custom_made_to_order", "service", "tool_equipment", "certification_document", "bom_kit",
    ]);
  });
  it("lets ONLY bom_kit have components", () => {
    const withComponents = DEFAULT_ITEM_TYPES.filter((d) => d.can_have_components).map((d) => d.key);
    expect(withComponents).toEqual(["bom_kit"]);
  });
  it("has a label and description for every type", () => {
    for (const d of DEFAULT_ITEM_TYPES) {
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.description.length).toBeGreaterThan(0);
    }
  });
});

describe("resolveItemTypes", () => {
  it("returns the defaults when the tenant has no overrides", () => {
    expect(resolveItemTypes({}).map((x) => x.key)).toEqual(DEFAULT_ITEM_TYPES.map((d) => d.key));
    expect(resolveItemTypes(null)).toHaveLength(10);
    expect(resolveItemTypes({}).every((x) => !x.hidden && x.isDefault)).toBe(true);
  });
  it("applies a rename and a hide, keeping the type in the list", () => {
    const list = resolveItemTypes({ item_types: { labels: { raw_material: "Raw stock" }, hidden: ["consumable"] } });
    expect(list.find((x) => x.key === "raw_material")?.label).toBe("Raw stock");
    expect(list.find((x) => x.key === "consumable")?.hidden).toBe(true);
    expect(list).toHaveLength(10);
  });
  it("appends custom types and never lets them have components", () => {
    const list = resolveItemTypes({
      item_types: { custom: [{ key: "packaging", label: "Packaging", stocked: true, sellable: false, purchasable: true }] },
    });
    const pk = list[list.length - 1];
    expect(pk).toMatchObject({ key: "packaging", isDefault: false, stocked: true, can_have_components: false });
  });
  it("ignores a malformed or colliding custom entry", () => {
    const list = resolveItemTypes({
      item_types: { custom: [
        { key: "bom_kit", label: "Clash", stocked: false, sellable: false, purchasable: false },
        { key: "Bad Key", label: "x", stocked: false, sellable: false, purchasable: false },
      ] },
    });
    expect(list).toHaveLength(10);
    expect(list.find((x) => x.key === "bom_kit")?.label).toBe("BOM / kit");
  });
});

describe("selectableItemTypes", () => {
  it("hides hidden types but keeps the one the record has", () => {
    const cfg = { item_types: { hidden: ["service", "consumable"] } };
    const keys = selectableItemTypes(cfg).map((x) => x.key);
    expect(keys).not.toContain("service");
    expect(selectableItemTypes(cfg, "service").map((x) => x.key)).toContain("service");
  });
});

describe("validateItemType", () => {
  it("treats empty as unclassified", () => {
    expect(validateItemType({}, null)).toEqual({ ok: true, key: null });
    expect(validateItemType({}, "")).toEqual({ ok: true, key: null });
    expect(validateItemType({}, undefined)).toEqual({ ok: true, key: null });
  });
  it("accepts a known key and refuses an unknown one", () => {
    expect(validateItemType({}, "raw_material")).toEqual({ ok: true, key: "raw_material" });
    expect(validateItemType({}, "gizmo")).toMatchObject({ ok: false });
    expect(validateItemType({}, 5)).toMatchObject({ ok: false });
  });
  it("refuses a hidden type unless the record already has it", () => {
    const cfg = { item_types: { hidden: ["service"] } };
    expect(validateItemType(cfg, "service")).toMatchObject({ ok: false });
    expect(validateItemType(cfg, "service", "service")).toEqual({ ok: true, key: "service" });
  });
  it("accepts a tenant's custom type", () => {
    const cfg = { item_types: { custom: [{ key: "packaging", label: "Packaging", stocked: true, sellable: false, purchasable: true }] } };
    expect(validateItemType(cfg, "packaging")).toEqual({ ok: true, key: "packaging" });
  });
});

describe("labels, matching and the kit rule", () => {
  it("shows the tenant's name, falls back to the raw key, null when unclassified", () => {
    const cfg = { item_types: { labels: { service: "Labour" } } };
    expect(itemTypeLabel(cfg, "service")).toBe("Labour");
    expect(itemTypeLabel(cfg, "retired_type")).toBe("retired_type");
    expect(itemTypeLabel(cfg, null)).toBeNull();
  });
  it("matches a label or a key, ignoring case and spacing", () => {
    expect(matchItemType({}, "  bom / KIT ")?.key).toBe("bom_kit");
    expect(matchItemType({}, "raw_material")?.key).toBe("raw_material");
    expect(matchItemType({ item_types: { labels: { service: "Labour" } } }, "labour")?.key).toBe("service");
    expect(matchItemType({}, "nope")).toBeNull();
    expect(matchItemType({}, "  ")).toBeNull();
  });
  it("canHaveComponents is true only for bom_kit; unknown and null are false", () => {
    expect(canHaveComponents({}, "bom_kit")).toBe(true);
    expect(canHaveComponents({}, "semi_finished")).toBe(false);
    expect(canHaveComponents({}, "finished_product")).toBe(false);
    expect(canHaveComponents({}, "mystery")).toBe(false);
    expect(canHaveComponents({}, null)).toBe(false);
  });
});

describe("itemTypeFromCell", () => {
  it("maps a label or key to the key, blank to unclassified", () => {
    expect(itemTypeFromCell({}, "Raw material")).toEqual({ ok: true, key: "raw_material" });
    expect(itemTypeFromCell({}, "bom_kit")).toEqual({ ok: true, key: "bom_kit" });
    expect(itemTypeFromCell({}, "  ")).toEqual({ ok: true, key: null });
  });
  it("is an error for an unknown type, and for a hidden one unless the row already has it", () => {
    expect(itemTypeFromCell({}, "Gizmo")).toMatchObject({ ok: false });
    const cfg = { item_types: { hidden: ["service"] } };
    expect(itemTypeFromCell(cfg, "Service")).toMatchObject({ ok: false });
    expect(itemTypeFromCell(cfg, "Service", "service")).toEqual({ ok: true, key: "service" });
  });
});

describe("sanitizeItemTypeConfig", () => {
  it("normalises a good payload and drops no-op renames", () => {
    const r = sanitizeItemTypeConfig({
      labels: { service: " Labour ", raw_material: "Raw material" },
      hidden: ["consumable", "consumable"],
      custom: [{ key: "packaging", label: "Packaging", stocked: true, can_have_components: true }],
    });
    expect(r).toEqual({ ok: true, value: {
      labels: { service: "Labour" },
      hidden: ["consumable"],
      custom: [{ key: "packaging", label: "Packaging", stocked: true, sellable: false, purchasable: false }],
    } });
  });
  it("returns an empty config for an empty payload", () => {
    expect(sanitizeItemTypeConfig({})).toEqual({ ok: true, value: {} });
  });
  it("rejects bad shapes, colliding keys and duplicate names", () => {
    expect(sanitizeItemTypeConfig(null)).toMatchObject({ ok: false });
    expect(sanitizeItemTypeConfig({ labels: { gizmo: "x" } })).toMatchObject({ ok: false });
    expect(sanitizeItemTypeConfig({ custom: [{ key: "bom_kit", label: "x" }] })).toMatchObject({ ok: false });
    expect(sanitizeItemTypeConfig({ custom: [{ key: "Bad", label: "x" }] })).toMatchObject({ ok: false });
    expect(sanitizeItemTypeConfig({ custom: [{ key: "pk", label: "Service" }] })).toMatchObject({ ok: false });
    expect(sanitizeItemTypeConfig({ custom: [{ key: "pk", label: "A" }, { key: "pk", label: "B" }] })).toMatchObject({ ok: false });
    expect(sanitizeItemTypeConfig({ hidden: ["nope"] })).toMatchObject({ ok: false });
  });
});
