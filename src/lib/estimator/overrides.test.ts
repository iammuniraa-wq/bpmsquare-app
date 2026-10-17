import { describe, it, expect } from "vitest";
import { parseLineEdit, applyOverrides, lineCost, occurrenceKeys, readOverride, type OverridableRow } from "./overrides";

const row = (over: Partial<OverridableRow> = {}): OverridableRow => ({
  code: "wall", description: "Wall panels", uom: "m3", qty: 10, waste_pct: 0, unit_cost: 100, cost_total: 1000,
  component: "materials", wbs_code: "1.1", custom_data: { group: "Walls" }, ...over,
});

describe("parseLineEdit", () => {
  it("accepts the allow-listed fields and normalises them", () => {
    const r = parseLineEdit({ qty: "12.34567", waste_pct: 5.555, unit_cost: "2.123456", description: "  Slab  ", uom: "m2", component: "labour", wbs_code: " 2.1 " });
    expect(r).toEqual({ ok: true, edit: { qty: 12.346, waste_pct: 5.56, unit_cost: 2.1235, description: "Slab", uom: "m2", component: "labour", wbs_code: "2.1" } });
  });
  it("ignores unknown keys and absent fields", () => {
    expect(parseLineEdit({ tenant_id: "x", estimate_id: "y", cost_total: 5 })).toEqual({ ok: true, edit: {} });
  });
  it("lets unit_cost, uom and wbs_code be cleared", () => {
    expect(parseLineEdit({ unit_cost: null, uom: "", wbs_code: null })).toEqual({ ok: true, edit: { unit_cost: null, uom: null, wbs_code: null } });
  });
  it("rejects bad values", () => {
    for (const body of [{ qty: -1 }, { qty: "abc" }, { qty: 1e10 }, { waste_pct: 101 }, { unit_cost: -2 }, { description: "  " }, { component: "magic" }, { wbs_code: "a b" }, { uom: "x".repeat(21) }]) {
      expect(parseLineEdit(body as Record<string, unknown>).ok, JSON.stringify(body)).toBe(false);
    }
  });
});

describe("lineCost", () => {
  it("charges the gross quantity", () => {
    expect(lineCost(100, 5, 2)).toBe(210);
    expect(lineCost(1, 0, null)).toBeNull();
  });
});

describe("applyOverrides", () => {
  it("re-applies a stored override to the fresh line with the same code and recomputes its cost", () => {
    const old = [{ code: "wall", description: "Wall panels", custom_data: { override: { qty: 50, unit_cost: 90 } } }];
    const { rows, dropped } = applyOverrides([row({ qty: 12, cost_total: 1200 })], old);
    expect(dropped).toEqual([]);
    expect(rows[0].qty).toBe(50);
    expect(rows[0].unit_cost).toBe(90);
    expect(rows[0].cost_total).toBe(4500);
    expect(readOverride(rows[0].custom_data)).toEqual({ qty: 50, unit_cost: 90 });
    expect(rows[0].custom_data?.group).toBe("Walls");
  });

  it("leaves lines without an override untouched", () => {
    const fresh = [row(), row({ code: "slab" })];
    const { rows } = applyOverrides(fresh, [{ code: "wall", description: "x", custom_data: null }]);
    expect(rows).toEqual(fresh);
  });

  it("matches schedule rows by position within the code", () => {
    const old = [
      { code: "panel", description: "P1", custom_data: null },
      { code: "panel", description: "P2", custom_data: { override: { qty: 9 } } },
    ];
    const fresh = [row({ code: "panel", qty: 1 }), row({ code: "panel", qty: 2 })];
    const { rows } = applyOverrides(fresh, old);
    expect(rows.map((r) => r.qty)).toEqual([1, 9]);
  });

  it("reports an override that has nothing to land on", () => {
    const old = [{ code: "gone", description: "Old rule", custom_data: { override: { qty: 3 } } }];
    const { rows, dropped } = applyOverrides([row()], old);
    expect(dropped).toEqual(["Old rule"]);
    expect(rows[0].qty).toBe(10);
  });

  it("an override can clear a unit cost", () => {
    const { rows } = applyOverrides([row()], [{ code: "wall", description: "x", custom_data: { override: { unit_cost: null } } }]);
    expect(rows[0].unit_cost).toBeNull();
    expect(rows[0].cost_total).toBeNull();
  });
});

describe("occurrenceKeys", () => {
  it("numbers repeats of a code", () => {
    expect(occurrenceKeys([{ code: "a" }, { code: "b" }, { code: "a" }, { code: null }])).toEqual(["a#0", "b#0", "a#1", "#0"]);
  });
});
