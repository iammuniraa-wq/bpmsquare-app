import { describe, it, expect } from "vitest";
import { opensWithDefaults, hasBuildSchedule, hasScheduleRiskTab, layoutName } from "./layoutKind";
import { previewEstimate } from "@/lib/estimator/preview";
import { EXCAVATION_STARTER } from "@/lib/estimator/starterTemplatesCivil";
import { WASTEWATER_PLANT_STARTER } from "@/lib/estimator/starterTemplatesWastewater";

describe("the Schedule & risk tab", () => {
  const ranged = [{ key: "rate", label: "Rate", unit: "per h", value: 10, low: 8, high: 14 }];

  it("shows the same for a template with no layout whether it is stored as null or, by the SQL seeds, as an empty string", () => {
    for (const geometry of [null, undefined, ""]) {
      expect(hasBuildSchedule(geometry), String(geometry)).toBe(true);
      expect(hasScheduleRiskTab({ geometry, rates: [] }), String(geometry)).toBe(true);
    }
    expect(hasScheduleRiskTab({ geometry: "", rates: WASTEWATER_PLANT_STARTER.rates })).toBe(true);
    expect(hasScheduleRiskTab({ geometry: null, rates: EXCAVATION_STARTER.rates })).toBe(true);
  });
  it("shows for another layout only when a rate has a range for the risk run", () => {
    expect(hasBuildSchedule("chainlink_fence")).toBe(false);
    expect(hasScheduleRiskTab({ geometry: "chainlink_fence", rates: ranged })).toBe(true);
    expect(hasScheduleRiskTab({ geometry: "chainlink_fence", rates: [{ key: "rate", label: "Rate", unit: "per h", value: 10 }] })).toBe(false);
  });
});

describe("a layout's name on screen", () => {
  it("drops the module's own illustrative suffix", () => {
    expect(layoutName("Precast villa (illustrative)")).toBe("Precast villa");
    expect(layoutName("Chain-link fence")).toBe("Chain-link fence");
  });
});

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
