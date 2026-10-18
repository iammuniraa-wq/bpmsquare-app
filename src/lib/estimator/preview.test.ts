import { describe, it, expect } from "vitest";
import { previewEstimate, buildPriceView, needsCatalogue, toQuoteSource, shiftOptions } from "./preview";
import { computeEstimate } from "./compute";
import { PRECAST_VILLA_STARTER } from "./starterTemplates";
import type { EstimateTemplateBody } from "./types";

const OPTS = { granularity: "group" as const, margin_pct: 18, vat_pct: 15 };

function ok(p: ReturnType<typeof previewEstimate>) {
  if (!p.ok) throw new Error(p.issues.map((i) => `${i.path}: ${i.message}`).join("; "));
  return p;
}

describe("preview, rate-priced starter", () => {
  const p = ok(previewEstimate({ template: PRECAST_VILLA_STARTER, params: {}, ...OPTS }));

  it("gives the engine's own golden figures (nothing is re-derived)", () => {
    expect(p.summary.cost_total).toBe(174256.59);
    expect(p.summary.price_incl_vat).toBe(236466.2);
    expect(p.view.total).toBe(236466.2);
    expect(p.view.price).toBe(p.summary.price);
    expect(p.view.vat).toBe(p.summary.vat);
    expect(p.complete).toBe(true);
    expect(p.model?.pieces).toHaveLength(137);
  });

  it("sections add up to the price to the cent", () => {
    const sum = p.view.sections.reduce((a, s) => Math.round((a + s.amount) * 100) / 100, 0);
    expect(sum).toBe(p.view.price);
    expect(p.view.sections.length).toBe(p.summary.by_group.length);
  });

  it("sections are the same lines the quote will carry", () => {
    const again = buildPriceView(p.lines.map(toQuoteSource), OPTS);
    expect(again).toEqual(p.view);
  });

  it("does not need the catalogue", () => {
    expect(needsCatalogue(PRECAST_VILLA_STARTER)).toBe(false);
  });

  it("is deterministic", () => {
    const q = ok(previewEstimate({ template: PRECAST_VILLA_STARTER, params: {}, ...OPTS }));
    expect(q.view).toEqual(p.view);
  });

  it("follows an input change", () => {
    const more = ok(previewEstimate({ template: PRECAST_VILLA_STARTER, params: { floors: 3 }, ...OPTS }));
    expect(more.view.total).toBeGreaterThan(p.view.total);
    expect(more.model!.pieces.length).toBeGreaterThan(p.model!.pieces.length);
  });

  it("matches computeEstimate for the same inputs", () => {
    const direct = computeEstimate(PRECAST_VILLA_STARTER, { floors: 1, boundary_wall_length_m: 0 }, { margin_pct: 18, vat_pct: 15 });
    if (!direct.ok) throw new Error("direct failed");
    const viaPreview = ok(previewEstimate({ template: PRECAST_VILLA_STARTER, params: { floors: 1, boundary_wall_length_m: 0 }, ...OPTS }));
    expect(viaPreview.summary).toEqual(direct.summary);
  });
});

describe("preview, finish options", () => {
  const flagged: EstimateTemplateBody = {
    ...PRECAST_VILLA_STARTER,
    inputs: PRECAST_VILLA_STARTER.inputs.map((i) => (i.key === "finish_level" ? { ...i, quote_alternatives: true } : i)),
  };

  it("lists every option when the template flags a select input", () => {
    const p = ok(previewEstimate({ template: flagged, params: {}, ...OPTS }));
    expect(p.options?.items.map((o) => o.key)).toEqual(["basic", "standard", "premium"]);
    expect(p.options?.items.find((o) => o.selected)?.key).toBe("standard");
    const [basic, standard, premium] = p.options!.items;
    expect(basic.delta).toBe(0);
    expect(standard.total).toBe(p.summary.price_incl_vat);
    expect(premium.total).toBeGreaterThan(standard.total);
    expect(standard.total).toBeGreaterThan(basic.total);
    expect(premium.delta).toBeCloseTo(premium.total - basic.total, 2);
  });

  it("each option equals a full compute with that option chosen", () => {
    const p = ok(previewEstimate({ template: flagged, params: {}, ...OPTS }));
    const direct = ok(previewEstimate({ template: flagged, params: { finish_level: "premium" }, ...OPTS }));
    expect(p.options!.items.find((o) => o.key === "premium")!.total).toBe(direct.summary.price_incl_vat);
  });

  it("the selected option follows the chosen input", () => {
    const p = ok(previewEstimate({ template: flagged, params: { finish_level: "premium" }, ...OPTS }));
    expect(p.options!.items.find((o) => o.selected)?.key).toBe("premium");
  });

  it("an unflagged template has no options", () => {
    const plain: EstimateTemplateBody = { ...PRECAST_VILLA_STARTER, inputs: PRECAST_VILLA_STARTER.inputs.map(({ quote_alternatives: _q, ...i }) => i) };
    expect(ok(previewEstimate({ template: plain, params: {}, ...OPTS })).options).toBeNull();
  });
});

describe("preview, product lines", () => {
  const withProduct: EstimateTemplateBody = {
    ...PRECAST_VILLA_STARTER,
    rules: [
      ...PRECAST_VILLA_STARTER.rules,
      { code: "ped", group: "Fittings", description: "Pedestal", uom: "nr", qty: "n_EW", component: "materials", cost: { kind: "product", sku: "PED-1" } },
    ],
  };

  it("needs the catalogue and is incomplete until unit costs arrive", () => {
    expect(needsCatalogue(withProduct)).toBe(true);
    const p = ok(previewEstimate({ template: withProduct, params: {}, ...OPTS }));
    expect(p.complete).toBe(false);
    expect(p.unpriced).toEqual(["ped"]);
    expect(p.view.sections).toEqual([]);
    expect(p.view.problems.join(" ")).toContain("Pedestal");
    expect(p.options).toBeNull();
  });

  it("prices once the catalogue's unit costs are supplied", () => {
    const p = ok(previewEstimate({ template: withProduct, params: {}, ...OPTS, unit_costs: { ped: 10 } }));
    expect(p.complete).toBe(true);
    expect(p.view.sections.length).toBe(9);
    expect(p.view.total).toBeGreaterThan(236466.2);
  });
});

describe("preview, bad input", () => {
  it("returns the engine's issues, never throws", () => {
    const p = previewEstimate({ template: PRECAST_VILLA_STARTER, params: { floors: 99 }, ...OPTS });
    expect(p.ok).toBe(false);
  });
  it("rejects a margin outside range", () => {
    const p = previewEstimate({ template: PRECAST_VILLA_STARTER, params: {}, ...OPTS, margin_pct: -1 });
    expect(p.ok).toBe(false);
  });
});

describe("shiftOptions", () => {
  const opts = { label: "Finish", items: [{ key: "a", label: "A", total: 100, delta: 0, selected: false }, { key: "b", label: "B", total: 120, delta: 20, selected: true }] };
  it("moves every total, leaving the gaps between options", () => {
    const r = shiftOptions(opts, 5.5)!;
    expect(r.items.map((o) => o.total)).toEqual([105.5, 125.5]);
    expect(r.items.map((o) => o.delta)).toEqual([0, 20]);
  });
  it("is a no-op for zero or no options", () => {
    expect(shiftOptions(opts, 0)).toBe(opts);
    expect(shiftOptions(null, 5)).toBeNull();
  });
});
