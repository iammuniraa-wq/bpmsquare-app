import { describe, it, expect } from "vitest";
import { buildSavedEstimate } from "./savedEstimate";
import { computeEstimate } from "@/lib/estimator/compute";
import { persistLine, normaliseLine } from "@/lib/estimator/lines";
import { PRECAST_VILLA_STARTER } from "@/lib/estimator/starterTemplates";
import type { Estimate, EstimateLine, EstimateTemplate } from "@/lib/types";

const r = computeEstimate(PRECAST_VILLA_STARTER, {}, { margin_pct: 18, vat_pct: 15 });
if (!r.ok) throw new Error("starter does not compute");

const lines: EstimateLine[] = r.lines.map((l, i) => {
  const p = persistLine(l, null, null);
  return normaliseLine({ ...p, id: `l${i}`, tenant_id: "t", estimate_id: "e", product_id: null, created_at: "", updated_at: "" });
});
const template = { ...PRECAST_VILLA_STARTER, id: "tpl", version: 1, tenant_id: "t" } as unknown as EstimateTemplate;
const estimate = {
  id: "e", params: r.params, margin_pct: 18, totals: { ...r.summary }, model: r.model, standard_quote_id: null, account_id: null, contact_id: null,
} as unknown as Estimate;

describe("buildSavedEstimate", () => {
  const s = buildSavedEstimate({ estimate, lines, template, templateOutdated: false, quote: null, vatPct: 15 });

  it("shows the customer's total from the stored lines, to the cent", () => {
    expect(s.view.total).toBe(r.summary.price_incl_vat);
    expect(s.view.price).toBe(r.summary.price);
    expect(s.view.sections.length).toBe(r.summary.by_group.length);
  });
  it("carries the stored totals, model and lines for the internal sections", () => {
    expect(s.shown.live).toBe(false);
    expect(s.shown.lines).toHaveLength(lines.length);
    expect(s.shown.model?.pieces).toHaveLength(137);
    expect(s.shown.totals?.cost_total).toBe(r.summary.cost_total);
  });
  it("is unlocked without a quote and locked with one", () => {
    expect(s.locked).toBe(false);
    const q = buildSavedEstimate({ estimate: { ...estimate, standard_quote_id: "q1" } as Estimate, lines, template, templateOutdated: false, quote: { id: "q1", ref: "QT-1", status: "draft" }, vatPct: 15 });
    expect(q.locked).toBe(true);
    expect(q.quote?.ref).toBe("QT-1");
  });
  it("a rate-priced estimate has no product costs to reuse", () => {
    expect(s.unitCosts).toEqual({});
    expect(s.schedule).toEqual([]);
  });
  it("copes with a deleted template", () => {
    const gone = buildSavedEstimate({ estimate, lines, template: null, templateOutdated: false, quote: null, vatPct: 15 });
    expect(gone.view.total).toBe(r.summary.price_incl_vat);
  });
});
