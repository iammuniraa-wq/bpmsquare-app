import { describe, it, expect } from "vitest";
import { understoodChips, assumedChips } from "./intakeChips";
import { PRECAST_VILLA_STARTER } from "@/lib/estimator/starterTemplates";

const inputs = PRECAST_VILLA_STARTER.inputs;

describe("intake chips", () => {
  const proposal = {
    values: { floors: 2, built_up_area_m2: 180, finish_level: "premium", include_stairs: true },
    assumptions: ["Wall height was not stated; 3 m assumed."],
  };

  it("describes each understood value in the template's words, in template order", () => {
    expect(understoodChips(inputs, proposal)).toEqual([
      "Number of floors: 2 floors",
      "Built-up area per floor: 180 m²",
      "External finish: Premium (+18% on visible faces)",
      "Include precast stairs: yes",
    ]);
  });

  it("lists the model's assumptions and the inputs the email did not mention", () => {
    const a = assumedChips(inputs, proposal);
    expect(a[0]).toBe("Wall height was not stated; 3 m assumed.");
    expect(a).toContain("External wall thickness not mentioned, using 0.2 m");
    expect(a.some((x) => x.startsWith("Number of floors"))).toBe(false);
  });

  it("an empty proposal marks everything as assumed", () => {
    expect(understoodChips(inputs, { values: {} })).toEqual([]);
    expect(assumedChips(inputs, { values: {}, assumptions: [] })).toHaveLength(inputs.length);
  });
});
