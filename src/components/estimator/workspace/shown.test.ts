import { describe, it, expect } from "vitest";
import { isDirty, shownFromPreview } from "./shown";
import { previewEstimate } from "@/lib/estimator/preview";
import { PRECAST_VILLA_STARTER } from "@/lib/estimator/starterTemplates";

describe("isDirty", () => {
  const stored = { floors: 2, finish_level: "standard", include_stairs: true };
  it("is false when nothing changed", () => {
    expect(isDirty(stored, { floors: 2, finish_level: "standard", include_stairs: true }, 18, "18")).toBe(false);
  });
  it("sees an input or the margin change", () => {
    expect(isDirty(stored, { floors: 3, finish_level: "standard", include_stairs: true }, 18, "18")).toBe(true);
    expect(isDirty(stored, { floors: 2, finish_level: "premium", include_stairs: true }, 18, "18")).toBe(true);
    expect(isDirty(stored, { floors: 2, finish_level: "standard", include_stairs: true }, 18, "20")).toBe(true);
    expect(isDirty(stored, { floors: 2, finish_level: "standard", include_stairs: true }, 18, "")).toBe(true);
  });
  it("an emptied number box (left out of the params) is not a change by itself", () => {
    expect(isDirty(stored, { finish_level: "standard", include_stairs: true }, 18, "18")).toBe(false);
  });
});

describe("shownFromPreview", () => {
  it("is empty without a preview", () => {
    expect(shownFromPreview(null)).toEqual({ lines: [], model: null, totals: null, live: true });
  });
  it("carries the lines, the model and the totals of the preview", () => {
    const p = previewEstimate({ template: PRECAST_VILLA_STARTER, params: {}, margin_pct: 18, vat_pct: 15 });
    if (!p.ok) throw new Error("preview failed");
    const s = shownFromPreview(p);
    expect(s.lines).toHaveLength(16);
    expect(s.model?.pieces).toHaveLength(137);
    expect(s.totals?.price_incl_vat).toBe(236466.2);
    expect(s.live).toBe(true);
    expect(Object.keys(s.lines[0]).sort()).toEqual(["code", "component", "cost_total", "description", "element_ref", "group_key", "qty", "source", "uom"]);
  });
});
