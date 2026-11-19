import { describe, it, expect } from "vitest";
import { ESTIMATE_TIPS } from "@/lib/estimator/tips";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isDirty, shownBlank, shownFromPreview } from "./shown";
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

describe("shownBlank (a new precast villa shows its 3D model before anything is saved)", () => {
  it("keeps the model of the starting sizes and nothing that prices it", () => {
    expect(shownBlank(null)).toEqual({ lines: [], model: null, totals: null, live: true });
    const p = previewEstimate({ template: PRECAST_VILLA_STARTER, params: {}, margin_pct: 0, vat_pct: 15 });
    if (!p.ok) throw new Error("preview failed");
    const s = shownBlank(p);
    expect(s.model?.pieces).toHaveLength(137);
    expect(s.lines).toEqual([]);
    expect(s.totals).toBeNull();
  });
  it("the working page draws the model of a blank estimate; that nothing is saved yet is behind the page's i, in words that match the buttons", () => {
    const src = readFileSync(path.join(__dirname, "EstimateWorkspace.tsx"), "utf8");
    expect(src).toContain("blank ? shownBlank(preview)");
    expect(src).not.toContain("nothing is saved yet");
    expect(ESTIMATE_TIPS.page).toContain("Nothing is saved until you press Create quote or Save as draft");
    expect(ESTIMATE_TIPS.pageTender).toContain("Nothing is saved until you press Save as draft");
    expect(ESTIMATE_TIPS.pageTender).not.toMatch(/quote/i);
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
