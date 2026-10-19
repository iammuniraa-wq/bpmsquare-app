import { describe, it, expect } from "vitest";
import {
  indexByKey, kitDecision, defaultComponentFor, lineFlags, itemKeyOf, betterProduct, isKitType,
  type CatalogueProduct, type FlagInput,
} from "./productItems";
import { validateTemplate } from "./template";
import { computeEstimate } from "./compute";
import { customDataFor, snapshotOf, persistLine } from "./lines";
import { toBomGroups } from "@/app/(app)/estimates/[id]/bomView";
import type { EstimateLine } from "@/lib/types";

const prod = (over: Partial<CatalogueProduct> & { id: string }): CatalogueProduct => ({
  sku: null, ref: null, name: over.id, item_type: null, uom: null, cost_price: null, status: "active", created_at: "2026-01-01", ...over,
});

describe("indexByKey", () => {
  it("matches a SKU exactly and a reference in any case", () => {
    const m = indexByKey([prod({ id: "a", sku: "SLAB-1", ref: "PRD-0010" })], ["SLAB-1", "prd-0010", "slab-1", "NOPE"]);
    expect(m.get("SLAB-1")?.id).toBe("a");
    expect(m.get("prd-0010")?.id).toBe("a");
    expect(m.has("slab-1")).toBe(false); // SKUs are exact
    expect(m.has("NOPE")).toBe(false);
  });
  it("prefers an active product, then the oldest", () => {
    const old = prod({ id: "old", sku: "S", status: "inactive", created_at: "2025-01-01" });
    const a = prod({ id: "a", sku: "S", created_at: "2026-02-01" });
    const b = prod({ id: "b", sku: "S", created_at: "2026-01-01" });
    expect(indexByKey([old, a, b], ["S"]).get("S")?.id).toBe("b");
    expect(betterProduct(undefined, a)).toBe(a);
  });
});

describe("kitDecision", () => {
  it("uses a complete roll-up", () => {
    expect(kitDecision("Kit", { total: 133.2, incomplete: false, missing: [] })).toEqual({ cost: 133.2, source: "kit_rollup", note: null });
  });
  it("never uses an incomplete roll-up, and says which components are missing", () => {
    const d = kitDecision("Kit", { total: 66, incomplete: true, missing: ["Steel", "Plates", "Grout", "Sealant"] });
    expect(d.cost).toBeNull();
    expect(d.note).toMatch(/Steel, Plates, Grout, \.\.\. has no cost/);
  });
  it("ignores a zero roll-up and no kit at all", () => {
    expect(kitDecision("Kit", { total: 0, incomplete: false, missing: [] }).cost).toBeNull();
    expect(kitDecision("Kit", null)).toEqual({ cost: null, source: null, note: null });
  });
});

describe("defaultComponentFor / isKitType", () => {
  it("maps item types to a cost bucket", () => {
    expect(defaultComponentFor("tool_equipment")).toBe("moulds");
    expect(defaultComponentFor("service")).toBe("other");
    expect(defaultComponentFor("bom_kit")).toBe("materials");
    expect(defaultComponentFor(null)).toBe("materials");
    expect(isKitType("bom_kit")).toBe(true);
    expect(isKitType("finished_product")).toBe(false);
  });
});

describe("lineFlags", () => {
  const base: FlagInput = { source: "rule", qty: 5, cost_total: 100, product_id: "p1", custom_data: { sku: "S" } };
  it("is clean for a priced, resolved line", () => {
    expect(lineFlags(base)).toEqual([]);
  });
  it("needs a product when the key matched nothing", () => {
    expect(lineFlags({ ...base, product_id: null, cost_total: null })).toEqual(["unresolved"]);
    expect(lineFlags({ ...base, product_id: null, custom_data: { product_ref: "PRD-0001" } })).toEqual(["unresolved"]);
  });
  it("needs a cost for a resolved line with none, free-text lines included", () => {
    expect(lineFlags({ ...base, cost_total: null })).toEqual(["no_cost"]);
    expect(lineFlags({ source: "manual", qty: 1, cost_total: null, product_id: null, custom_data: { group: "G" } })).toEqual(["no_cost"]);
  });
  it("flags a kit whose roll-up had a hole even when it has a stored cost", () => {
    expect(lineFlags({ ...base, custom_data: { sku: "K", kit_incomplete: true } })).toEqual(["kit_incomplete"]);
  });
  it("a manual line is not 'unresolved' and a zero-quantity line is never flagged", () => {
    expect(lineFlags({ ...base, source: "manual", product_id: null })).toEqual([]);
    expect(lineFlags({ ...base, qty: 0, cost_total: null })).toEqual([]);
  });
  it("reads the item key from sku or reference", () => {
    expect(itemKeyOf({ custom_data: { sku: " S " } })).toBe(" S ");
    expect(itemKeyOf({ custom_data: { product_ref: "PRD-1" } })).toBe("PRD-1");
    expect(itemKeyOf({ custom_data: null })).toBeNull();
  });
});

describe("a rule that names a product by reference", () => {
  const body = (cost: unknown) => ({
    inputs: [], rates: [],
    rules: [{ code: "slab", group: "G", description: "Slab", uom: "m2", qty: "10", component: "materials", cost }],
  });
  it("validates with a SKU, a reference or both, and refuses neither", () => {
    expect(validateTemplate(body({ kind: "product", sku: "S" })).ok).toBe(true);
    expect(validateTemplate(body({ kind: "product", ref: "PRD-0010" })).ok).toBe(true);
    const both = validateTemplate(body({ kind: "product", sku: "S", ref: "PRD-0010" }));
    expect(both.ok).toBe(true);
    expect(both.template?.rules[0].cost).toEqual({ kind: "product", sku: "S", ref: "PRD-0010" });
    const none = validateTemplate(body({ kind: "product" }));
    expect(none.ok).toBe(false);
    expect(none.issues[0].message).toMatch(/SKU or its product reference/);
  });
  it("comes back from compute asking for a price under the key it named", () => {
    const v = validateTemplate(body({ kind: "product", ref: "PRD-0010" }));
    const r = computeEstimate(v.template!, {}, {});
    if (!r.ok) throw new Error("expected ok");
    expect(r.lines[0]).toMatchObject({ sku: "PRD-0010", needs_price: true });
    expect(r.unpriced).toEqual(["slab"]);
  });
});

describe("the snapshot a priced line keeps", () => {
  const line = { group: "G", sku: "PRD-0010", source: "rule" as const, qty: 4 };
  it("stores the real SKU over the key the template wrote, plus the reference and the kit flag", () => {
    expect(customDataFor(line, null, { sku: "SLAB-1", ref: "PRD-0010", kit_incomplete: true })).toEqual({
      group: "G", sku: "SLAB-1", product_ref: "PRD-0010", kit_incomplete: true,
    });
  });
  it("keeps the template's key when the product has no SKU, and round-trips through snapshotOf", () => {
    const cd = customDataFor(line, null, { sku: null, ref: "PRD-0010" });
    expect(cd).toEqual({ group: "G", sku: "PRD-0010", product_ref: "PRD-0010" });
    expect(snapshotOf({ custom_data: cd })).toEqual({ sku: "PRD-0010", ref: "PRD-0010" });
    expect(snapshotOf({ custom_data: { group: "G" } })).toBeNull();
  });
  it("is unchanged for a plain rate line", () => {
    expect(customDataFor({ group: "G", sku: null, source: "rule", qty: 1 }, null)).toEqual({ group: "G" });
    const p = persistLine({ sort_order: 1, code: "a", group: "G", group_key: "g", description: "d", uom: "m2", qty: 1, waste_pct: 0, qty_gross: 1, component: "materials", source: "rule", element_ref: null, cost_kind: "rate", sku: null, rate_key: "r", needs_price: false, unit_cost: 2, cost_total: 2, wbs_code: "1.1" }, null, null);
    expect(p.custom_data).toEqual({ group: "G" });
  });
});

describe("toBomGroups: the product and the flags on a line", () => {
  const row = (over: Partial<EstimateLine>): EstimateLine => ({
    id: "l1", tenant_id: "t", estimate_id: "e", sort_order: 1, code: "ew", group_key: "walls", description: "Wall kit", uom: "m2", qty: 10, waste_pct: 0,
    unit_cost: 100, cost_total: 1000, component: "materials", product_id: "p1", source: "rule", element_ref: null, wbs_code: "1.1",
    custom_data: { group: "Walls", sku: "KIT-WALL" }, created_at: "", updated_at: "", ...over,
  });
  const view = { id: "p1", ref: "PRD-0100", sku: "KIT-WALL", name: "Villa wall panel kit", itemTypeLabel: "BOM / kit", isKit: true, linkable: true };

  it("attaches the product view by id", () => {
    const g = toBomGroups([row({})], [{ group: "Walls" }], { p1: view });
    expect(g[0].lines[0].product).toEqual(view);
    expect(g[0].lines[0].flags).toEqual([]);
  });
  it("flags an unresolved product and a line with no cost", () => {
    const g = toBomGroups([row({ product_id: null, cost_total: null, unit_cost: null }), row({ id: "l2", cost_total: null, unit_cost: null })], [{ group: "Walls" }], { p1: view });
    expect(g[0].lines.map((l) => l.flags)).toEqual([["unresolved"], ["no_cost"]]);
    expect(g[0].lines[0].product).toBeNull();
  });
  it("works with no product map (a free-text or rate line)", () => {
    const g = toBomGroups([row({ product_id: null, custom_data: { group: "Walls" }, code: null, source: "manual" })], [{ group: "Walls" }]);
    expect(g[0].lines[0].product).toBeNull();
    expect(g[0].lines[0].flags).toEqual([]);
  });
});
