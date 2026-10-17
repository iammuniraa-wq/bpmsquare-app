import { describe, it, expect } from "vitest";
import { normaliseLine, groupNameOf, templateGroupNames, toExportLine, toQuoteSource, unpricedCodes, persistLine } from "./lines";
import { computeEstimate } from "./compute";

const raw = (over: Record<string, unknown> = {}) => ({
  id: "l1", tenant_id: "t", estimate_id: "e", sort_order: "3", code: "wall", group_key: "walls", description: "Wall panels", uom: "m3",
  qty: "10.5", waste_pct: "2", unit_cost: "100.1234", cost_total: "1072.99", component: "materials", product_id: null, source: "rule",
  element_ref: "EW-01..EW-10", wbs_code: "1.1", custom_data: { group: "Walls & panels", sku: "PNL-1" }, ...over,
});

describe("normaliseLine", () => {
  it("turns numeric strings into numbers and keeps nulls", () => {
    const l = normaliseLine(raw({ unit_cost: null, cost_total: undefined }));
    expect(l).toMatchObject({ sort_order: 3, qty: 10.5, waste_pct: 2, unit_cost: null, cost_total: null });
  });
});

describe("groupNameOf", () => {
  const groups = templateGroupNames([{ group: "Walls & panels" }, { group: "Slabs" }]);
  it("prefers the stored snapshot, then the template, then a tidy key", () => {
    expect(groupNameOf(normaliseLine(raw()), groups)).toBe("Walls & panels");
    expect(groupNameOf(normaliseLine(raw({ custom_data: null, group_key: "slabs" })), groups)).toBe("Slabs");
    expect(groupNameOf(normaliseLine(raw({ custom_data: null, group_key: "site_works" })), groups)).toBe("Site Works");
    expect(groupNameOf(normaliseLine(raw({ custom_data: null, group_key: null })), groups)).toBe("Ungrouped");
  });
});

describe("export / quote mapping", () => {
  const l = normaliseLine(raw());
  it("carries the SKU snapshot to the BOM line and the quote source", () => {
    expect(toExportLine(l, new Map())).toMatchObject({ sku: "PNL-1", group: "Walls & panels", qty: 10.5, unit_cost: 100.1234 });
    expect(toQuoteSource(l, new Map())).toMatchObject({ sku: "PNL-1", product_id: null, group_key: "walls" });
  });
  it("lists unpriced lines once by code", () => {
    const lines = [l, normaliseLine(raw({ id: "2", cost_total: null })), normaliseLine(raw({ id: "3", cost_total: null })), normaliseLine(raw({ id: "4", qty: 0, cost_total: null, code: "zero" }))];
    expect(unpricedCodes(lines)).toEqual(["wall"]);
  });
});

describe("persistLine", () => {
  it("stores the group name and SKU snapshot, and the file's own quantity for schedule rows", () => {
    const tpl = {
      inputs: [{ key: "x", label: "X", type: "number" as const, default: 4 }],
      rates: [],
      rules: [{ code: "panel", group: "Walls", description: "Panel", uom: "nr", qty: "x", component: "materials" as const, cost: { kind: "product" as const, sku: "PNL-200" } }],
    };
    const res = computeEstimate(tpl, {}, {});
    if (!res.ok) throw new Error("expected ok");
    const productLine = res.lines[0];
    const p = persistLine(productLine, "prod-1", null);
    expect(p.product_id).toBe("prod-1");
    expect(p.custom_data).toMatchObject({ group: "Walls", sku: "PNL-200" });
    const sched = persistLine({ ...productLine, source: "schedule", qty: 7 }, null, "Panel A");
    expect(sched.custom_data).toMatchObject({ schedule_qty: 7, label: "Panel A" });
  });
});
