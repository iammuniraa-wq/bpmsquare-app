import { describe, expect, it } from "vitest";
import { FEATURE_DEPENDENCIES, FEATURE_GROUP, dependantsOn, featureUnlocks, groupLabelForFeature, unmetDependencies } from "./moduleDependencies";

describe("module dependencies", () => {
  it("reports what a flag leans on that is still off", () => {
    expect(unmetDependencies({ wfm: true }, "wfm").map((d) => d.needs)).toEqual(["business_roles"]);
    expect(unmetDependencies({ wfm: true, business_roles: true }, "wfm")).toEqual([]);
    expect(unmetDependencies({ wfm_projects: true, wfm: true }, "wfm_projects").map((d) => d.needs)).toEqual(["invoices"]);
  });

  it("reports the flags that would be stranded by switching one off", () => {
    expect(dependantsOn({ wfm: true, wfm_projects: true }, "wfm").map((d) => d.key)).toEqual(["wfm_projects"]);
    expect(dependantsOn({ wfm: true }, "wfm")).toEqual([]);
  });

  it("never lets a flag depend on itself", () => {
    for (const d of FEATURE_DEPENDENCIES) expect(d.needs).not.toBe(d.key);
  });

  it("groups every flag the editor lists under a settings group", () => {
    expect(groupLabelForFeature("wfm")).toBe("Workforce");
    expect(groupLabelForFeature("cases")).toBe("Service");
    expect(groupLabelForFeature("quotations")).toBe("Sales");
    expect(Object.values(FEATURE_GROUP).every(Boolean)).toBe(true);
  });

  it("lists the sidebar entries a flag unlocks", () => {
    const u = featureUnlocks("purchasing");
    expect(u.nav).toEqual(expect.arrayContaining(["Inventory", "Purchase Orders"]));
    expect(featureUnlocks("rfq").settings).toContain("RFQ");
  });
});
