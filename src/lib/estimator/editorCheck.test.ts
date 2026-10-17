import { describe, it, expect } from "vitest";
import { checkTemplate, checkFormula, EXAMPLE_LINE_LIMIT } from "./editorCheck";
import { PRECAST_VILLA_STARTER } from "./starterTemplates";

const small = {
  inputs: [{ key: "area", label: "Area", type: "number", default: 100 }],
  rates: [{ key: "slab_rate", label: "Slab rate", unit: "per m2", value: 12.5 }],
  rules: [
    { code: "slab", group: "Slabs", description: "Slab", uom: "m2", qty: "area * 1.1", component: "materials", cost: { kind: "rate", rate: "slab_rate" } },
    { code: "oh", group: "Overhead", description: "Overhead", uom: "lot", qty: "1", component: "overhead", cost: { kind: "rate", rate: "slab_rate" } },
  ],
};

describe("checkTemplate", () => {
  it("returns every problem for an invalid template and no example", () => {
    const r = checkTemplate({ inputs: [], rates: [], rules: [{ code: "A!" }] });
    expect(r.ok).toBe(false);
    expect(r.issues.length).toBeGreaterThan(1);
    expect(r.example).toBeNull();
  });
  it("gives an example with the defaults for a valid template", () => {
    const r = checkTemplate(small);
    expect(r.ok).toBe(true);
    expect(r.example?.line_count).toBe(2);
    expect(r.example?.lines[0]).toMatchObject({ code: "slab", qty: 110, unit_cost: 12.5, cost_total: 1375 });
    expect(r.example?.summary.cost_total).toBe(1387.5);
    expect(r.example?.unpriced).toEqual([]);
  });
  it("reports a valid template that does not compute with its defaults", () => {
    const r = checkTemplate({ ...small, rules: [{ ...small.rules[0], qty: "area / (area - 100)" }] });
    expect(r.ok).toBe(true);
    expect(r.example).toBeNull();
    expect(r.example_issues[0].message).toMatch(/zero|divide/i);
  });
  it("labels product lines as unpriced in an example", () => {
    const r = checkTemplate({ ...small, rules: [{ ...small.rules[0], cost: { kind: "product", sku: "SLB-1" } }] });
    expect(r.example?.unpriced).toEqual(["slab"]);
  });
  it("handles the illustrative starter and caps the lines it returns", () => {
    const r = checkTemplate(PRECAST_VILLA_STARTER);
    expect(r.ok).toBe(true);
    expect(r.example).not.toBeNull();
    expect(r.example!.lines.length).toBeLessThanOrEqual(EXAMPLE_LINE_LIMIT);
    expect(r.example!.summary.cost_total).toBeGreaterThan(0);
  });
});

describe("checkFormula", () => {
  it("evaluates with defaults, rates and earlier lines", () => {
    expect(checkFormula(small, "area * 2")).toMatchObject({ ok: true, value: 200 });
    expect(checkFormula(small, "qty_slab + slab_rate")).toMatchObject({ ok: true, value: 122.5 });
    expect(checkFormula(small, "sub_slabs")).toMatchObject({ ok: true, value: 1375 });
  });
  it("names unknown identifiers and syntax errors", () => {
    const u = checkFormula(small, "area * wall_height");
    expect(u.ok).toBe(false);
    expect(u.unknown).toEqual(["wall_height"]);
    const s = checkFormula(small, "area *");
    expect(s.ok).toBe(false);
    expect(s.value).toBeNull();
  });
  it("reports an evaluation error", () => {
    const r = checkFormula(small, "area / 0");
    expect(r.ok).toBe(false);
    expect(r.value).toBeNull();
  });
  it("knows the geometry totals", () => {
    const r = checkFormula(PRECAST_VILLA_STARTER, "vol_total * 2");
    expect(r.ok).toBe(true);
    expect(r.value).toBeGreaterThan(0);
  });
  it("still checks names when the template itself has problems", () => {
    const r = checkFormula({ ...small, rules: [] }, "area + nope");
    expect(r.unknown).toEqual(["nope"]);
    const ok = checkFormula({ ...small, rules: [] }, "area + 1");
    expect(ok).toMatchObject({ ok: true, value: null });
    expect(ok.note).toMatch(/fix the template/i);
  });
});
