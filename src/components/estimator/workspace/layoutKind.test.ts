import { describe, it, expect } from "vitest";
import { opensWithDefaults } from "./layoutKind";
import { previewEstimate } from "@/lib/estimator/preview";
import { EXCAVATION_STARTER } from "@/lib/estimator/starterTemplatesCivil";

describe("opensWithDefaults", () => {
  it("every layout opens onto its price with defaults except the precast villa", () => {
    expect(opensWithDefaults(null)).toBe(true);
    expect(opensWithDefaults(undefined)).toBe(true);
    expect(opensWithDefaults("chainlink_fence")).toBe(true);
    expect(opensWithDefaults("precast_villa")).toBe(false);
  });
  it("a generic template (no layout module) computes from its defaults, so the first render has a price to show", () => {
    expect(EXCAVATION_STARTER.geometry ?? null).toBeNull();
    const p = previewEstimate({ template: EXCAVATION_STARTER, params: {}, margin_pct: 0, vat_pct: 0, unit_costs: {} });
    expect(p.ok).toBe(true);
  });
});
