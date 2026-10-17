import { describe, it, expect } from "vitest";
import { buildQuoteLines, priceForCost, alternativesInput, tagAlternatives, plainRows, quoteBlockers, type QuoteSourceLine } from "./quoteLines";
import { summariseLines } from "./compute";
import { PRECAST_VILLA_STARTER } from "./starterTemplates";
import { computeEstimate } from "./compute";

const line = (over: Partial<QuoteSourceLine>): QuoteSourceLine => ({
  description: "Item", uom: "m3", qty: 1, waste_pct: 0, group: "Concrete", group_key: "concrete", cost_total: 100, ...over,
});

describe("priceForCost", () => {
  it("matches summariseLines (markup on cost, 2 dp)", () => {
    for (const [cost, m] of [[100, 18], [174256.59, 18], [33.33, 7.5], [0.01, 50]]) {
      const s = summariseLines([{ group: "g", group_key: "g", component: "materials", cost_total: cost }], { margin_pct: m });
      expect(priceForCost(cost, m)).toBe(s.price);
    }
  });
});

describe("buildQuoteLines", () => {
  const lines = [
    line({ description: "Wall panels", group: "Walls", group_key: "walls", cost_total: 333.33, qty: 4 }),
    line({ description: "Joints", group: "Walls", group_key: "walls", cost_total: 100.01 }),
    line({ description: "Planks", group: "Slabs", group_key: "slabs", cost_total: 222.22 }),
    line({ description: "Crane", group: "Erection", group_key: "erection", cost_total: 50.05, uom: "day" }),
  ];

  it("one line per group by default, adding up to the estimate's price to the cent", () => {
    const r = buildQuoteLines(lines, { granularity: "group", margin_pct: 18 });
    if (!r.ok) throw new Error("expected ok");
    expect(r.lines.map((l) => l.description)).toEqual(["Walls", "Slabs", "Erection"]);
    const summary = summariseLines(lines.map((l) => ({ group: l.group, group_key: l.group_key, component: "materials" as const, cost_total: l.cost_total })), { margin_pct: 18 });
    expect(r.price).toBe(summary.price);
    expect(r.lines.reduce((a, l) => Math.round((a + l.amount) * 100) / 100, 0)).toBe(summary.price);
  });

  it("one line per estimate line at line granularity", () => {
    const r = buildQuoteLines(lines, { granularity: "line", margin_pct: 10 });
    if (!r.ok) throw new Error("expected ok");
    expect(r.lines).toHaveLength(4);
    expect(r.lines[0].description).toBe("Wall panels (4 m3)");
    expect(r.lines.reduce((a, l) => Math.round((a + l.amount) * 100) / 100, 0)).toBe(r.price);
  });

  it("states the gross quantity (net plus waste) at line granularity", () => {
    const r = buildQuoteLines([line({ description: "Rebar", uom: "kg", qty: 100, waste_pct: 5, cost_total: 50 })], { granularity: "line", margin_pct: 0 });
    if (!r.ok) throw new Error("expected ok");
    expect(r.lines[0].description).toBe("Rebar (105 kg)");
  });

  it("never carries a cost or a margin field onto a customer line", () => {
    for (const granularity of ["group", "line"] as const) {
      const r = buildQuoteLines(lines, { granularity, margin_pct: 18 });
      if (!r.ok) throw new Error("expected ok");
      for (const l of r.lines) {
        expect(Object.keys(l).sort()).toEqual(["amount", "description", "qty", "rate", "uom"]);
        expect(l.qty).toBe(1);
        expect(l.rate).toBe(l.amount);
      }
    }
  });

  it("refuses unpriced lines and names them", () => {
    const r = buildQuoteLines([...lines, line({ description: "Steel plates", cost_total: null })], { granularity: "group", margin_pct: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0]).toContain("Steel plates");
  });

  it("refuses an empty or zero estimate", () => {
    expect(buildQuoteLines([], { granularity: "group", margin_pct: 0 }).ok).toBe(false);
    expect(buildQuoteLines([line({ cost_total: 0 })], { granularity: "group", margin_pct: 0 }).ok).toBe(false);
  });

  it("drops zero-qty lines and zero-priced groups", () => {
    const r = buildQuoteLines([line({ cost_total: 100 }), line({ description: "Free", group: "Gifts", group_key: "gifts", cost_total: 0 })], { granularity: "group", margin_pct: 0 });
    if (!r.ok) throw new Error("expected ok");
    expect(r.lines.map((l) => l.description)).toEqual(["Concrete"]);
  });

  it("prices the illustrative starter's computed lines like the estimate", () => {
    const unit_costs = Object.fromEntries(PRECAST_VILLA_STARTER.rules.filter((r) => r.cost.kind === "product").map((r) => [r.code, 10]));
    const res = computeEstimate(PRECAST_VILLA_STARTER, {}, { margin_pct: 18, unit_costs });
    if (!res.ok) throw new Error(JSON.stringify(res.issues));
    const q = buildQuoteLines(res.lines.map((l) => ({ description: l.description, uom: l.uom, qty: l.qty, waste_pct: l.waste_pct, group: l.group, group_key: l.group_key, cost_total: l.cost_total })), { granularity: "group", margin_pct: 18 });
    if (!q.ok) throw new Error(JSON.stringify(q));
    expect(q.price).toBe(res.summary.price);
    expect(q.lines.reduce((a, l) => Math.round((a + l.amount) * 100) / 100, 0)).toBe(res.summary.price);
  });
});

describe("alternatives", () => {
  const inputs = [
    { key: "floors", label: "Floors", type: "number" as const, default: 2 },
    { key: "finish", label: "Finish", type: "select" as const, default: "std", quote_alternatives: true, options: [{ key: "basic", label: "Basic", value: 1 }, { key: "std", label: "Standard", value: 2 }] },
  ];
  it("finds the flagged select input", () => {
    expect(alternativesInput(inputs)?.key).toBe("finish");
    expect(alternativesInput([inputs[0]])).toBeNull();
    expect(alternativesInput([{ ...inputs[1], quote_alternatives: false }])).toBeNull();
    expect(alternativesInput([{ ...inputs[1], options: [inputs[1].options![0]] }])).toBeNull();
  });
  it("tags each option as an alternative group and selects the chosen one", () => {
    const set = (key: string, label: string, amount: number) => ({ key, label, lines: [{ description: "Walls", uom: "lot", qty: 1, rate: amount, amount }] });
    const rows = tagAlternatives([set("basic", "Basic", 100), set("std", "Standard", 108)], "std");
    expect(rows.map((r) => [r.group_id, r.group_label, r.group_type, r.is_selected, r.sl_no])).toEqual([
      ["alt_basic", "Basic", "alternative", false, "1"],
      ["alt_std", "Standard", "alternative", true, "2"],
    ]);
  });
  it("plain rows are ungrouped and selected", () => {
    const rows = plainRows([{ description: "A", uom: "lot", qty: 1, rate: 5, amount: 5 }]);
    expect(rows[0]).toMatchObject({ sl_no: "1", group_id: null, group_type: null, is_selected: true });
  });
});

describe("quoteBlockers", () => {
  const ok = { ...line({}), sku: null, product_id: null };
  it("is empty for a fully priced estimate", () => {
    expect(quoteBlockers([ok, { ...ok, sku: "PNL-1", product_id: "p1" }])).toEqual([]);
  });
  it("names unresolved SKUs and unpriced lines", () => {
    const out = quoteBlockers([{ ...ok, sku: "PNL-9", product_id: null }, { ...ok, description: "Plate", cost_total: null }]);
    expect(out.join(" ")).toContain("PNL-9");
    expect(out.join(" ")).toContain("Plate");
  });
  it("ignores zero-quantity lines", () => {
    expect(quoteBlockers([ok, { ...ok, qty: 0, sku: "X", product_id: null, cost_total: null }])).toEqual([]);
  });
});
